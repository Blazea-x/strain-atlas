import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT,'production/_system/config.json'),'utf8'));
const stable = new Set(CONFIG.stablePhases);

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalize(value[k])]));
  return value;
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function visualPreparationHash({promptSnapshot,evidenceSnapshot,visualMetadataSnapshot}) {
  return sha256(canonicalJson({prompt:promptSnapshot,evidence:evidenceSnapshot,metadata:visualMetadataSnapshot}));
}
export function validatePhaseTransition(from,to,previousStablePhase=null) {
  if (from === to) return {ok:true,code:'IDEMPOTENT_NOOP'};
  const allowed = CONFIG.allowedPhaseTransitions[from] || [];
  if (!allowed.includes(to)) return {ok:false,code:'INVALID_PHASE_TRANSITION',from,to};
  if (from === 'NEEDS_REVIEW' && stable.has(to) && previousStablePhase !== to) return {ok:false,code:'INVALID_PHASE_TRANSITION',reason:'NEEDS_REVIEW may only resume at previousStablePhase',from,to,previousStablePhase};
  return {ok:true};
}
export function nextManifestVersion(current, nextVisualPreparation) {
  const hash = visualPreparationHash(nextVisualPreparation);
  if (!current) return {revision:1,attempt:1,visualPreparationHash:hash};
  if (current.visualPreparationHash === hash) return {revision:current.revision,attempt:current.attempt+1,visualPreparationHash:hash};
  return {revision:current.revision+1,attempt:1,visualPreparationHash:hash};
}
export function humanApprovalMatches(manifest) {
  const requiredType = CONFIG.imageGenerationPolicy?.requiredProductionApprovalType || 'human-visual-review';
  return Boolean(manifest)
    && manifest.approvalStatus === 'approved'
    && manifest.approvalType === requiredType
    && manifest.approvedManifestRevision === manifest.revision
    && manifest.approvedAttempt === manifest.attempt;
}
export function autoApprovalMatches(manifest) {
  const policy = CONFIG.automaticProductionPolicy || {};
  return Boolean(manifest)
    && policy.enabled === true
    && manifest.approvalStatus === (policy.autoApprovalStatus || 'auto-approved')
    && manifest.approvalType === (policy.aiVisualQaApprovalType || 'ai-visual-qa')
    && manifest.approvedManifestRevision === manifest.revision
    && manifest.approvedAttempt === manifest.attempt
    && manifest.aiVisualQa?.status === 'PASS';
}
export function approvalMatches(manifest) {
  return humanApprovalMatches(manifest) || autoApprovalMatches(manifest);
}
export function dataFirstPublicationEnabled() {
  const policy = CONFIG.automaticProductionPolicy || {};
  return policy.enabled === true && policy.dataFirstPublication === true;
}
export function evaluateCultivarPublicationGate({strain,manifest,primaryExists=false,sourceEntityClosureValid=false,visualLinkageValid=false,cultivarValidationPass=false}={}) {
  const primary=(strain?.visuals||[]).filter(v=>v.role==='primary');
  const noVisual=primary.length===0 && (strain?.visuals||[]).length===0;
  const visualRequired=primary.length>0;
  const checks={
    formalStrainDataValid:Boolean(strain?.id&&strain?.name),
    sourceEntityClosureValid:Boolean(sourceEntityClosureValid),
    cultivarValidationPass:Boolean(cultivarValidationPass),
    visualCardinalityValid:primary.length<=1,
    visualPolicyValid: visualRequired
      ? Boolean(primaryExists && approvalMatches(manifest) && visualLinkageValid)
      : Boolean(noVisual && dataFirstPublicationEnabled())
  };
  const blockers=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
  return {ok:blockers.length===0,checks,blockers,mode:visualRequired?'image-bearing':'data-first-no-image'};
}
export function inferStablePhase({strain, publicationEntry, manifest, primaryExists}) {
  if (!strain) return 'STOCKED';
  const primary = (strain.visuals || []).filter(v => v.role === 'primary');
  if (publicationEntry?.state === 'published' && primary.length === 1) return 'PUBLISHED';
  if (primary.length === 1 && primaryExists) return 'VISUAL_LINKED';
  if (manifest && approvalMatches(manifest) && primaryExists && manifest.imageInboxCommit && manifest.imageProcessingCommit) return 'IMAGE_READY';
  if (manifest) return 'IMAGE_PENDING';
  return 'DATA_READY';
}
export function reconcileRunItem(item, observed) {
  const stablePhase = inferStablePhase(observed);
  if (item.productionPhase === stablePhase) return {item,recovered:false};
  return {item:{...item,productionPhase:stablePhase,previousStablePhase:stablePhase,audit:[...(item.audit||[]),{severity:'INFO',code:'RECOVERED_FROM_GITHUB_STATE',observedPhase:stablePhase,at:new Date().toISOString()}]},recovered:true};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd,...args] = process.argv.slice(2);
  if (cmd === 'transition') {
    const result = validatePhaseTransition(args[0],args[1],args[2] || null); console.log(JSON.stringify(result,null,2)); if (!result.ok) process.exit(1);
  } else if (cmd === 'hash-visual') {
    const input = JSON.parse(fs.readFileSync(args[0],'utf8')); console.log(visualPreparationHash(input));
  } else {
    console.log('CONTENT PRODUCTION V1 state helper: transition <from> <to> [previousStablePhase] | hash-visual <json>');
  }
}
