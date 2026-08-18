import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildRuntimeSnapshot } from './build-runtime-data.mjs';
import { CONFIG, validatePhaseTransition, approvalMatches, visualPreparationHash } from './content-production-state.mjs';

const ROOT=process.cwd();
const args=process.argv.slice(2);
const jsonOut=args.includes('--json');
const mainArg=args.find(x=>x.startsWith('--main-dir='));
const MAIN_DIR=mainArg?path.resolve(mainArg.slice('--main-dir='.length)):null;
const findings=[];
const add=(code,message,context={})=>findings.push({severity:CONFIG.auditSeverity[code]||'ERROR',code,message,...context});
const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const exists=f=>fs.existsSync(f);
const jsonFiles=dir=>exists(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>path.join(dir,n)):[];
const strainFiles=()=>exists(path.join(ROOT,'strains'))?fs.readdirSync(path.join(ROOT,'strains'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(ROOT,'strains',e.name,'strain.json')).filter(exists):[];
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
const sha256File=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const deepRefs=(v,out=new Set())=>{if(Array.isArray(v)){for(const x of v)deepRefs(x,out);return out}if(v&&typeof v==='object'){if(Array.isArray(v.sourceRefs))for(const x of v.sourceRefs)out.add(x);for(const x of Object.values(v))deepRefs(x,out)}return out};
function loadUnique(files,kind){const map=new Map();for(const f of files){let x;try{x=readJson(f)}catch(e){add(kind==='strain'?'DUPLICATE_STRAIN_ID':kind==='source'?'SOURCE_ID_CONFLICT':'ENTITY_ID_CONFLICT',`cannot parse ${f}: ${e.message}`);continue}if(map.has(x.id))add(kind==='strain'?'DUPLICATE_STRAIN_ID':kind==='source'?'SOURCE_ID_CONFLICT':'ENTITY_ID_CONFLICT',`duplicate ${kind} id ${x.id}`,{files:[map.get(x.id).__file,f]});x.__file=f;map.set(x.id,x)}return map}
const strains=loadUnique(strainFiles(),'strain');
const sources=loadUnique(jsonFiles(path.join(ROOT,'sources')),'source');
const entities=loadUnique(jsonFiles(path.join(ROOT,'entities')),'entity');
const publicationPath=path.join(ROOT,'production/publication.json');
let publication={schemaVersion:null,entries:[]};
try{publication=readJson(publicationPath)}catch(e){add('UNSUPPORTED_SCHEMA_VERSION',`publication unreadable: ${e.message}`)}
if(publication.schemaVersion!==1)add('UNSUPPORTED_SCHEMA_VERSION',`publication schemaVersion ${publication.schemaVersion} unsupported`);
const pub=new Map();
for(const e of publication.entries||[]){if(pub.has(e.strainId))add('ILLEGAL_PUBLICATION_TRANSITION',`duplicate publication entry ${e.strainId}`);pub.set(e.strainId,e);if(!strains.has(e.strainId))add('ORPHAN_PUBLICATION_ENTRY',`${e.strainId} has publication entry but no strain.json`)}
for(const id of strains.keys())if(!pub.has(id))add('MISSING_PUBLICATION_ENTRY',`${id} has MASTER strain but no publication entry`);
const names=new Map(); const aliasOwner=new Map();
for(const s of strains.values()){
  const n=norm(s.name);if(names.has(n)&&names.get(n)!==s.id)add('CONFIRMED_DUPLICATE_CULTIVAR',`${s.id} and ${names.get(n)} share canonical name ${s.name}`);else names.set(n,s.id);
  for(const label of [s.name,...(s.aliases||[])]){const k=norm(label);if(!k)continue;if(aliasOwner.has(k)&&aliasOwner.get(k)!==s.id)add('ALIAS_COLLISION_REVIEW',`${s.id} collides with ${aliasOwner.get(k)} on normalized alias ${label}`);else aliasOwner.set(k,s.id)}
  for(const ref of deepRefs(s))if(!sources.has(ref))add('SOURCE_REF_MISSING',`${s.id} references missing source ${ref}`);
  for(const r of s.relations||[])if(!entities.has(r.entityId))add('ENTITY_REF_MISSING',`${s.id} references missing entity ${r.entityId}`);
}
const urls=new Map();for(const s of sources.values()){const u=String(s.url||'').trim();if(!u)continue;if(urls.has(u)&&urls.get(u)!==s.id)add('SOURCE_URL_DUPLICATE',`${s.id} and ${urls.get(u)} share URL`,{url:u});else urls.set(u,s.id)}
const entityNames=new Map();for(const e of entities.values()){const n=norm(e.canonicalName||e.name);if(!n)continue;if(entityNames.has(n)&&entityNames.get(n)!==e.id)add('ENTITY_DUPLICATE_REVIEW',`${e.id} and ${entityNames.get(n)} share normalized canonicalName/name`);else entityNames.set(n,e.id)}
const runFiles=jsonFiles(path.join(ROOT,'production/runs'));
const active=new Set(CONFIG.activeRunStatuses);const activeStrains=new Map(),activeStocks=new Map(),activeBlobs=new Map();
for(const f of runFiles){let run;try{run=readJson(f)}catch(e){add('RUN_RECORD_STALE',`run unreadable ${f}: ${e.message}`);continue}if(run.schemaVersion!==1||run.runVersion!==1){add('UNSUPPORTED_SCHEMA_VERSION',`${f} has unsupported run version`);continue}
  for(const item of run.items||[]){if(item.audit?.some(a=>a.fromPhase&&a.toPhase)){for(const a of item.audit){if(a.fromPhase&&a.toPhase&&!validatePhaseTransition(a.fromPhase,a.toPhase,a.previousStablePhase).ok)add('INVALID_PHASE_TRANSITION',`${run.runId}/${item.strainId}: ${a.fromPhase} -> ${a.toPhase}`)}}
    if(active.has(run.status)){if(activeStrains.has(item.strainId))add('ACTIVE_RUN_CONFLICT',`${item.strainId} active in ${activeStrains.get(item.strainId)} and ${run.runId}`);else activeStrains.set(item.strainId,run.runId);if(item.sourceStockPath){if(activeStocks.has(item.sourceStockPath))add('ACTIVE_STOCK_CONFLICT',`${item.sourceStockPath} active in multiple runs`);else activeStocks.set(item.sourceStockPath,run.runId)}if(item.sourceStockBlobSha){if(activeBlobs.has(item.sourceStockBlobSha))add('ACTIVE_STOCK_CONFLICT',`${item.sourceStockBlobSha} active in multiple runs`);else activeBlobs.set(item.sourceStockBlobSha,run.runId)}}
    if(item.productionStrainPath&&!exists(path.join(ROOT,item.productionStrainPath))&&item.productionPhase!=='STOCKED')add('PRODUCTION_STRAIN_MISSING',`${run.runId}/${item.strainId} expected ${item.productionStrainPath}`);
  }}
const stocks=jsonFiles(path.join(ROOT,'stock/items'));const stockIds=[];const promoted=[];
for(const f of stocks){const id=path.basename(f,'.json');stockIds.push(id);if(strains.has(id)){promoted.push(id);add('ALREADY_PROMOTED_STOCK',`${id} exists in STOCK and MASTER; allowed history, exclude from new promotion`,{sourceStockPath:path.relative(ROOT,f)})}}
const manifests=new Map();for(const f of jsonFiles(path.join(ROOT,'production/manifests'))){let m;try{m=readJson(f)}catch(e){add('IMAGE_MANIFEST_MISMATCH',`manifest unreadable ${f}: ${e.message}`);continue}if(m.schemaVersion!==1||m.manifestVersion!==1){add('UNSUPPORTED_SCHEMA_VERSION',`${f} has unsupported manifest version`);continue}manifests.set(m.manifestId,m);if(m.visualPreparationHash!==visualPreparationHash({promptSnapshot:m.promptSnapshot,evidenceSnapshot:m.evidenceSnapshot,visualMetadataSnapshot:m.visualMetadataSnapshot}))add('IMAGE_MANIFEST_MISMATCH',`${m.manifestId} visualPreparationHash mismatch`);if(m.approvalStatus==='approved'&&!approvalMatches(m))add('STALE_IMAGE_ATTEMPT',`${m.manifestId} approval is not bound to current revision/attempt`)}
for(const s of strains.values()){
  const prim=(s.visuals||[]).filter(v=>v.role==='primary');const entry=pub.get(s.id);const strict=entry?.origin==='content-production';
  if(strict&&prim.length!==1)add('PRIMARY_COUNT_INVALID',`${s.id} has ${prim.length} primary visuals`);
  for(const v of prim){const fp=path.join(ROOT,String(v.src||'').split(/[?#]/)[0]);if(!/^https?:\/\//.test(v.src||'')&&!exists(fp))add('BROKEN_PRIMARY_REFERENCE',`${s.id} primary missing: ${v.src}`)}
  const standard=path.join(ROOT,'strains',s.id,'images/generated/primary.webp');if(exists(standard)&&!prim.some(v=>String(v.src||'').split(/[?#]/)[0]===`strains/${s.id}/images/generated/primary.webp`))add('ORPHAN_PRIMARY',`${s.id} has primary.webp not referenced by visuals`);
  if(strict&&prim.length===1){const m=[...manifests.values()].filter(x=>x.strainId===s.id).sort((a,b)=>b.revision-a.revision||b.attempt-a.attempt)[0];if(!m)add('IMAGE_MANIFEST_MISMATCH',`${s.id} content-production visual has no manifest`);else{if(prim[0].src!==m.expectedPrimaryPath)add('VISUAL_METADATA_MISMATCH',`${s.id} primary src differs from manifest`);for(const k of ['alt','rights','scope','aiGenerated','sourceType'])if(prim[0][k]!==m.visualMetadataSnapshot?.[k])add('VISUAL_METADATA_MISMATCH',`${s.id} visual ${k} differs from manifest`);if(!m.imageInboxCommit)add('IMAGE_INBOX_COMMIT_MISSING',`${m.manifestId} imageInboxCommit missing`);if(!m.imageProcessingCommit)add('IMAGE_PROCESSING_COMMIT_MISSING',`${m.manifestId} imageProcessingCommit missing`);const fp=path.join(ROOT,m.expectedPrimaryPath||'');if(!exists(fp))add('IMAGE_FILE_MISSING',`${m.manifestId} primary file missing`);else{const b=fs.readFileSync(fp);if(b.length<12||b.subarray(0,4).toString()!=='RIFF'||b.subarray(8,12).toString()!=='WEBP')add('INVALID_WEBP_SIGNATURE',`${m.manifestId} primary is not RIFF/WEBP`);if(m.processedPrimarySha256&&sha256File(fp)!==m.processedPrimarySha256)add('IMAGE_DIGEST_MISMATCH',`${m.manifestId} processed digest mismatch`)}}}
}
const inbox=path.join(ROOT,'uploads/images');const inboxFiles=exists(inbox)?fs.readdirSync(inbox).filter(n=>n!=='.gitkeep'&&!n.startsWith('.')):[];if(inboxFiles.length)add('FAILED_INBOX_PENDING',`uploads/images contains ${inboxFiles.join(', ')}`);
let candidate=null,current=null,runtimeDiff={cultivarIds:[],cultivars:false,visuals:false,sources:false,entities:false};
try{candidate=buildRuntimeSnapshot().catalog;current=readJson(path.join(ROOT,'runtime/catalog.json'));const cids=current.cultivars.map(x=>x.id).sort(),nids=candidate.cultivars.map(x=>x.id).sort();runtimeDiff.cultivarIds=[...new Set([...cids,...nids])].filter(x=>!cids.includes(x)||!nids.includes(x));if(runtimeDiff.cultivarIds.length)add('PUBLICATION_SET_MISMATCH',`runtime cultivar set differs from publication-filtered candidate: ${runtimeDiff.cultivarIds.join(', ')}`);const j=x=>JSON.stringify(x);runtimeDiff.cultivars=j(current.cultivars)!==j(candidate.cultivars);runtimeDiff.visuals=j(current.cultivars.map(x=>[x.id,x.visuals]))!==j(candidate.cultivars.map(x=>[x.id,x.visuals]));runtimeDiff.sources=j(current.sources)!==j(candidate.sources);runtimeDiff.entities=j(current.entities)!==j(candidate.entities);if(runtimeDiff.cultivars)add('RUNTIME_TARGET_MISSING','current cultivar payload differs from publication-filtered candidate');if(runtimeDiff.visuals)add('RUNTIME_VISUAL_MISMATCH','current visuals differ from publication-filtered candidate');if(runtimeDiff.sources||runtimeDiff.entities)add('PUBLICATION_SET_MISMATCH','current source/entity payload differs from published closure');}catch(e){add('CANDIDATE_BUILD_FAILED',e.message)}
let mainAudit={performed:false};if(MAIN_DIR&&exists(MAIN_DIR)){mainAudit.performed=true;const targetIds=new Set([...strains.keys(),...stockIds]);const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()&&!p.includes(`${path.sep}.git`))walk(p);else if(e.isFile()){const rel=path.relative(MAIN_DIR,p).replaceAll('\\','/');const ext=path.extname(e.name).toLowerCase();if(['.jpg','.jpeg','.png','.webp'].includes(ext)){for(const id of targetIds){if(rel.includes(id)&&!rel.startsWith('images/hero')&&!rel.startsWith('assets/'))add('MAIN_PRODUCTION_ASSET_VIOLATION',`${id} production-like asset found on main: ${rel}`)}}}}};walk(MAIN_DIR)}
const counts={ERROR:0,WARNING:0,INFO:0};for(const f of findings)counts[f.severity]=(counts[f.severity]||0)+1;
const report={system:'CONTENT_PRODUCTION_V1',dryRun:true,generatedAt:new Date().toISOString(),counts,sets:{publicRuntime:(current?.cultivars||[]).map(x=>x.id).sort(),master:[...strains.keys()].sort(),grandfathered:(publication.entries||[]).filter(e=>e.origin==='grandfathered').map(e=>e.strainId).sort(),stock:stockIds.sort(),stockMasterOverlap:promoted.sort()},runtimeDiff,inboxFiles,mainAudit,findings};
if(jsonOut)console.log(JSON.stringify(report,null,2));else{console.log('CONTENT PRODUCTION V1 READ-ONLY DRY RUN');console.log(`public=${report.sets.publicRuntime.length} master=${report.sets.master.length} publication=${publication.entries?.length||0} stock=${stockIds.length}`);console.log(`ERROR=${counts.ERROR} WARNING=${counts.WARNING} INFO=${counts.INFO}`);for(const f of findings)console.log(`[${f.severity}] ${f.code}: ${f.message}`);console.log(`PUBLIC_SET_IDENTICAL=${runtimeDiff.cultivarIds.length===0}`);console.log(`PAYLOAD_IDENTICAL=${!runtimeDiff.cultivars&&!runtimeDiff.visuals&&!runtimeDiff.sources&&!runtimeDiff.entities}`)}
if(counts.ERROR>0)process.exit(1);
