#!/usr/bin/env python3
import argparse, json, re, sys
from pathlib import Path

ENGINE = "local-clip-semantic-v1"
MODEL_ID = "openai/clip-vit-base-patch32"
VISUAL_TERMS = re.compile(r"\b(tall|short|narrow|wide|broad|compact|branch|branches|branching|internod|leaf|leaves|foliage|bud|buds|flower|flowers|flowering|cola|colas|dense|sparse|open|bushy|vertical|lateral|structure|architecture|morphology|purple|green|pistil|trichome)\w*\b", re.I)

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def write_json(path, value):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def evidence_text(manifest):
    parts=[]
    for item in manifest.get("evidenceSnapshot") or []:
        if isinstance(item, dict):
            text = item.get("description") or item.get("text") or ""
        else:
            text = str(item)
        if text and VISUAL_TERMS.search(text): parts.append(text)
    if not parts:
        p = manifest.get("promptSnapshot")
        if isinstance(p, str) and p.strip(): parts.append(p.strip())
    return " ".join(parts)[:1200]

def normalize(v):
    return v / v.norm(dim=-1, keepdim=True).clamp_min(1e-8)

def qa_one(model, processor, image_path, manifest, device):
    from PIL import Image, ImageStat
    import torch
    checks=[]
    try:
        with Image.open(image_path) as im0:
            im0.verify()
        with Image.open(image_path) as im0:
            image=im0.convert("RGB")
            w,h=image.size
            stat=ImageStat.Stat(image.resize((64,64)))
            mean=sum(stat.mean)/3.0
            variance=sum(stat.var)/3.0
            decode_ok=w>=512 and h>=512 and variance>35 and 4<mean<251
    except Exception as e:
        return {"status":"FAIL","engine":ENGINE,"model":MODEL_ID,"reason":"IMAGE_DECODE_FAILED","checks":[{"id":"image_decode","pass":False,"detail":str(e)[:300]}],"failClosed":True}
    checks.append({"id":"image_decode","pass":bool(decode_ok),"width":w,"height":h,"variance":round(float(variance),3),"meanLuma":round(float(mean),3)})

    groups=[
      ("cannabis_natural",
       ["a natural mature flowering cannabis plant with coherent leaves stems branches and flowering sites",
        "a botanically plausible single cannabis plant photographed as a cultivar reference"],
       ["a grapevine with bunches of grapes", "a berry bush covered in round fruit", "an unrelated ornamental flowering plant"], 0.004),
      ("plant_structure",
       ["a botanically coherent plant with plausible branching leaf attachment and flower structure"],
       ["a deformed impossible plant with fused leaves broken anatomy duplicated stems and malformed flower clusters"], 0.002),
      ("no_fruit_or_berries",
       ["cannabis flowering buds attached naturally along stems without fruit"],
       ["round berries grapes fruit bunches hanging from a plant", "clusters of edible fruit on branches"], 0.002),
      ("no_unwanted_objects",
       ["a single cannabis plant alone with a clean neutral scene"],
       ["a person posing with a plant", "product packaging with a brand label", "a jar bag box or bottle with printed text", "a cloud of smoke or smoking scene"], 0.002),
      ("primary_visual_usable",
       ["a clear realistic botanical reference photograph of one complete cannabis plant"],
       ["a collage poster product advertisement illustration diagram or heavily distorted low quality image"], 0.001),
    ]
    ev=evidence_text(manifest)
    texts=[]; slices=[]
    for cid,pos,neg,margin in groups:
        start=len(texts); texts.extend(pos+neg); slices.append((cid,start,len(pos),len(neg),margin))
    ev_index=None
    if ev:
        ev_index=len(texts); texts.extend([ev, "a generic cannabis plant with morphology unrelated to the supplied cultivar evidence"])
    try:
        image_inputs=processor(images=image, return_tensors="pt")
        text_inputs=processor(text=texts, return_tensors="pt", padding=True, truncation=True)
        image_inputs={k:v.to(device) for k,v in image_inputs.items()}
        text_inputs={k:v.to(device) for k,v in text_inputs.items()}
        with torch.no_grad():
            iv=normalize(model.get_image_features(**image_inputs))
            tv=normalize(model.get_text_features(**text_inputs))
            scores=(iv @ tv.T).detach().cpu().numpy()[0].tolist()
    except Exception as e:
        checks.append({"id":"semantic_model","pass":False,"detail":str(e)[:400]})
        return {"status":"FAIL","engine":ENGINE,"model":MODEL_ID,"reason":"AI_QA_MODEL_ERROR","checks":checks,"evidenceText":ev,"failClosed":True}

    for cid,start,np,nn,margin in slices:
        pos=scores[start:start+np]; neg=scores[start+np:start+np+nn]
        pos_score=max(pos); neg_score=max(neg); delta=pos_score-neg_score
        checks.append({"id":cid,"pass":bool(delta>=margin),"positive":round(pos_score,5),"negative":round(neg_score,5),"margin":round(delta,5),"requiredMargin":margin})
    if ev_index is not None:
        ev_score=scores[ev_index]; generic=scores[ev_index+1]; delta=ev_score-generic
        checks.append({"id":"evidence_alignment","pass":bool(ev_score>=0.15 and delta>=-0.015),"evidenceScore":round(ev_score,5),"genericScore":round(generic,5),"margin":round(delta,5),"evidenceText":ev[:600]})
    else:
        checks.append({"id":"evidence_alignment","pass":False,"reason":"NO_VISUAL_EVIDENCE_TEXT"})
    passed=all(c.get("pass") is True for c in checks)
    return {"status":"PASS" if passed else "FAIL","engine":ENGINE,"model":MODEL_ID,"checks":checks,"evidenceText":ev,"failClosed":True}

def fail_closed_batch(receipt_paths, out, reason, detail):
    results=[]
    for rp in receipt_paths:
        try:
            receipt=read_json(rp); sid=receipt.get('strainId') or rp.stem
        except Exception:
            sid=rp.stem
        result={"strainId":sid,"status":"FAIL","engine":ENGINE,"model":MODEL_ID,"reason":reason,"checks":[{"id":"qa_engine_available","pass":False,"detail":str(detail)[:500]}],"failClosed":True}
        write_json(out/f'{sid}.json',result); results.append(result)
        print(json.dumps({"strainId":sid,"status":"FAIL","engine":ENGINE,"reason":reason}))
    write_json(out/'summary.json',{"engine":ENGINE,"model":MODEL_ID,"failClosed":True,"batchReason":reason,"results":[{"strainId":x['strainId'],"status":x['status']} for x in results]})
    return 0

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--review-dir', required=True)
    ap.add_argument('--manifest-dir', default='production/manifests')
    ap.add_argument('--out-dir', required=True)
    args=ap.parse_args()
    review=Path(args.review_dir); out=Path(args.out_dir); out.mkdir(parents=True, exist_ok=True)
    receipts=review/'receipts'; candidates=review/'candidates'
    receipt_paths=sorted(receipts.glob('*.json'))
    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor
    except Exception as e:
        print(f"AI_VISUAL_QA_DEPENDENCY_ERROR: {e}", file=sys.stderr)
        return fail_closed_batch(receipt_paths,out,"AI_QA_DEPENDENCY_ERROR",e)
    device='cpu'
    try:
        model=CLIPModel.from_pretrained(MODEL_ID).to(device).eval()
        processor=CLIPProcessor.from_pretrained(MODEL_ID)
    except Exception as e:
        print(f"AI_VISUAL_QA_MODEL_LOAD_ERROR: {e}", file=sys.stderr)
        return fail_closed_batch(receipt_paths,out,"AI_QA_MODEL_LOAD_ERROR",e)
    results=[]
    for rp in receipt_paths:
        receipt=read_json(rp); sid=receipt.get('strainId') or rp.stem
        image=candidates/f'{sid}.jpg'; manifest=Path(args.manifest_dir)/f'{sid}.json'
        if not image.exists() or not manifest.exists():
            result={"strainId":sid,"status":"FAIL","engine":ENGINE,"model":MODEL_ID,"reason":"QA_INPUT_MISSING","checks":[],"failClosed":True}
        else:
            result={"strainId":sid, **qa_one(model,processor,image,read_json(manifest),device)}
        write_json(out/f'{sid}.json',result); results.append(result)
        print(json.dumps({"strainId":sid,"status":result['status'],"engine":ENGINE}))
    write_json(out/'summary.json',{"engine":ENGINE,"model":MODEL_ID,"failClosed":True,"results":[{"strainId":x['strainId'],"status":x['status']} for x in results]})
    return 0

if __name__=='__main__': raise SystemExit(main())
