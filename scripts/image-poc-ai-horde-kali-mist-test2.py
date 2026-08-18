#!/usr/bin/env python3
import base64, hashlib, io, json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path
import requests
from PIL import Image

BASE_URL = 'https://aihorde.net/api/v2'
ANON_KEY = '0000000000'
CLIENT_AGENT = 'CannabisStrainsWisdom-ImagePoC-Test2:1.0:github.com/Blazea-x/strain-atlas'
MANIFEST_PATH = Path('production/manifests/kali-mist.json')
PROFILE_PATH = Path('generation-profiles/cannabis-strain-wisdom-test2-v1.json')
OUT_DIR = Path(os.environ.get('POC_OUTPUT_DIR', 'poc-artifact'))
MODEL = "ICBINP - I Can't Believe It's Not Photography"
QUEUE_TIMEOUT_SECONDS = int(os.environ.get('AI_HORDE_QUEUE_TIMEOUT_SECONDS', '600'))
GENERATION_TIMEOUT_SECONDS = int(os.environ.get('AI_HORDE_GENERATION_TIMEOUT_SECONDS', '900'))
POLL_SECONDS = int(os.environ.get('AI_HORDE_POLL_SECONDS', '5'))
REQUEST_TIMEOUT_SECONDS = int(os.environ.get('AI_HORDE_HTTP_TIMEOUT_SECONDS', '30'))

class PocFailure(RuntimeError):
    def __init__(self, code, message, details=None):
        super().__init__(message); self.code=code; self.message=message; self.details=details or {}

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')

def sha256_bytes(data): return hashlib.sha256(data).hexdigest()
def canonical_json_bytes(v): return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode('utf-8')

def request_json(session, method, url, *, failure_code, http_log, label, **kwargs):
    try:
        r=session.request(method,url,timeout=REQUEST_TIMEOUT_SECONDS,**kwargs)
    except requests.RequestException as exc:
        raise PocFailure(failure_code,f'HTTP request failed: {exc}') from exc
    meta={'label':label,'method':method,'status':r.status_code,'contentType':r.headers.get('content-type','')}
    http_log.append(meta)
    if not 200 <= r.status_code < 300:
        code='AI_HORDE_UNAVAILABLE' if r.status_code>=500 else failure_code
        raise PocFailure(code,f'HTTP {r.status_code} from {url}',{'body':r.text[:1200],**meta})
    if 'json' not in meta['contentType'].lower():
        raise PocFailure(failure_code,f'Expected JSON from {url}',meta)
    try: return r.json()
    except ValueError as exc: raise PocFailure(failure_code,f'Invalid JSON from {url}') from exc

def load_inputs():
    manifest_bytes=MANIFEST_PATH.read_bytes(); profile_bytes=PROFILE_PATH.read_bytes()
    manifest=json.loads(manifest_bytes); profile=json.loads(profile_bytes)
    required=['runId','strainId','manifestVersion','revision','attempt','promptSnapshot','evidenceSnapshot','visualPreparationHash','approvalStatus']
    missing=[k for k in required if k not in manifest]
    if missing: raise PocFailure('INPUT_INVALID','Manifest missing fields',{'missing':missing})
    if manifest['runId']!='content-production-20260818T060700Z-01' or manifest['strainId']!='kali-mist': raise PocFailure('INPUT_INVALID','Wrong formal manifest identity')
    if manifest['approvalStatus']!='pending': raise PocFailure('INPUT_INVALID','approvalStatus must remain pending')
    if profile.get('version')!='csw-generation-profile-test2-v1': raise PocFailure('INPUT_INVALID','Unexpected Generation Profile version')
    if profile.get('comparisonPolicy',{}).get('sameModelRequired')!=MODEL or profile.get('comparisonPolicy',{}).get('fallbackModelAllowed') is not False: raise PocFailure('INPUT_INVALID','Profile comparison policy changed')
    return manifest, profile, manifest_bytes, profile_bytes

def decode_image(data):
    try:
        with Image.open(io.BytesIO(data)) as im: im.verify()
        with Image.open(io.BytesIO(data)) as im: return im.size[0], im.size[1], im.format
    except Exception as exc: raise PocFailure('IMAGE_DECODE_FAILED',f'Pillow could not decode image: {exc}') from exc

def download_image(session, image_ref):
    if not isinstance(image_ref,str) or not image_ref: raise PocFailure('INVALID_IMAGE_RESPONSE','No image reference')
    if image_ref.startswith(('http://','https://')):
        try: r=session.get(image_ref,timeout=REQUEST_TIMEOUT_SECONDS,allow_redirects=True)
        except requests.RequestException as exc: raise PocFailure('INVALID_IMAGE_RESPONSE',f'Image download failed: {exc}') from exc
        ct=r.headers.get('content-type','')
        if r.status_code!=200 or not ct.lower().startswith('image/'):
            raise PocFailure('INVALID_IMAGE_RESPONSE','Image download response invalid',{'httpStatus':r.status_code,'contentType':ct,'byteLength':len(r.content)})
        return r.content, {'kind':'url','httpStatus':r.status_code,'contentType':ct,'urlHost':requests.utils.urlparse(r.url).hostname}
    try: data=base64.b64decode(image_ref,validate=True)
    except Exception as exc: raise PocFailure('INVALID_IMAGE_RESPONSE','Image was neither URL nor valid base64') from exc
    return data, {'kind':'base64','httpStatus':None,'contentType':None,'urlHost':None}

def write_failure(manifest, profile, exc, generation_id=None, http_log=None):
    OUT_DIR.mkdir(parents=True,exist_ok=True)
    d={'test':'AI_HORDE_POC_TEST_2','generationPipeline':'FAIL','failureCode':exc.code,'message':exc.message,'details':exc.details,'runId':(manifest or {}).get('runId'),'strainId':'kali-mist','revision':(manifest or {}).get('revision'),'attempt':(manifest or {}).get('attempt'),'generationProfileVersion':(profile or {}).get('version'),'provider':'AI Horde','modelRequested':MODEL,'providerGenerationId':generation_id,'http':http_log or [],'failedAt':now_iso(),'workflowRun':{'id':os.environ.get('GITHUB_RUN_ID'),'attempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'sha':os.environ.get('GITHUB_SHA'),'ref':os.environ.get('GITHUB_REF')}}
    (OUT_DIR/'failure.json').write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

def main():
    manifest=profile=None; generation_id=None; http_log=[]; started=time.monotonic()
    try:
        manifest,profile,manifest_bytes,profile_bytes=load_inputs()
        params=profile['generationParameters']
        expected={'cfg_scale':7,'sampler_name':'k_euler_a','height':768,'width':512,'steps':24,'n':1}
        if params!=expected: raise PocFailure('INPUT_INVALID','TEST 1 comparison parameters changed',{'actual':params,'expected':expected})
        prompt_snapshot=manifest['promptSnapshot']; evidence=manifest['evidenceSnapshot']
        positive=f"{prompt_snapshot}\n\nCannabis Strain Wisdom common visual representation profile:\n{profile['representationPrompt']}"
        negative=profile['negativePrompt']
        final_prompt=f'{positive} ### {negative}'
        session=requests.Session(); session.headers.update({'apikey':ANON_KEY,'Client-Agent':CLIENT_AGENT,'Accept':'application/json','User-Agent':CLIENT_AGENT})
        heartbeat=request_json(session,'GET',f'{BASE_URL}/status/heartbeat',failure_code='AI_HORDE_UNAVAILABLE',http_log=http_log,label='heartbeat')
        modes=request_json(session,'GET',f'{BASE_URL}/status/modes',failure_code='AI_HORDE_UNAVAILABLE',http_log=http_log,label='modes')
        if isinstance(modes,dict) and modes.get('maintenance_mode') is True: raise PocFailure('AI_HORDE_UNAVAILABLE','AI Horde maintenance mode')
        models=request_json(session,'GET',f'{BASE_URL}/status/models?type=image',failure_code='AI_HORDE_UNAVAILABLE',http_log=http_log,label='models')
        live=next((m for m in models if isinstance(m,dict) and m.get('name')==MODEL and int(m.get('count') or 0)>0),None)
        if live is None: raise PocFailure('REQUIRED_MODEL_UNAVAILABLE','Required TEST 1 model has no active worker; no fallback permitted',{'requiredModel':MODEL})
        model_status={k:live.get(k) for k in ('count','queued','jobs','eta','performance')}
        payload={'prompt':final_prompt,'params':params,'models':[MODEL],'nsfw':False,'censor_nsfw':True,'r2':True,'shared':False,'slow_workers':True,'dry_run':False}
        submitted_at=now_iso()
        req=request_json(session,'POST',f'{BASE_URL}/generate/async',failure_code='PROVIDER_ERROR',http_log=http_log,label='generate-async',json=payload)
        generation_id=req.get('id') if isinstance(req,dict) else None
        if not generation_id: raise PocFailure('PROVIDER_ERROR','Generation request returned no id')
        print(f'GENERATION_REQUEST_SUCCESS providerGenerationId={generation_id} model={MODEL}')
        queue_started=time.monotonic(); processing_seen=False; final_check=None
        while True:
            elapsed=time.monotonic()-started; queue_elapsed=time.monotonic()-queue_started
            if elapsed>GENERATION_TIMEOUT_SECONDS: raise PocFailure('GENERATION_TIMEOUT','Generation exceeded overall timeout',{'seconds':round(elapsed,1)})
            check=request_json(session,'GET',f'{BASE_URL}/generate/check/{generation_id}',failure_code='PROVIDER_ERROR',http_log=http_log,label='generate-check')
            final_check=check; waiting=int(check.get('waiting') or 0); processing=int(check.get('processing') or 0); finished=int(check.get('finished') or 0)
            print(f"POLL waiting={waiting} processing={processing} finished={finished} done={bool(check.get('done'))} faulted={bool(check.get('faulted'))}")
            if processing>0 or finished>0: processing_seen=True
            if check.get('faulted'): raise PocFailure('PROVIDER_ERROR','AI Horde marked generation faulted',{'check':check})
            if check.get('done'):
                if finished<1: raise PocFailure('PROVIDER_ERROR','Completed without a finished image',{'check':check})
                break
            if not processing_seen and queue_elapsed>QUEUE_TIMEOUT_SECONDS: raise PocFailure('QUEUE_TIMEOUT','Generation remained queued beyond queue timeout',{'seconds':round(queue_elapsed,1)})
            time.sleep(POLL_SECONDS)
        status=request_json(session,'GET',f'{BASE_URL}/generate/status/{generation_id}',failure_code='PROVIDER_ERROR',http_log=http_log,label='generate-status')
        gens=status.get('generations') if isinstance(status,dict) else None
        if not isinstance(gens,list) or len(gens)!=1: raise PocFailure('PROVIDER_ERROR','Expected exactly one generated image',{'generationCount':len(gens) if isinstance(gens,list) else None})
        gen=gens[0]; image_bytes,transport=download_image(session,gen.get('img'))
        if len(image_bytes)<1024: raise PocFailure('INVALID_IMAGE_RESPONSE','Image payload implausibly small',{'byteLength':len(image_bytes)})
        width,height,fmt=decode_image(image_bytes); image_hash=sha256_bytes(image_bytes)
        suffix={'JPEG':'.jpg','PNG':'.png','WEBP':'.webp'}.get((fmt or '').upper(),'.img'); filename=f'kali-mist-ai-horde-test2{suffix}'
        OUT_DIR.mkdir(parents=True,exist_ok=True); (OUT_DIR/filename).write_bytes(image_bytes); (OUT_DIR/'sha256.txt').write_text(f'{image_hash}  {filename}\n',encoding='utf-8')
        completed_at=now_iso(); duration=round(time.monotonic()-started,1)
        provenance={'pocSchemaVersion':2,'test':'AI_HORDE_POC_TEST_2','generationPipeline':'PASS','costPolicy':'FREE_ANONYMOUS_ONLY','runId':manifest['runId'],'strainId':'kali-mist','manifestVersion':manifest['manifestVersion'],'revision':manifest['revision'],'attempt':manifest['attempt'],'manifestSha256':sha256_bytes(manifest_bytes),'visualPreparationHash':manifest['visualPreparationHash'],'promptSnapshotSha256':sha256_bytes(prompt_snapshot.encode('utf-8')),'evidenceSnapshotSha256':sha256_bytes(canonical_json_bytes(evidence)),'generationProfileVersion':profile['version'],'generationProfileSha256':sha256_bytes(profile_bytes),'negativePromptSha256':sha256_bytes(negative.encode('utf-8')),'finalProviderPromptSha256':sha256_bytes(final_prompt.encode('utf-8')),'provider':'AI Horde','model':gen.get('model') or MODEL,'modelRequested':MODEL,'modelStatusAtSelection':model_status,'sampler':params['sampler_name'],'steps':params['steps'],'cfgScale':params['cfg_scale'],'generationParametersRequested':params,'seed':gen.get('seed'),'providerGenerationId':generation_id,'jobId':gen.get('id'),'workerId':gen.get('worker_id'),'workerName':gen.get('worker_name'),'submittedAt':submitted_at,'generatedAt':completed_at,'generationElapsedSeconds':duration,'http':http_log,'imageTransport':transport,'actualImageByteLength':len(image_bytes),'actualImageSha256':image_hash,'imageFormat':fmt,'decodedDimensions':{'width':width,'height':height},'providerCheckFinal':final_check,'providerWarnings':req.get('warnings') if isinstance(req,dict) else None,'providerHeartbeat':heartbeat,'visualAssessment':{'status':'HUMAN_VISUAL_REVIEW_REQUIRED','candidateOnly':True,'automaticVisualPass':False,'criteria':['TEST 1 cotton/bottle-brush anomaly resolved','mature female flower morphology plausible','repeated identical structures reduced','formal Kali Mist evidence visually assessable','plant architecture or required upper structure assessable']},'workflowRun':{'repository':os.environ.get('GITHUB_REPOSITORY'),'id':int(os.environ['GITHUB_RUN_ID']) if os.environ.get('GITHUB_RUN_ID') else None,'attempt':int(os.environ['GITHUB_RUN_ATTEMPT']) if os.environ.get('GITHUB_RUN_ATTEMPT') else None,'sha':os.environ.get('GITHUB_SHA'),'ref':os.environ.get('GITHUB_REF')}}
        (OUT_DIR/'generation-provenance.json').write_text(json.dumps(provenance,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
        print(json.dumps({'generationPipeline':'PASS','model':provenance['model'],'seconds':duration,'sha256':image_hash,'dimensions':[width,height]},ensure_ascii=False))
    except PocFailure as exc:
        write_failure(manifest,profile,exc,generation_id,http_log); print(f'FAIL {exc.code}: {exc.message}',file=sys.stderr); return 1
    except Exception as exc:
        pf=PocFailure('UNEXPECTED_ERROR',str(exc)); write_failure(manifest,profile,pf,generation_id,http_log); raise
    return 0

if __name__=='__main__': sys.exit(main())
