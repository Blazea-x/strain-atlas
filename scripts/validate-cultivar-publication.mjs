import fs from 'node:fs';
import path from 'node:path';
import { evaluateCultivarPublicationGate } from './content-production-state.mjs';

const ROOT=process.cwd();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const exists=file=>fs.existsSync(file);
const listJson=dir=>exists(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>path.join(dir,name)):[];
const deepSourceRefs=(value,out=new Set())=>{
  if(Array.isArray(value)){for(const item of value)deepSourceRefs(item,out);return out;}
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value.sourceRefs))for(const id of value.sourceRefs)out.add(id);
  for(const nested of Object.values(value))deepSourceRefs(nested,out);
  return out;
};
const localPathExists=src=>{
  const clean=String(src||'').split(/[?#]/)[0];
  if(!clean)return false;
  if(/^https?:\/\//i.test(clean))return true;
  return exists(path.join(ROOT,clean));
};
const sameVisualMetadata=(visual,manifest)=>{
  if(!visual||!manifest)return false;
  if(visual.src!==manifest.expectedPrimaryPath)return false;
  return ['alt','rights','scope','aiGenerated','sourceType'].every(key=>visual[key]===manifest.visualMetadataSnapshot?.[key]);
};
const DATA_VALID_PHASES=new Set(['DATA_READY','IMAGE_PENDING','IMAGE_READY','VISUAL_LINKED','PUBLISHED','NEEDS_REVIEW']);

const publication=readJson(path.join(ROOT,'production/publication.json'));
const strains=new Map();
for(const dirent of fs.readdirSync(path.join(ROOT,'strains'),{withFileTypes:true})){
  if(!dirent.isDirectory())continue;
  const file=path.join(ROOT,'strains',dirent.name,'strain.json');
  if(exists(file)){const strain=readJson(file);strains.set(strain.id,strain);}
}
const sources=new Set(listJson(path.join(ROOT,'sources')).map(file=>readJson(file).id));
const entities=new Set(listJson(path.join(ROOT,'entities')).map(file=>readJson(file).id));
const manifests=listJson(path.join(ROOT,'production/manifests')).map(readJson);
const manifestById=new Map(manifests.map(manifest=>[manifest.manifestId,manifest]));
const latestManifestFor=id=>manifests.filter(manifest=>manifest.strainId===id).sort((a,b)=>(b.revision||0)-(a.revision||0)||(b.attempt||0)-(a.attempt||0))[0]||null;
const runItems=new Map();
for(const file of listJson(path.join(ROOT,'production/runs'))){
  const run=readJson(file);
  for(const item of run.items||[])runItems.set(`${run.runId}\u0000${item.strainId}`,{run,item});
}

const errors=[];
let checked=0,dataFirstNoImage=0,imageBearing=0;
for(const entry of publication.entries||[]){
  if(entry.origin!=='content-production'||entry.state!=='published')continue;
  checked+=1;
  const strain=strains.get(entry.strainId)||null;
  const runItem=entry.introducedByRun?runItems.get(`${entry.introducedByRun}\u0000${entry.strainId}`):null;
  const manifest=runItem?.item?.manifestId?manifestById.get(runItem.item.manifestId)||null:latestManifestFor(entry.strainId);
  const primary=(strain?.visuals||[]).filter(visual=>visual.role==='primary');
  const sourceEntityClosureValid=Boolean(strain)
    && [...deepSourceRefs(strain)].every(id=>sources.has(id))
    && (strain.relations||[]).every(relation=>entities.has(relation.entityId));
  const primaryExists=primary.length===1&&localPathExists(primary[0].src);
  const visualLinkageValid=primary.length===1&&sameVisualMetadata(primary[0],manifest);
  const cultivarValidationPass=Boolean(runItem&&DATA_VALID_PHASES.has(runItem.item.productionPhase));
  const gate=evaluateCultivarPublicationGate({strain,manifest,primaryExists,sourceEntityClosureValid,visualLinkageValid,cultivarValidationPass});
  if(!gate.ok)errors.push(`${entry.strainId}: UNAUTHORIZED_PUBLICATION_OPEN (${gate.blockers.join(', ')})`);
  else if(gate.mode==='data-first-no-image')dataFirstNoImage+=1;else imageBearing+=1;
}

console.log('CULTIVAR-LEVEL PUBLICATION GATE');
console.log(`content-production published cultivars checked: ${checked}`);
console.log(`image-bearing: ${imageBearing} / data-first no-image: ${dataFirstNoImage}`);
if(errors.length){for(const error of errors)console.error(`- ${error}`);process.exit(1);}
console.log('PASS: every content-production published cultivar satisfies the data-first publication gate; image-bearing cultivars also have a current human or AI-visual-QA approval.');
