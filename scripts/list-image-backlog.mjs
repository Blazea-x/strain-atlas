import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvalMatches, inferStablePhase } from './content-production-state.mjs';

const ROOT=process.cwd();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const exists=file=>fs.existsSync(file);
const listJson=dir=>exists(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>path.join(dir,name)):[];
const localExists=(root,src)=>{const clean=String(src||'').split(/[?#]/)[0];if(!clean)return false;if(/^https?:\/\//i.test(clean))return true;return exists(path.join(root,clean));};
const manifestStatus=manifest=>{if(!manifest)return'MISSING';if(['approved','auto-approved'].includes(manifest.approvalStatus))return approvalMatches(manifest)?'APPROVED_CURRENT':'APPROVED_STALE';if(manifest.approvalStatus==='rejected')return'REJECTED';return'PENDING';};
const lastReviewEvent=manifest=>{if(!manifest)return null;return [...(manifest.audit||[])].reverse().find(event=>String(event.code||event.action||'').includes('REJECT')||String(event.code||event.action||'').includes('QA')||String(event.code||event.action||'').includes('BACKLOG'))||null;};
const failureReason=(manifest,runItem)=>{
  const event=lastReviewEvent(manifest);
  if(event)return event.reason||event.note||event.code||event.action||'recorded';
  const runEvent=[...(runItem?.audit||[])].reverse().find(event=>event.reason||String(event.code||'').includes('BACKLOG')||String(event.code||'').includes('QA'));
  if(runEvent)return runEvent.reason||runEvent.code;
  if(manifest?.rejectionReason)return manifest.rejectionReason;
  if(manifest?.aiVisualQa?.status&&manifest.aiVisualQa.status!=='PASS')return manifest.aiVisualQa.reason||`AI_VISUAL_QA_${manifest.aiVisualQa.status}`;
  return 'image-not-ready';
};
const lastImageReviewResult=manifest=>{if(!manifest)return'NONE';const review=lastReviewEvent(manifest);if(review)return`${review.code||review.action}:${review.status||review.reason||'recorded'}`;if(manifest.aiVisualQa?.status)return`AI_VISUAL_QA:${manifest.aiVisualQa.status}`;return`APPROVAL:${manifest.approvalStatus||'unknown'}`;};

export function buildImageBacklogRows({root=ROOT}={}){
  const publication=readJson(path.join(root,'production/publication.json'));
  const pubById=new Map(publication.entries||[]).map(entry=>[entry.strainId,entry]));
  const manifests=listJson(path.join(root,'production/manifests')).map(readJson);
  const manifestById=new Map(manifests.map(manifest=>[manifest.manifestId,manifest]));
  const latestManifestFor=id=>manifests.filter(manifest=>manifest.strainId===id).sort((a,b)=>(b.revision||0)-(a.revision||0)||(b.attempt||0)-(a.attempt||0))[0]||null;
  const runItems=new Map();
  for(const file of listJson(path.join(root,'production/runs'))){const run=readJson(file);for(const item of run.items||[])runItems.set(`${run.runId}\u0000${item.strainId}`,item);}
  const rows=[];
  for(const dirent of fs.readdirSync(path.join(root,'strains'),{withFileTypes:true})){
    if(!dirent.isDirectory())continue;
    const file=path.join(root,'strains',dirent.name,'strain.json');if(!exists(file))continue;
    const strain=readJson(file),entry=pubById.get(strain.id);if(!entry||entry.origin!=='content-production')continue;
    const runItem=entry.introducedByRun?runItems.get(`${entry.introducedByRun}\u0000${strain.id}`):null;
    const manifest=runItem?.manifestId?manifestById.get(runItem.manifestId)||null:latestManifestFor(strain.id);
    const primary=(strain.visuals||[]).filter(v=>v.role==='primary');
    const expectedPrimary=manifest?.expectedPrimaryPath||primary[0]?.src|p`strains/${strain.id}/images/generated/primary.webp`;
    const primaryExists=localExists(root,expectedPrimary);
    const inferred=inferStablePhase({strain,publicationEntry:entry,manifest,primaryExists});
    const phase=runItem?.productionPhase||inferred;
    const imageBacklog=primary.length===0||!primaryExists||['IMAGE_PENDING','NEEDS_REVIEW'].includes(phase)||manifest?.approvalStatus==='rejected'||entry.state!=='published';
    if(!imageBacklog)continue;
    rows.push({
      strainId:strain.id,
      name:strain.name,
      currentImageState:phase,
      productionPhase:phase,
      publicationState:entry.state,
      visualsCount:(strain.visuals||[]).length,
      manifestStatus:manifestStatus(manifest),
      manifestRevision:manifest?.revision??null,
      attempt:manifest?.attempt??null,
      failureReason:failureReason(manifest,runItem),
      lastImageReviewResult:lastImageReviewResult(manifest)
    });
  }
  return rows.sort((a,b)=>a.strainId.localeCompare(b.strainId,'en'));
}

if(fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const rows=buildImageBacklogRows();
  const jsonOut=process.argv.includes('--json');
  if(jsonOut)console.log(JSON.stringify(rows,null,2));
  else{
    const columns=['strainId','name','currentImageState','publicationState','visualsCount','manifestStatus','manifestRevision','attempt','failureReason','lastImageReviewResult'];
    console.log(columns.join('\t'));
    for(const row of rows)console.log(columns.map(column=>String(row[column]??'')).join('\t'));
  }
}
