import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { buildRuntimeSnapshot } from './build-runtime-data.mjs';
import { evaluateCultivarPublicationGate } from './content-production-state.mjs';

const ROOT=process.cwd();
const publication=JSON.parse(fs.readFileSync(path.join(ROOT,'production/publication.json'),'utf8'));
const targetIds=(publication.entries||[]).map(entry=>entry.strainId).sort().slice(0,5);
assert.equal(targetIds.length,5,'fixture requires at least five MASTER cultivars');

const approvedManifest=()=>({
  revision:1,
  attempt:1,
  approvalStatus:'approved',
  approvalType:'human-visual-review',
  approvedManifestRevision:1,
  approvedAttempt:1
});
const aiOnlyManifest=()=>({
  revision:1,
  attempt:1,
  approvalStatus:'approved',
  approvalType:'ai-visual-qa',
  approvedManifestRevision:1,
  approvedAttempt:1
});
const rejectedManifest=()=>({
  revision:1,
  attempt:1,
  approvalStatus:'rejected',
  approvalType:null,
  approvedManifestRevision:null,
  approvedAttempt:null
});
const fixture=[
  {id:targetIds[0],phase:'VISUAL_LINKED',strain:{id:targetIds[0],name:'Fixture A',visuals:[{role:'primary'}]},manifest:approvedManifest(),primaryExists:true,visualLinkageValid:true},
  {id:targetIds[1],phase:'IMAGE_PENDING',strain:{id:targetIds[1],name:'Fixture B',visuals:[]},manifest:aiOnlyManifest(),primaryExists:false,visualLinkageValid:false},
  {id:targetIds[2],phase:'VISUAL_LINKED',strain:{id:targetIds[2],name:'Fixture C',visuals:[{role:'primary'}]},manifest:approvedManifest(),primaryExists:true,visualLinkageValid:true},
  {id:targetIds[3],phase:'IMAGE_PENDING',strain:{id:targetIds[3],name:'Fixture D',visuals:[]},manifest:null,primaryExists:false,visualLinkageValid:false},
  {id:targetIds[4],phase:'NEEDS_REVIEW',strain:{id:targetIds[4],name:'Fixture E',visuals:[]},manifest:rejectedManifest(),primaryExists:false,visualLinkageValid:false}
];

for(const item of fixture){
  item.gate=evaluateCultivarPublicationGate({
    strain:item.strain,
    manifest:item.manifest,
    primaryExists:item.primaryExists,
    sourceEntityClosureValid:true,
    visualLinkageValid:item.visualLinkageValid,
    cultivarValidationPass:true
  });
}
const publishable=fixture.filter(item=>item.gate.ok).map(item=>item.id).sort();
const waiting=fixture.filter(item=>!item.gate.ok).map(item=>item.id).sort();
assert.deepEqual(publishable,[targetIds[0],targetIds[2]].sort(),'exactly two independent targets must pass publication gate');
assert.equal(waiting.length,3,'three image-incomplete/rejected targets must remain waiting');
assert.equal(fixture[1].gate.checks.humanApprovalCurrent,false,'AI-only approval must not satisfy production approval');

const publicationOverride=Object.fromEntries((publication.entries||[]).map(entry=>[entry.strainId,'pending']));
for(const id of publishable)publicationOverride[id]='published';
const candidate=buildRuntimeSnapshot({publicationOverride}).catalog;
const candidateIds=candidate.cultivars.map(cultivar=>cultivar.id).sort();
assert.deepEqual(candidateIds,publishable,'formal runtime builder must emit only the two independently published fixture targets');
for(const id of waiting)assert.equal(candidateIds.includes(id),false,`${id} must not enter runtime`);
for(const id of targetIds)assert.equal(fs.existsSync(path.join(ROOT,'strains',id,'strain.json')),true,`${id} formal data must remain present`);

console.log('DATA-FIRST / IMAGE-LATER READ-ONLY FIXTURE: PASS');
console.log(JSON.stringify({
  targets:5,
  publishable:publishable.length,
  imagePendingOrRejected:waiting.length,
  runtimeCultivars:candidateIds,
  formalDataRetained:targetIds.length,
  crossCultivarBlocking:false,
  aiOnlyApprovalAccepted:false,
  productionWrites:0
},null,2));
