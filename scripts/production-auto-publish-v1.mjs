#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { CONFIG, validatePhaseTransition } from './content-production-state.mjs';

const ROOT=process.cwd(), Q='medium', M='gpt-image-2';
const ex=p=>fs.existsSync(p);
const rd=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const dir=p=>fs.mkdirSync(p,{recursive:true});
const wr=(p,v)=>{dir(path.dirname(p));fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')};
const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const shaFile=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const git=a=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8'}).trim();
function args(a){const o={};for(const x of a){const s=x.slice(2),i=s.indexOf('=');o[i<0?s:s.slice(0,i)]=i<0?true:s.slice(i+1)}return o}
function policy(){
  const p=CONFIG.automaticProductionPolicy||{};
  if(p.enabled!==true||p.publicationModeDefault!=='auto'||p.dataFirstRetention!==true||p.imageGatedPublicVisibility!==true||p.dataFirstPublication!==false||p.quality!==Q||p.imageModel!==M||p.maxImageRequestsPerCultivar!==1||p.automaticImageRetry!==0||p.highQualityAutoEscalation!==false)throw Error('AUTO_PRODUCTION_POLICY_MISMATCH');
  return p;
}
function transition(item,to,t){
  const from=item.productionPhase;
  if(!validatePhaseTransition(from,to,item.previousStablePhase).ok)throw Error(`INVALID_PHASE ${from}->${to}`);
  item.audit=[...(item.audit||[]),{severity:'INFO',code:'PHASE_TRANSITION',fromPhase:from,toPhase:to,at:t}];
  item.productionPhase=to;
  if(to!=='NEEDS_REVIEW')item.previousStablePhase=to;
  return item;
}
function toPublished(item,t){
  if(item.productionPhase==='NEEDS_REVIEW'){
    item.previousStablePhase='IMAGE_PENDING';
    if(!validatePhaseTransition('NEEDS_REVIEW','IMAGE_PENDING','IMAGE_PENDING').ok)throw Error('BAD_REVIEW_RESUME');
    item.audit=[...(item.audit||[]),{severity:'INFO',code:'PHASE_TRANSITION',fromPhase:'NEEDS_REVIEW',toPhase:'IMAGE_PENDING',previousStablePhase:'IMAGE_PENDING',at:t}];
    item.productionPhase='IMAGE_PENDING';
  }
  for(const p of ['IMAGE_READY','VISUAL_LINKED','PUBLISHED'])transition(item,p,t);
  return item;
}
function qaFail(item,t,reason){
  if(item.productionPhase==='IMAGE_PENDING')transition(item,'NEEDS_REVIEW',t);
  item.previousStablePhase='IMAGE_PENDING';
  item.audit=[...(item.audit||[]),{severity:'WARNING',code:'AI_VISUAL_QA_FAILED',at:t,reason}];
  return item;
}
function convert(src,dst){
  dir(path.dirname(dst));
  const p=spawnSync('python3',[path.join(ROOT,'scripts/process-image-upload-inbox.py'),'--convert-approved',src,dst],{encoding:'utf8'});
  if(p.status!==0)throw Error('IMAGE_PROCESSING_FAILED:'+String(p.stderr).slice(0,400));
  const meta=JSON.parse(p.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  const b=fs.readFileSync(dst);
  if(b.subarray(0,4).toString()!=='RIFF'||b.subarray(8,12).toString()!=='WEBP')throw Error('WEBP_INVALID');
  return{width:meta.width,height:meta.height,processedPrimarySha256:shaFile(dst),processedPrimaryBlobSha:git(['hash-object',dst])};
}
function buildReviewIndex(review){
  const pkg=rd(path.join(review,'review-package.json'));
  const map=new Map();
  for(const c of pkg.candidates||[])map.set(c.strainId,c);
  return{pkg,map};
}
function runLegacyVerifier({review,runId,strainId,binding,out}){
  const p=spawnSync('node',[path.join(ROOT,'scripts/one-click-production-approve-v1.mjs'),'verify',`--review-dir=${review}`,`--production-run-id=${runId}`,`--strain-id=${strainId}`,`--approval-binding=${binding}`,`--out=${out}`],{encoding:'utf8'});
  if(p.status!==0)return{status:'REJECTED',reason:String(p.stderr||p.stdout).slice(0,700)};
  const vf=path.join(out,'verification.json');
  return ex(vf)?rd(vf):{status:'REJECTED',reason:'VERIFICATION_OUTPUT_MISSING'};
}
function normalizeReceipt(a){
  const file=a.receipt;
  if(!file||!ex(file))throw Error('RECEIPT_NOT_FOUND');
  const r=rd(file);
  r.aiQaStatus='PENDING';
  r.aiQaBasis='pending-local-clip-semantic-v1';
  r.aiQaNormalizedAt=now();
  wr(file,r);
  console.log(JSON.stringify({strainId:r.strainId,aiQaStatus:r.aiQaStatus,aiQaBasis:r.aiQaBasis}));
}

export function decideFixture(items){
  return items.map(x=>{
    const imageGatePass=x.candidateStatus==='OK'&&x.aiQaStatus==='PASS';
    return{
      strainId:x.strainId,
      formalDataRetained:true,
      publicationState:imageGatePass?'published':'pending',
      runtimeVisible:imageGatePass,
      backlog:!imageGatePass
    };
  });
}

function apply(a){
  const pol=policy();
  const phase=rd(a['phase-b']),runId=phase.productionRunId,review=a['review-dir'],qaRoot=a['qa-root'],stage=a['stage-root']||path.join(ROOT,'.tmp-auto-publish-stage');
  fs.rmSync(stage,{recursive:true,force:true});dir(stage);
  const runPath=path.join(ROOT,'production/runs',runId+'.json');
  if(!ex(runPath))throw Error('RUN_NOT_FOUND');
  const run=rd(runPath),pubPath=path.join(ROOT,'production/publication.json'),pub=rd(pubPath),reviewIdx=buildReviewIndex(review),t=now();
  const publishedWithImage=[],retainedUnpublished=[],backlog=[],failed=[];

  for(const cp of phase.items){
    const id=cp.strainId,ii=(run.items||[]).findIndex(x=>x.strainId===id),pi=(pub.entries||[]).findIndex(x=>x.strainId===id);
    if(ii<0||pi<0){failed.push({strainId:id,reason:'CURRENT_TARGET_MISSING'});continue}
    const sPath=path.join(ROOT,'strains',id,'strain.json'),mPath=path.join(ROOT,'production/manifests',id+'.json');
    if(!ex(sPath)||!ex(mPath)){
      pub.entries[pi]={...pub.entries[pi],state:'pending'};
      failed.push({strainId:id,reason:'FORMAL_DATA_OR_MANIFEST_MISSING'});continue;
    }
    const strain=rd(sPath),manifest=rd(mPath);
    if(manifest.runId!==runId||manifest.revision!==cp.manifestRevision||manifest.attempt!==cp.attempt){
      pub.entries[pi]={...pub.entries[pi],state:'pending'};
      failed.push({strainId:id,reason:'STALE_MANIFEST'});continue;
    }
    const qaPath=path.join(qaRoot,id+'.json'),qa=ex(qaPath)?rd(qaPath):{status:'FAIL',reason:'QA_RESULT_MISSING'};
    const rc=reviewIdx.map.get(id);
    let imageApplied=false,reason=null;

    if(qa.status==='PASS'&&rc){
      const verifyOut=path.join(stage,'verify',id);
      const v=runLegacyVerifier({review,runId,strainId:id,binding:rc.approvalBindingSha256,out:verifyOut});
      if(v.status==='VERIFIED'){
        const rec=rd(path.join(review,'receipts',id+'.json'));
        if(rec.model!==M||rec.quality!==Q||rec.maximumRequestsForCultivar!==1||rec.automaticRetry!==0){
          reason='COST_POLICY_MISMATCH';
        }else{
          const src=path.join(review,'candidates',id+'.jpg');
          if(shaFile(src)!==rec.candidateSha256){
            reason='CANDIDATE_SHA_MISMATCH';
          }else{
            try{
              const staged=path.join(stage,'webp',id+'.webp'),meta=convert(src,staged),dst=path.join(ROOT,manifest.expectedPrimaryPath);
              dir(path.dirname(dst));fs.copyFileSync(staged,dst);
              Object.assign(manifest,{
                approvalStatus:pol.autoApprovalStatus||'auto-approved',
                approvalType:pol.aiVisualQaApprovalType||'ai-visual-qa',
                approvedAt:t,
                approvedManifestRevision:manifest.revision,
                approvedAttempt:manifest.attempt,
                approvedSourceSha256:rec.candidateSha256,
                imageInboxCommit:'not-applicable:production-auto-publish-v1-direct',
                imageProcessingCommit:a['base-sha']||git(['rev-parse','HEAD']),
                processedPrimaryBlobSha:meta.processedPrimaryBlobSha,
                processedPrimarySha256:meta.processedPrimarySha256,
                width:meta.width,
                height:meta.height,
                processingRoute:'production-auto-publish-v1-direct',
                processingSourceArtifact:path.basename(review),
                aiVisualQa:qa
              });
              manifest.audit=[...(manifest.audit||[]),
                {severity:'INFO',code:'AI_VISUAL_QA_PASS_AUTO_APPROVAL',at:t,approvalType:manifest.approvalType,qaEngine:qa.engine,qaModel:qa.model,candidateSha256:rec.candidateSha256},
                {severity:'INFO',code:'PRIMARY_PROCESSED_INTERNAL',at:t,processingRoute:manifest.processingRoute,processedPrimarySha256:meta.processedPrimarySha256,width:meta.width,height:meta.height}
              ];
              strain.visuals=[{role:'primary',src:manifest.expectedPrimaryPath,...manifest.visualMetadataSnapshot},...(strain.visuals||[]).filter(x=>x.role!=='primary')];
              run.items[ii]=toPublished(run.items[ii],t);
              run.items[ii].approval={status:manifest.approvalStatus,approvalType:manifest.approvalType,approvedAt:t,candidateSha256:rec.candidateSha256,aiVisualQa:{status:'PASS',engine:qa.engine,model:qa.model}};
              pub.entries[pi]={...pub.entries[pi],state:'published',publishedAt:pub.entries[pi].state==='published'?(pub.entries[pi].publishedAt||t):t,unpublishedAt:null,unpublicationReason:null};
              wr(mPath,manifest);wr(sPath,strain);
              imageApplied=true;publishedWithImage.push(id);
            }catch(e){reason=String(e.message||e)}
          }
        }
      }else reason=v.reason||'CANDIDATE_VERIFICATION_FAILED';
    }else reason=qa.status==='FAIL'?(qa.reason||'AI_VISUAL_QA_FAIL'):'CANDIDATE_UNAVAILABLE';

    if(!imageApplied){
      strain.visuals=(strain.visuals||[]).filter(x=>x.role!=='primary');wr(sPath,strain);
      pub.entries[pi]={...pub.entries[pi],state:'pending',unpublishedAt:pub.entries[pi].state==='published'?t:(pub.entries[pi].unpublishedAt||null),unpublicationReason:reason||'image-gate-not-satisfied'};
      manifest.aiVisualQa=qa;
      if(qa.status==='FAIL'&&rc){
        manifest.approvalStatus='rejected';
        manifest.approvalType=pol.aiVisualQaApprovalType||'ai-visual-qa';
        manifest.audit=[...(manifest.audit||[]),{severity:'WARNING',code:'AI_VISUAL_QA_FAILED',at:t,qaEngine:qa.engine||null,qaModel:qa.model||null,reason}];
        wr(mPath,manifest);run.items[ii]=qaFail(run.items[ii],t,reason);
      }else{
        run.items[ii].audit=[...(run.items[ii].audit||[]),{severity:'WARNING',code:'IMAGE_GENERATION_OR_PROCESSING_BACKLOG',at:t,reason}];
        run.items[ii].productionPhase='IMAGE_PENDING';
        run.items[ii].previousStablePhase='IMAGE_PENDING';
      }
      retainedUnpublished.push(id);
      backlog.push({strainId:id,reason,productionPhase:run.items[ii].productionPhase,publicationState:'pending',manifestRevision:manifest.revision,attempt:manifest.attempt});
    }
  }

  wr(pubPath,pub);
  const publishedSet=pub.entries.filter(e=>e.state==='published').map(e=>e.strainId).sort();
  Object.assign(run,{
    status:'SUCCESS',updatedAt:t,finishedAt:t,currentBaseSha:a['base-sha']||git(['rev-parse','HEAD']),mainHeadAtEnd:a['main-head']||null,
    expectedPublicationDelta:publishedWithImage.sort(),publicationSetAtEnd:publishedSet,
    auditSummary:{mode:'auto',autoPublishedWithImage:publishedWithImage.sort(),dataFirstRetainedUnpublished:retainedUnpublished.sort(),backlogRetained:backlog,failedTargets:failed,aiVisualQaApprovalType:pol.aiVisualQaApprovalType,finalValidationRequired:true,imageGatedPublicVisibility:true}
  });
  wr(runPath,run);
  const out={status:failed.length?'PARTIAL':'PASS',productionRunId:runId,autoPublishedWithImage:publishedWithImage.sort(),formalDataRetainedUnpublished:retainedUnpublished.sort(),backlogRetained:backlog,failedTargets:failed,formalDataRetained:phase.items.length,crossCultivarBlocking:false,imageGatedPublicVisibility:true,quality:Q,model:M,maximumImageRequestsPerCultivar:1,automaticRetry:0,humanApprovalSpoofed:false,openAiRequestsDuringImplementation:0,imageCostUsdDuringImplementation:0,checkpoint:'AUTO_PUBLISH_TRANSACTION_PREPARED'};
  wr(a.out,out);console.log(JSON.stringify(out));
}

function fixture(a){
  const f=rd(a.fixture),out=a.out||'.tmp-auto-publish-v1-fixture';
  fs.rmSync(out,{recursive:true,force:true});dir(out);
  const rows=decideFixture(f.selected),published=rows.filter(x=>x.publicationState==='published').map(x=>x.strainId),pending=rows.filter(x=>x.publicationState==='pending').map(x=>x.strainId);
  const pass=JSON.stringify(published)==JSON.stringify(['fixture-a','fixture-b','fixture-e'])&&JSON.stringify(pending)==JSON.stringify(['fixture-c','fixture-d'])&&rows.every(x=>x.formalDataRetained)&&rows.filter(x=>x.backlog).every(x=>x.publicationState==='pending'&&!x.runtimeVisible);
  const r={fixture:'IMAGE_GATED_PUBLICATION_V1',status:pass?'PASS':'FAIL',formalDataRetained:rows.map(x=>x.strainId),published,runtimeVisible:rows.filter(x=>x.runtimeVisible).map(x=>x.strainId),pending,backlog:rows.filter(x=>x.backlog).map(x=>x.strainId),crossCultivarBlocking:false,quality:Q,oneImageRequestPerCultivar:true,automaticRetry:0,openAiRequests:0,imageCostUsd:0};
  wr(path.join(out,'fixture-result.json'),r);console.log(JSON.stringify(r,null,2));if(!pass)process.exitCode=1;
}

const[c,...rest]=process.argv.slice(2),a=args(rest);
try{
  if(c==='apply')apply(a);
  else if(c==='normalize-receipt')normalizeReceipt(a);
  else if(c==='fixture')fixture(a);
  else console.log('PRODUCTION AUTO PUBLISH V1: apply | normalize-receipt | fixture');
}catch(e){console.error('PRODUCTION_AUTO_PUBLISH_V1_ERROR:',e.stack||e);process.exitCode=1}
