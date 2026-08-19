#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,shutil,sys,tempfile
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; INBOX=ROOT/'UPLOAD_IMAGES_HERE'; ALLOWED_EXTENSIONS={'.jpg','.jpeg','.png','.webp'}; MAX_BATCH=50; ACTIVE_STATUSES={'ACTIVE','WAITING_REPAIR','PUBLISHING'}; PENDING_GUARD_PHASES={'IMAGE_PENDING','NEEDS_REVIEW'}; INBOX_CONTROL_FILES={'.gitkeep','README.md','REPROCESS_REQUEST.txt'}
def fail(code,message): print(f'IMAGE UPLOAD INBOX V1 FAIL [{code}]: {message}',file=sys.stderr); raise SystemExit(1)
def load_json(p): return json.loads(p.read_text(encoding='utf-8'))
POLICY=load_json(ROOT/'production'/'_system'/'config.json').get('imageGenerationPolicy',{})
REQUIRED_PRODUCTION_APPROVAL_TYPE=POLICY.get('requiredProductionApprovalType','human-visual-review')
def sha256(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
 return h.hexdigest()
def production_context():
 manifests={}
 mdir=ROOT/'production'/'manifests'
 if mdir.is_dir():
  for p in mdir.glob('*.json'):
   m=load_json(p); manifests[m.get('manifestId')]=m
 out={}; rdir=ROOT/'production'/'runs'
 if not rdir.is_dir(): return out
 for p in rdir.glob('*.json'):
  run=load_json(p)
  if run.get('schemaVersion')!=1 or run.get('runVersion')!=1: fail('UNSUPPORTED_SCHEMA_VERSION',f'unsupported RUN schema in {p.relative_to(ROOT)}')
  for item in run.get('items',[]):
   if run.get('status') in ACTIVE_STATUSES or item.get('productionPhase') in PENDING_GUARD_PHASES: out[item.get('strainId')]=(run,manifests.get(item.get('manifestId')))
 return out
def validate_production_guard(strain_id,source,ctx):
 if strain_id not in ctx: return
 run,manifest=ctx[strain_id]
 if not manifest: fail('IMAGE_MANIFEST_MISMATCH',f'active production target {strain_id} has no manifest')
 if manifest.get('schemaVersion')!=1 or manifest.get('manifestVersion')!=1: fail('UNSUPPORTED_SCHEMA_VERSION',f'unsupported manifest version for {strain_id}')
 if manifest.get('approvalStatus')!='approved': fail('HUMAN_APPROVAL_REQUIRED',f'manifest for {strain_id} is not human-approved')
 if manifest.get('approvalType')!=REQUIRED_PRODUCTION_APPROVAL_TYPE: fail('HUMAN_APPROVAL_REQUIRED',f"manifest for {strain_id} approvalType must be {REQUIRED_PRODUCTION_APPROVAL_TYPE}; AI visual QA alone cannot promote")
 if manifest.get('approvedManifestRevision')!=manifest.get('revision') or manifest.get('approvedAttempt')!=manifest.get('attempt'): fail('STALE_IMAGE_ATTEMPT',f'approval for {strain_id} is stale')
 if source.name!=manifest.get('expectedInboxFilename'): fail('INBOX_WRONG_FILENAME',f"expected {manifest.get('expectedInboxFilename')} for {strain_id}, got {source.name}")
 expected=f'strains/{strain_id}/images/generated/primary.webp'
 if manifest.get('expectedPrimaryPath')!=expected: fail('IMAGE_STRAIN_MISMATCH',f'manifest primary path mismatch for {strain_id}')
 if run.get('mode')=='new-publication' and strain_id in set(run.get('publishedIdsAtStart',[])) and (ROOT/expected).exists(): fail('EXISTING_PUBLISHED_PRIMARY_OVERWRITE',f'new-publication cannot overwrite existing published primary for {strain_id}')
 d=manifest.get('approvedSourceSha256')
 if d and sha256(source)!=d: fail('IMAGE_DIGEST_MISMATCH',f'approved digest does not match inbox image for {strain_id}')
def validate_webp(p):
 data=p.read_bytes()
 if not data: fail('IMAGE_FILE_MISSING',f'converted file is empty: {p}')
 if len(data)<12 or data[:4]!=b'RIFF' or data[8:12]!=b'WEBP': fail('INVALID_WEBP_SIGNATURE',f'invalid RIFF/WEBP signature: {p}')
 try:
  with Image.open(p) as image:
   image.load(); w,h=image.size
   if image.format!='WEBP': fail('IMAGE_DECODE_FAILED',f'decoder did not identify WEBP: {p}')
 except Exception as exc: fail('IMAGE_DECODE_FAILED',f'decoder could not open converted image {p}: {exc}')
 if w<=0 or h<=0: fail('INVALID_IMAGE_DIMENSIONS',f'invalid image dimensions {w}x{h}: {p}')
 return w,h
def convert_to_webp(source,destination):
 source=Path(source); destination=Path(destination); destination.parent.mkdir(parents=True,exist_ok=True)
 try:
  with Image.open(source) as image: image.load(); image.save(destination,format='WEBP',quality=92,method=6)
 except Exception as exc: fail('IMAGE_DECODE_FAILED',f'cannot decode/convert {source.name}: {exc}')
 w,h=validate_webp(destination)
 return {'width':w,'height':h,'sha256':sha256(destination)}
def main():
 INBOX.mkdir(parents=True,exist_ok=True); entries=sorted(p for p in INBOX.iterdir() if p.is_file() and p.name not in INBOX_CONTROL_FILES and not p.name.startswith('.'))
 if not entries: print('IMAGE UPLOAD INBOX V1: inbox is empty'); return
 unsupported=[p.name for p in entries if p.suffix.lower() not in ALLOWED_EXTENSIONS]
 if unsupported: fail('INBOX_WRONG_FILENAME','unsupported file(s): '+', '.join(unsupported))
 if len(entries)>MAX_BATCH: fail('INBOX_WRONG_FILENAME',f'batch has {len(entries)} images; V1 limit is {MAX_BATCH}')
 prod=production_context(); by_strain={}
 for source in entries:
  strain_id=source.stem
  if not strain_id: fail('INBOX_WRONG_FILENAME',f'empty strain-id in filename: {source.name}')
  if strain_id in by_strain: fail('INBOX_WRONG_FILENAME',f"duplicate strain-id '{strain_id}' in one batch")
  by_strain[strain_id]=source
  if not (ROOT/'strains'/strain_id/'strain.json').is_file(): fail('INBOX_UNKNOWN_STRAIN',f"unknown strain-id '{strain_id}'")
  validate_production_guard(strain_id,source,prod)
 staged=[]
 with tempfile.TemporaryDirectory(prefix='image-upload-inbox-') as tmp_name:
  tmp=Path(tmp_name)
  for strain_id,source in by_strain.items():
   converted=tmp/f'{strain_id}.webp'; meta=convert_to_webp(source,converted); destination=ROOT/'strains'/strain_id/'images'/'generated'/'primary.webp'; staged.append((converted,destination)); print(f"PASS {source.name} -> {destination.relative_to(ROOT)} ({meta['width']}x{meta['height']})")
  for converted,destination in staged: destination.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(converted,destination)
  for source in entries: source.unlink()
 print(f'IMAGE UPLOAD INBOX V1: prepared atomic batch of {len(staged)} image(s)')
if __name__=='__main__':
 if len(sys.argv)==4 and sys.argv[1]=='--convert-approved': print(json.dumps(convert_to_webp(sys.argv[2],sys.argv[3]),sort_keys=True))
 elif len(sys.argv)==1: main()
 else: fail('INBOX_WRONG_FILENAME','usage: process-image-upload-inbox.py OR --convert-approved SOURCE DESTINATION')
