import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const listJson = dir => fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.json')).map(e=>path.join(dir,e.name)) : [];
const unique = values => [...new Set(values.filter(Boolean))];

function deepSourceRefs(value,out=new Set()) {
  if (Array.isArray(value)) { for (const v of value) deepSourceRefs(v,out); return out; }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value.sourceRefs)) for (const id of value.sourceRefs) out.add(id);
  for (const v of Object.values(value)) deepSourceRefs(v,out);
  return out;
}

export function buildRuntimeSnapshot({root=ROOT, publicationOverride=null}={}) {
  const strainRoot=path.join(root,'strains');
  const allCultivars=fs.readdirSync(strainRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(strainRoot,e.name,'strain.json')).filter(fs.existsSync).map(readJson);
  const sourceRecords=listJson(path.join(root,'sources')).map(readJson);
  const entityRecords=listJson(path.join(root,'entities')).map(readJson);
  const publication=readJson(path.join(root,'production/publication.json'));
  if (publication.schemaVersion !== 1) throw new Error('UNSUPPORTED_SCHEMA_VERSION: publication');
  const stateById=new Map(publication.entries.map(e=>[e.strainId, publicationOverride?.[e.strainId] || e.state]));
  const cultivars=allCultivars.filter(c=>stateById.get(c.id)==='published').sort((a,b)=>a.name.localeCompare(b.name,'en'));
  const sourceIds=new Set(); const entityIds=new Set();
  for (const c of cultivars) { for (const id of deepSourceRefs(c)) sourceIds.add(id); for (const rel of c.relations||[]) if (rel.entityId) entityIds.add(rel.entityId); }
  const publicSources=sourceRecords.filter(s=>sourceIds.has(s.id));
  const publicEntities=entityRecords.filter(e=>entityIds.has(e.id));
  const sources=Object.fromEntries(publicSources.map(s=>[s.id,s]));
  const entities=Object.fromEntries(publicEntities.map(e=>[e.id,e]));
  const exploreMap={"sativa":"sativa","sativa-dominant-hybrid":"sativa","indica":"indica","indica-dominant-hybrid":"indica","hybrid":"hybrid","balanced-hybrid":"hybrid","unknown":"unclassified"};
  const explore={sativa:[],indica:[],hybrid:[],unclassified:[]};
  for (const c of cultivars) explore[exploreMap[c.classification?.type]??'unclassified'].push(c.id);
  const catalog={schemaVersion:1,generatedAt:new Date().toISOString(),sourceOfTruth:{cultivars:'strains/<id>/strain.json',sources:'sources/*.json',entities:'entities/*.json'},counts:{cultivars:cultivars.length,sources:publicSources.length,entities:publicEntities.length},explore,cultivars,sources,entities};
  return {catalog,cultivars,sourceRecords:publicSources,entityRecords:publicEntities,sources,entities};
}

const typeLabels={"sativa":"サティバ","sativa-dominant-hybrid":"サティバ優勢","indica":"インディカ","indica-dominant-hybrid":"インディカ優勢","hybrid":"ハイブリッド","balanced-hybrid":"ハイブリッド","unknown":"未分類"};
const sourceRefsFor=c=>unique([...(c.lineage?.sourceRefs||[]),...(c.aromas?.sourceRefs||[]),...(c.terpenes?.sourceRefs||[]),...(c.origin?.sourceRefs||[]),...(c.history?.sourceRefs||[]),...(c.relations||[]).flatMap(r=>r.sourceRefs||[])]);
const confidenceFor=c=>{const parts=[];const add=(l,s)=>{if(s?.confidence)parts.push(`${l} ${s.confidence}`)};add('LINEAGE',c.lineage);add('AROMA',c.aromas);add('TERPENE',c.terpenes);add('ORIGIN',c.origin);add('HISTORY',c.history);return{display:parts.join(' / '),note:'正本データの項目別confidenceを表示'}};
function compatibility(snapshot){
  const {cultivars,entities,sourceRecords}=snapshot;
  const legacyStrains=cultivars.map(c=>{const r=(c.relations||[]).find(x=>(x.roles||[]).includes('breeder'))||(c.relations||[]).find(x=>(x.roles||[]).includes('seedCompany'));const e=r?entities[r.entityId]:null;const k=c.classification?.type||'unknown';return{id:c.id,name:c.name,jp:c.jp||'',type:{key:k,label:typeLabels[k]||k},aliases:c.aliases||[],identity:{scope:'cultivar',note:'品種一般の情報。特定ロット・製品・フェノタイプを示すものではありません。'},lineage:{display:c.lineage?.display||'',parents:c.lineage?.parents||[],note:c.lineage?.note||''},aromas:c.aromas?.items||[],breeder:{name:e?.name||'',era:''},terpenes:c.terpenes?.items||[],originHistory:c.origin?.text||'',history:c.history?.text||'',confidence:confidenceFor(c),visuals:(c.visuals||[]).map(v=>({...v,label:v.role==='primary'?'VISUAL REFERENCE':v.role==='aroma'?'AROMA VISUAL':String(v.role||'VISUAL').toUpperCase()})),sourceIds:sourceRefsFor(c),reviews:[]}});
  const sourceTypeMap={breederOfficial:{type:'primary',typeLabel:'一次情報'},specialistDatabase:{type:'specialist',typeLabel:'専門資料'},historicalSource:{type:'historical',typeLabel:'歴史資料'}};
  const legacySources=Object.fromEntries(sourceRecords.map(s=>{const m=sourceTypeMap[s.sourceType]||{type:s.sourceType||'source',typeLabel:'資料'};return[s.id,{name:[s.publisher,s.title].filter(Boolean).join(' — ')||s.id,url:s.url||'#',type:m.type,typeLabel:m.typeLabel,checked:s.checkedAt||'',supports:s.supports||[]}]}));
  return {data:`window.STRAINS=${JSON.stringify(legacyStrains,null,2)};\n`,sources:`window.SOURCES=${JSON.stringify(legacySources,null,2)};\n`};
}

export function writeRuntime({root=ROOT}={}) { const snap=buildRuntimeSnapshot({root}); const out=path.join(root,'runtime');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify(snap.catalog,null,2)+'\n');const c=compatibility(snap);fs.writeFileSync(path.join(root,'data.js'),c.data);fs.writeFileSync(path.join(root,'sources.js'),c.sources);console.log(`Built publication-filtered runtime: ${snap.cultivars.length} cultivars / ${snap.sourceRecords.length} sources / ${snap.entityRecords.length} entities`); }
if (fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) { if (process.argv.includes('--dry-run')) { const s=buildRuntimeSnapshot(); console.log(JSON.stringify(s.catalog,null,2)); } else writeRuntime(); }
