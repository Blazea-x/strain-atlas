import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildRuntimeSnapshot } from './build-runtime-data.mjs';
import { buildImageBacklogRows } from './list-image-backlog.mjs';

const ROOT=process.cwd();
const fixturePath=path.join(ROOT,'scripts/fixtures/auto-publish-image-reject-v1.fixture.json');
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const selected=fixture.selected;
assert.equal(selected.length,5,'fixture must contain exactly five cultivars');

const autoOut=fs.mkdtempSync(path.join(os.tmpdir(),'image-gated-auto-fixture-'));
const auto=spawnSync(process.execPath,[path.join(ROOT,'scripts/production-auto-publish-v1.mjs'),'fixture',`--fixture=${fixturePath}`,`--out=${autoOut}`],{cwd:ROOT,encoding:'utf8'});
assert.equal(auto.status,0,`auto-publish fixture failed: ${auto.stderr||auto.stdout}`);
const autoResult=JSON.parse(fs.readFileSync(path.join(autoOut,'fixture-result.json'),'utf8'));
assert.equal(autoResult.status,'PASS');
assert.deepEqual(autoResult.published,['fixture-a','fixture-b','fixture-e']);
assert.deepEqual(autoResult.pending,['fixture-c','fixture-d']);

const rejectOut=fs.mkdtempSync(path.join(os.tmpdir(),'image-gated-reject-fixture-'));
const reject=spawnSync(process.execPath,[path.join(ROOT,'scripts/production-image-reject-v1.mjs'),'fixture',`--out=${rejectOut}`],{cwd:ROOT,encoding:'utf8'});
assert.equal(reject.status,0,`image-reject fixture failed: ${reject.stderr||reject.stdout}`);
const rejectResult=JSON.parse(fs.readFileSync(path.join(rejectOut,'fixture-result.json'),'utf8'));
assert.equal(rejectResult.status,'PASS');
assert.equal(rejectResult.publicationAfterReject,'pending');
assert.equal(rejectResult.runtimeVisibleAfterReject,false);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'image-gated-runtime-fixture-'));
for(const dir of ['strains','sources','entities','production/manifests','production/runs'])fs.mkdirSync(path.join(tmp,dir),{recursive:true});
const visualMetadata=id=>({alt:`${id} plant`,rights:'fixture-only',scope:'cultivar',aiGenerated:true,sourceType:'aiGenerated'});
const webp=Buffer.from('RIFF0000WEBP','ascii');
const webpSha=crypto.createHash('sha256').update(webp).digest('hex');
const publication={schemaVersion:1,registryVersion:1,entries:[]};
const run={schemaVersion:1,runVersion:1,runId:'fixture-run',mode:'new-publication',publicationPolicy:'cultivar',status:'SUCCESS',items:[]};

for(const item of selected){
  const passed=item.candidateStatus==='OK'&&item.aiQaStatus==='PASS';
  const id=item.strainId;
  const metadata=visualMetadata(id);
  const expectedPrimaryPath=`strains/${id}/images/generated/primary.webp`;
  const strain={schemaVersion:1,id,name:item.cultivarName,classification:{type:'unknown'},aliases:[],relations:[],visuals:passed?[{role:'primary',src:expectedPrimaryPath,...metadata}]:[]};
  const strainDir=path.join(tmp,'strains',id);fs.mkdirSync(strainDir,{recursive:true});
  if(passed){const imagePath=path.join(tmp,expectedPrimaryPath);fs.mkdirSync(path.dirname(imagePath),{recursive:true});fs.writeFileSync(imagePath,webp);}
  fs.writeFileSync(path.join(strainDir,'strain.json'),JSON.stringify(strain,null,2)+'\n');
  const manifest={schemaVersion:1,manifestVersion:1,manifestId:`fixture-run-${id}-image`,runId:'fixture-run',strainId:id,revision:1,attempt:1,expectedPrimaryPath,visualMetadataSnapshot:metadata,approvalStatus:passed?'auto-approved':(item.aiQaStatus==='FAIL'?'rejected':'pending'),approvalType:passed?'ai-visual-qa':(item.aiQaStatus==='FAIL'?'ai-visual-qa':null),approvedManifestRevision:passed?1:null,approvedAttempt:passed?1:null,processedPrimarySha256:passed?webpSha:null,width:passed?1024:null,height:passed?1536:null,aiVisualQa:{status:passed?'PASS':(item.aiQaStatus==='FAIL'?'FAIL':'NOT_RUN'),reason:item.aiQaStatus==='FAIL'?'fixture-ai-qa-fail':null},audit:item.candidateStatus==='API_FAIL'?[{code:'IMAGE_GENERATION_OR_PROCESSING_BACKLOG',reason:'fixture-api-fail'}]:(item.aiQaStatus==='FAIL'?[{code:'AI_VISUAL_QA_FAILED',reason:'fixture-ai-qa-fail'}]:[])};
  fs.writeFileSync(path.join(tmp,'production/manifests',`${id}.json`),JSON.stringify(manifest,null,2)+'\n');
  publication.entries.push({strainId:id,state:passed?'published':'pending',origin:'content-production',introducedByRun:'fixture-run',publishedAt:passed?'2026-08-19T00:00:00Z':null});
  run.items.push({strainId:id,manifestId:manifest.manifestId,manifestRevision:1,attempt:1,productionPhase:passed?'PUBLISHED':(item.aiQaStatus==='FAIL'?'NEEDS_REVIEW':'IMAGE_PENDING'),previousStablePhase:passed?'PUBLISHED':'IMAGE_PENDING',audit:manifest.audit});
}
fs.writeFileSync(path.join(tmp,'production/publication.json'),JSON.stringify(publication,null,2)+'\n');
fs.writeFileSync(path.join(tmp,'production/runs/fixture-run.json'),JSON.stringify(run,null,2)+'\n');

const first=buildRuntimeSnapshot({root:tmp}).catalog.cultivars.map(x=>x.id).sort();
assert.deepEqual(first,['fixture-a','fixture-b','fixture-e']);
for(const item of selected)assert.equal(fs.existsSync(path.join(tmp,'strains',item.strainId,'strain.json')),true,`${item.strainId} formal data must remain`);
let backlog=buildImageBacklogRows({root:tmp});
assert.deepEqual(backlog.map(x=>x.strainId),['fixture-c','fixture-d']);
for(const row of backlog){
  assert.equal(row.publicationState,'pending');
  assert.ok(row.failureReason);
  assert.equal(row.manifestRevision,1);
  assert.equal(row.attempt,1);
}

// Simulate post-publication human IMAGE REJECT for B without deleting formal data.
const bId='fixture-b';
const bStrainPath=path.join(tmp,'strains',bId,'strain.json');
const bManifestPath=path.join(tmp,'production/manifests',`${bId}.json`);
const bStrain=JSON.parse(fs.readFileSync(bStrainPath,'utf8'));bStrain.visuals=[];fs.writeFileSync(bStrainPath,JSON.stringify(bStrain,null,2)+'\n');
fs.rmSync(path.join(tmp,`strains/${bId}/images/generated/primary.webp`));
const bManifest=JSON.parse(fs.readFileSync(bManifestPath,'utf8'));
Object.assign(bManifest,{approvalStatus:'rejected',approvalType:'human-image-reject',approvedManifestRevision:null,approvedAttempt:null,processedPrimarySha256:null,width:null,height:null,rejectionReason:'post-publication-image-reject'});
bManifest.audit=[...(bManifest.audit||[]),{code:'HUMAN_IMAGE_REJECT',note:'fixture human rejection'}];
fs.writeFileSync(bManifestPath,JSON.stringify(bManifest,null,2)+'\n');
publication.entries.find(x=>x.strainId===bId).state='pending';
fs.writeFileSync(path.join(tmp,'production/publication.json'),JSON.stringify(publication,null,2)+'\n');
const bRun=run.items.find(x=>x.strainId===bId);bRun.productionPhase='IMAGE_PENDING';bRun.previousStablePhase='IMAGE_PENDING';
fs.writeFileSync(path.join(tmp,'production/runs/fixture-run.json'),JSON.stringify(run,null,2)+'\n');

const afterReject=buildRuntimeSnapshot({root:tmp}).catalog.cultivars.map(x=>x.id).sort();
assert.deepEqual(afterReject,['fixture-a','fixture-e']);
assert.equal(fs.existsSync(bStrainPath),true,'B formal strain data must remain after reject');
assert.deepEqual(JSON.parse(fs.readFileSync(bStrainPath,'utf8')).visuals,[]);
backlog=buildImageBacklogRows({root:tmp});
const bBacklog=backlog.find(x=>x.strainId===bId);
assert.ok(bBacklog,'B must be present in image backlog after reject');
assert.equal(bBacklog.publicationState,'pending');
assert.equal(bBacklog.currentImageState,'IMAGE_PENDING');
assert.equal(bBacklog.manifestRevision,1);
assert.equal(bBacklog.attempt,1);
assert.ok(bBacklog.failureReason);

console.log('DATA-FIRST INTERNALLY + IMAGE-GATED PUBLICLY FIXTURE: PASS');
console.log(JSON.stringify({
  formalDataRetained:5,
  publicationInitially:{published:['fixture-a','fixture-b','fixture-e'],pending:['fixture-c','fixture-d']},
  runtimeInitially:first,
  afterReject:{rejected:'fixture-b',formalDataRetained:true,publication:'pending',runtime:afterReject,backlogPresent:true},
  crossCultivarBlocking:false,
  openAiRequests:0,
  imageCostUsd:0
},null,2));
