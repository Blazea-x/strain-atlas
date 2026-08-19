import fs from 'node:fs';
import path from 'node:path';
import { approvalMatches, inferStablePhase } from './content-production-state.mjs';

const ROOT=process.cwd();
const jsonOut=process.argv.includes('--json');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const exists=file=>fs.existsSync(file);
const listJson=dir=>exists(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>path.join(dir,name)):[];
const localExists=src=>{
  const clean=String(src||'').split(/[?#]/)[0];
  if(!clean)return false;
  if(/^https?:\/\//i.test(clean))return true;
  return exists(path.join(ROOT,clean));
};
const manifestStatus=manifest=>{
  if(!manifest)return 'MISSING';
  if(manifest.approvalStatus==='approved')return approvalMatches(manifest)?'APPROVED_CURRENT':'APPROVED_STALE';
  if(manifest.approvalStatus==='rejected')return 'REJECTED';
  return 'PENDING';
};
const lastReviewResult=manifest=>{
  if(!manifest)return 'NONE';
  const review=[...(manifest.audit||[])].reverse().find(event=>String(event.action||'').includes('REVIEW'));
  if(review)return `${review.action}:${review.status||'unknown'}`;
  if(manifest.reviewStatus)return `VISUAL_QA_REVIEW:${manifest.reviewStatus}`;
  return `APPROVAL:${manifest.approvalStatus||'unknown'}`;
};

const publication=readJson(path.join(ROOT,'production/publication.json'));
const pubById=new Map((publication.entries||[]).map(entry=>[entry.strainId,entry]));
const manifests=listJson(path.join(ROOT,'production/manifests')).map(readJson);
const manifestById=new Map(manifests.map(manifest=>[manifest.manifestId,manifest]));
const latestManifestFor=id=>manifests.filter(manifest=>manifest.strainId===id).sort((a,b)=>(b.revision||0)-(a.revision||0)||(b.attempt||0)-(a.attempt||0))[0]||null;
const runItems=new Map();
for(const file of listJson(path.join(ROOT,'production/runs'))){
  const run=readJson(file);
  for(const item of run.items||[])runItems.set(`${run.runId}\u0000${item.strainId}`,item);
}

const rows=[];
for(const dirent of fs.readdirSync(path.join(ROOT,'strains'),{withFileTypes:true})){
  if(!dirent.isDirectory())continue;
  const file=path.join(ROOT,'strains',dirent.name,'strain.json');
  if(!exists(file))continue;
  const strain=readJson(file);
  const entry=pubById.get(strain.id);
  if(!entry||entry.origin!=='content-production'||entry.state!=='pending')continue;
  const runItem=entry.introducedByRun?runItems.get(`${entry.introducedByRun}\u0000${strain.id}`):null;
  const manifest=runItem?.manifestId?manifestById.get(runItem.manifestId)||null:latestManifestFor(strain.id);
  const primary=(strain.visuals||[]).filter(visual=>visual.role==='primary');
  const expectedPrimary=manifest?.expectedPrimaryPath||primary[0]?.src||`strains/${strain.id}/images/generated/primary.webp`;
  const primaryExists=localExists(expectedPrimary);
  const inferred=inferStablePhase({strain,publicationEntry:entry,manifest,primaryExists});
  rows.push({
    strainId:strain.id,
    name:strain.name,
    productionPhase:runItem?.productionPhase||inferred,
    publicationState:entry.state,
    visualsCount:(strain.visuals||[]).length,
    manifestStatus:manifestStatus(manifest),
    lastImageReviewResult:lastReviewResult(manifest)
  });
}
rows.sort((a,b)=>a.strainId.localeCompare(b.strainId,'en'));

if(jsonOut){
  console.log(JSON.stringify(rows,null,2));
}else{
  const columns=['strainId','name','productionPhase','publicationState','visualsCount','manifestStatus','lastImageReviewResult'];
  console.log(columns.join('\t'));
  for(const row of rows)console.log(columns.map(column=>String(row[column]??'')).join('\t'));
}
