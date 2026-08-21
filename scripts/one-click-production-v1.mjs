#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { canonicalJson, sha256, visualPreparationHash, CONFIG } from './content-production-state.mjs';
import { evaluateProductionReadiness } from './production-readiness-v1.mjs';

const ROOT = process.cwd();
const QUALITY = 'medium';
const MODEL = 'gpt-image-2';
const REQUESTED_SIZE = '1024x1536';
const MAX_BATCH = 5;
const CANONICALIZATION = 'Recursive lexicographic JSON object-key ordering, arrays preserved, JSON.stringify without whitespace, UTF-8 bytes';

function parseArgs(argv) {
  const out = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) { out._.push(raw); continue; }
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}
function bool(v, fallback=false) {
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  return !['0','false','no','off',''].includes(String(v).toLowerCase());
}
function int(v, fallback) {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isInteger(n)) throw new Error(`Invalid integer: ${v}`);
  return n;
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, value) { ensureDir(path.dirname(p)); fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`); }
function writeText(p, value) { ensureDir(path.dirname(p)); fs.writeFileSync(p, value); }
function exists(p) { return fs.existsSync(p); }
function listJson(dir) { return exists(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort() : []; }
function git(args, opts={}) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], ...opts }).trim(); }
function gitHead() { return git(['rev-parse','HEAD']); }
function gitBlobSha(ref, p) { return git(['rev-parse', `${ref}:${p}`]); }
function equivalent(a,b) { return canonicalJson(a) === canonicalJson(b); }
function utcNow() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function checkQuality() {
  const configured = CONFIG?.imageGenerationPolicy?.defaultQuality;
  if (configured !== QUALITY) throw new Error(`CONTENT_PRODUCTION_V1 defaultQuality must be medium, got ${configured}`);
  if (CONFIG?.imageGenerationPolicy?.automaticGenerationMayPublish !== false) throw new Error('automaticGenerationMayPublish must remain false');
  if (CONFIG?.imageGenerationPolicy?.aiVisualQaCanApproveProduction !== false) throw new Error('aiVisualQaCanApproveProduction must remain false');
}
function walkResults(value, results=[]) {
  if (Array.isArray(value)) for (const item of value) walkResults(item, results);
  else if (value && typeof value === 'object') {
    if (typeof value.result === 'string') results.push(value.result);
    for (const v of Object.values(value)) walkResults(v, results);
  }
  return results;
}
function normalizeVisualPreparation(stock) {
  const v = stock.visualPreparation || {};
  if (typeof v.prompt !== 'string' || !v.prompt.trim()) throw new Error('visualPreparation.prompt missing');
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) throw new Error('visualPreparation.evidence missing');
  if (typeof v.alt !== 'string' || !v.alt.trim()) throw new Error('visualPreparation.alt missing');
  if (typeof v.rights !== 'string' || !v.rights.trim()) throw new Error('visualPreparation.rights missing');
  if (v.scope !== 'cultivar') throw new Error('visualPreparation.scope must be cultivar');
  if (v.aiGenerated !== true) throw new Error('visualPreparation.aiGenerated must be true');
  return {
    promptSnapshot: v.prompt,
    evidenceSnapshot: v.evidence,
    visualMetadataSnapshot: {
      alt: v.alt,
      rights: v.rights,
      scope: v.scope,
      aiGenerated: true,
      sourceType: 'aiGenerated'
    }
  };
}
function validateStockShape(stock, file) {
  if (stock.schemaVersion !== 'AUTO_STOCK_V1') throw new Error(`${file}: unsupported stock schemaVersion`);
  if (!stock.stockId || stock.candidate?.id !== stock.stockId) throw new Error(`${file}: stock/candidate id mismatch`);
  if (!stock.candidate?.strainData || stock.candidate.strainData.id !== stock.stockId) throw new Error(`${file}: strainData id mismatch`);
  if (!Array.isArray(stock.sources)) throw new Error(`${file}: sources missing`);
  if (!Array.isArray(stock.entities)) throw new Error(`${file}: entities missing`);
  normalizeVisualPreparation(stock);
  return true;
}
function productionSnapshot() {
  const publication = readJson(path.join(ROOT, 'production/publication.json'));
  const sourceById = new Map();
  const sourceByUrl = new Map();
  for (const name of listJson(path.join(ROOT,'sources'))) {
    const payload = readJson(path.join(ROOT,'sources',name));
    sourceById.set(payload.id, payload);
    if (payload.url) sourceByUrl.set(payload.url, payload.id);
  }
  const entityById = new Map();
  const entityNameToId = new Map();
  for (const name of listJson(path.join(ROOT,'entities'))) {
    const payload = readJson(path.join(ROOT,'entities',name));
    entityById.set(payload.id, payload);
    if (payload.name) entityNameToId.set(payload.name, payload.id);
  }
  const activeRuns = [];
  const active = new Set(CONFIG.activeRunStatuses || []);
  for (const name of listJson(path.join(ROOT,'production/runs'))) {
    const run = readJson(path.join(ROOT,'production/runs',name));
    if (active.has(run.status)) activeRuns.push({ runId: run.runId, status: run.status });
  }
  return { publication, sourceById, sourceByUrl, entityById, entityNameToId, activeRuns };
}
function candidateConflictReasons(stock, snap) {
  const id = stock.stockId;
  const reasons = [];
  const readiness = evaluateProductionReadiness(stock.candidate?.strainData);
  reasons.push(...readiness.reasons);
  if (exists(path.join(ROOT,'strains',id,'strain.json'))) reasons.push('PRODUCTION_DUPLICATE');
  if ((snap.publication.entries || []).some(e => e.strainId === id)) reasons.push('PUBLICATION_DUPLICATE');
  const declared = walkResults(stock.duplicateCheck || {});
  if (declared.some(r => ['CONFLICT','NEEDS_REVIEW','DUPLICATE'].includes(r))) reasons.push('STOCK_CONFLICT');
  for (const src of stock.sources || []) {
    if (!src?.payload || src.payload.id !== src.id) { reasons.push(`SOURCE_INVALID:${src?.id || 'unknown'}`); continue; }
    const existing = snap.sourceById.get(src.id);
    if (existing && !equivalent(existing, src.payload)) reasons.push(`SOURCE_ID_CONFLICT:${src.id}`);
    const sameUrlId = src.url ? snap.sourceByUrl.get(src.url) : null;
    if (sameUrlId && sameUrlId !== src.id) reasons.push(`SOURCE_URL_CONFLICT:${src.id}`);
  }
  for (const ent of stock.entities || []) {
    if (!ent?.payload || ent.payload.id !== ent.id) { reasons.push(`ENTITY_INVALID:${ent?.id || 'unknown'}`); continue; }
    const existing = snap.entityById.get(ent.id);
    if (existing && !equivalent(existing, ent.payload)) reasons.push(`ENTITY_ID_CONFLICT:${ent.id}`);
    const name = ent.payload.name || ent.canonicalName;
    const sameNameId = name ? snap.entityNameToId.get(name) : null;
    if (sameNameId && sameNameId !== ent.id) reasons.push(`ENTITY_NAME_CONFLICT:${ent.id}`);
  }
  return [...new Set(reasons)];
}
function buildPlan({ batchSize, generateImages, workflowRunId, sourceHead, mainHead }) {
  checkQuality();
  if (batchSize < 1 || batchSize > MAX_BATCH) throw new Error(`batch_size must be 1..${MAX_BATCH}`);
  const actualHead = gitHead();
  if (sourceHead && sourceHead !== actualHead) throw new Error(`SOURCE_HEAD_MISMATCH expected=${sourceHead} actual=${actualHead}`);
  const snap = productionSnapshot();
  if (snap.activeRuns.length) throw new Error(`ACTIVE_RUN_CONFLICT ${JSON.stringify(snap.activeRuns)}`);
  const selectedCultivars = [];
  const skippedCultivars = [];
  for (const name of listJson(path.join(ROOT,'stock/items'))) {
    const stockPath = `stock/items/${name}`;
    let stock;
    try {
      stock = readJson(path.join(ROOT,stockPath));
      validateStockShape(stock, stockPath);
      const reasons = candidateConflictReasons(stock, snap);
      if (reasons.length) {
        skippedCultivars.push({ strainId: stock.stockId || name.replace(/\.json$/,''), stockPath, reasons });
        continue;
      }
      if (selectedCultivars.length < batchSize) {
        selectedCultivars.push({
          strainId: stock.stockId,
          cultivarName: stock.candidate.canonicalName || stock.candidate.strainData.name || stock.stockId,
          stockPath,
          stockBlobSha: gitBlobSha(actualHead, stockPath)
        });
      } else {
        skippedCultivars.push({ strainId: stock.stockId, stockPath, reasons: ['BATCH_LIMIT'] });
      }
    } catch (err) {
      skippedCultivars.push({ strainId: stock?.stockId || name.replace(/\.json$/,''), stockPath, reasons: [`NOT_PROMOTABLE:${String(err.message || err)}`] });
    }
  }
  const reviewBatchId = `production-review-${workflowRunId}`;
  return {
    schemaVersion: 1,
    system: 'ONE_CLICK_PRODUCTION_V1',
    implementationStep: 1,
    phase: 'PHASE_A',
    startWorkflowRunId: String(workflowRunId),
    sourceHead: actualHead,
    baseSha: actualHead,
    mainHeadAtStart: mainHead || null,
    selectedCultivars,
    skippedCultivars,
    selectedCount: selectedCultivars.length,
    batchSizeRequested: batchSize,
    generateImages,
    estimatedMaximumPaidRequests: generateImages ? selectedCultivars.length : 0,
    maximumRequestPerCultivar: 1,
    automaticImageRetry: 0,
    quality: QUALITY,
    model: MODEL,
    publicationPolicy: 'cultivar',
    reviewBatchId,
    checkpoint: 'PHASE_A_COMPLETE',
    createdAt: utcNow()
  };
}
function phaseA(args) {
  const plan = buildPlan({
    batchSize: int(args['batch-size'], 5),
    generateImages: bool(args['generate-images'], true),
    workflowRunId: args['workflow-run-id'] || process.env.GITHUB_RUN_ID || 'local',
    sourceHead: args['source-head'] || null,
    mainHead: args['main-head'] || null
  });
  const out = args.out || 'artifacts/one-click-v1/phase-a/plan.json';
  writeJson(out, plan);
  console.log(JSON.stringify(plan, null, 2));
}
function manifestFor(stock, item, productionRunId) {
  const prep = normalizeVisualPreparation(stock);
  const vhash = visualPreparationHash(prep);
  return {
    schemaVersion: 1,
    manifestVersion: 1,
    manifestId: `${productionRunId}-${item.strainId}-image`,
    runId: productionRunId,
    strainId: item.strainId,
    revision: 1,
    attempt: 1,
    sourceStockPath: item.stockPath,
    sourceStockBlobSha: item.stockBlobSha,
    visualPreparationHash: vhash,
    generatedFromManifestVersion: null,
    promptSnapshot: prep.promptSnapshot,
    evidenceSnapshot: prep.evidenceSnapshot,
    visualMetadataSnapshot: prep.visualMetadataSnapshot,
    expectedInboxFilename: `${item.strainId}.jpg`,
    expectedPrimaryPath: `strains/${item.strainId}/images/generated/primary.webp`,
    generatedAt: null,
    approvalStatus: 'pending',
    approvedAt: null,
    approvalType: CONFIG.imageGenerationPolicy.requiredProductionApprovalType || 'human-visual-review',
    approvedManifestRevision: null,
    approvedAttempt: null,
    approvedSourceSha256: null,
    imageInboxCommit: null,
    imageProcessingCommit: null,
    processedPrimaryBlobSha: null,
    processedPrimarySha256: null,
    width: null,
    height: null,
    audit: [{
      severity: 'INFO', code: 'MANIFEST_CREATED', at: utcNow(), productionPhase: 'IMAGE_PENDING',
      note: 'Created by PRODUCTION START V1. Candidate output is review-only and cannot publish.'
    }]
  };
}
function ensureCurrentSelection(plan, snap) {
  if (plan.quality !== QUALITY) throw new Error('Phase A quality is not medium');
  if (plan.selectedCultivars.length > MAX_BATCH) throw new Error('Phase A selected more than 5 cultivars');
  for (const item of plan.selectedCultivars) {
    const currentBlob = gitBlobSha(plan.sourceHead, item.stockPath);
    if (currentBlob !== item.stockBlobSha) throw new Error(`SOURCE_STOCK_CHANGED ${item.strainId}`);
    const stock = readJson(path.join(ROOT,item.stockPath));
    validateStockShape(stock, item.stockPath);
    const reasons = candidateConflictReasons(stock, snap);
    if (reasons.length) throw new Error(`SELECTION_BECAME_INVALID ${item.strainId}: ${reasons.join(',')}`);
  }
}
function buildPhaseB(plan, apply) {
  checkQuality();
  const head = gitHead();
  if (head !== plan.baseSha || head !== plan.sourceHead) throw new Error(`BASE_SHA_CONFLICT expected=${plan.baseSha} actual=${head}`);
  const snap = productionSnapshot();
  if (snap.activeRuns.length) throw new Error(`ACTIVE_RUN_CONFLICT ${JSON.stringify(snap.activeRuns)}`);
  ensureCurrentSelection(plan, snap);
  const productionRunId = `content-production-start-${plan.startWorkflowRunId}`;
  const now = utcNow();
  const publication = structuredClone(snap.publication);
  const runItems = [];
  const checkpointItems = [];
  const fileWrites = [];
  for (const item of plan.selectedCultivars) {
    const stock = readJson(path.join(ROOT,item.stockPath));
    const formal = structuredClone(stock.candidate.strainData);
    formal.visuals = [];
    fileWrites.push([`strains/${item.strainId}/strain.json`, formal]);
    for (const src of stock.sources || []) {
      const target = `sources/${src.id}.json`;
      if (!exists(path.join(ROOT,target))) fileWrites.push([target, src.payload]);
    }
    for (const ent of stock.entities || []) {
      const target = `entities/${ent.id}.json`;
      if (!exists(path.join(ROOT,target))) fileWrites.push([target, ent.payload]);
    }
    publication.entries.push({
      strainId: item.strainId,
      state: 'pending',
      origin: 'content-production',
      introducedByRun: productionRunId,
      publishedAt: null,
      bootstrapMasterSha: null
    });
    const manifest = manifestFor(stock, item, productionRunId);
    fileWrites.push([`production/manifests/${item.strainId}.json`, manifest]);
    runItems.push({
      strainId: item.strainId,
      sourceStockPath: item.stockPath,
      sourceStockBlobSha: item.stockBlobSha,
      productionStrainPath: `strains/${item.strainId}/strain.json`,
      publicationEntryId: item.strainId,
      productionPhase: 'IMAGE_PENDING',
      previousStablePhase: 'IMAGE_PENDING',
      manifestId: manifest.manifestId,
      manifestRevision: manifest.revision,
      promotedAt: now,
      promotionCommit: null,
      approval: null,
      commits: { dataCommit:null, imageInboxCommit:null, imageProcessingCommit:null, visualsCommit:null, publicationCommit:null, buildCommit:null },
      audit: [
        { severity:'INFO', code:'PHASE_TRANSITION', fromPhase:'STOCKED', toPhase:'DATA_READY', at:now },
        { severity:'INFO', code:'PHASE_TRANSITION', fromPhase:'DATA_READY', toPhase:'IMAGE_PENDING', at:now }
      ]
    });
    checkpointItems.push({
      strainId: item.strainId,
      cultivarName: item.cultivarName,
      stockPath: item.stockPath,
      sourceStockBlobSha: item.stockBlobSha,
      productionRunId,
      manifestId: manifest.manifestId,
      manifestRevision: manifest.revision,
      attempt: manifest.attempt,
      visualPreparationHash: manifest.visualPreparationHash,
      promptSha256: sha256(manifest.promptSnapshot),
      evidenceSha256: sha256(canonicalJson(manifest.evidenceSnapshot)),
      model: MODEL,
      quality: QUALITY,
      productionPhase: 'IMAGE_PENDING'
    });
  }
  const run = {
    schemaVersion:1, runVersion:1, runId:productionRunId, mode:'new-publication', publicationPolicy:'cultivar', status:'ACTIVE',
    startedAt:now, updatedAt:now, finishedAt:null, cancelledAt:null,
    baseSha:plan.baseSha, currentBaseSha:plan.baseSha, attempt:1, previousAttempts:[],
    mainHeadAtStart:plan.mainHeadAtStart || '', mainHeadAtEnd:null,
    publishedIdsAtStart:(snap.publication.entries || []).filter(e=>e.state==='published').map(e=>e.strainId).sort(),
    targetStrainIds:checkpointItems.map(x=>x.strainId), expectedPublicationDelta:checkpointItems.map(x=>x.strainId),
    items:runItems, pagesDeploymentRunId:null, pagesDeploymentUrl:null, displayVerifiedAt:null, publicationSetAtEnd:null, recovery:null, auditSummary:null
  };
  fileWrites.push(['production/publication.json', publication]);
  fileWrites.push([`production/runs/${productionRunId}.json`, run]);
  if (apply) {
    for (const [rel,payload] of fileWrites) {
      if (rel.startsWith('runtime/') || rel.endsWith('data.js') || rel.endsWith('sources.js')) throw new Error(`RUNTIME_WRITE_FORBIDDEN ${rel}`);
      writeJson(path.join(ROOT,rel), payload);
    }
  }
  return {
    schemaVersion:1,
    system:'ONE_CLICK_PRODUCTION_V1', implementationStep:1, phase:'PHASE_B',
    startWorkflowRunId:plan.startWorkflowRunId, sourceHead:plan.sourceHead, baseSha:plan.baseSha,
    productionRunId, reviewBatchId:plan.reviewBatchId, quality:QUALITY, model:MODEL,
    publicationPolicy:'cultivar', selectedCount:checkpointItems.length, items:checkpointItems,
    formalDataLogicallyRetained:checkpointItems.length,
    phaseBAtomicTransaction:true,
    phaseBWriteMode: apply ? 'WORKTREE_PENDING_ATOMIC_COMMIT' : 'LOGICAL_ONLY',
    rollbackOnImageFailure:false,
    checkpoint:'PHASE_B_COMPLETE_IMAGE_PENDING',
    nextCheckpoint:'WAITING_HUMAN_REVIEW',
    generatedAt:now
  };
}
function phaseB(args) {
  const plan = readJson(args.plan || 'artifacts/one-click-v1/phase-a/plan.json');
  const checkpoint = buildPhaseB(plan, bool(args.apply, false));
  const out = args.out || 'artifacts/one-click-v1/phase-b/checkpoint.json';
  writeJson(out, checkpoint);
  console.log(JSON.stringify(checkpoint, null, 2));
}
function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('JPEG_SOI_MISSING');
  let i = 2, width=null, height=null;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    while (i < buf.length && buf[i] === 0xff) i++;
    const marker = buf[i++];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      const eoi = buf.lastIndexOf(Buffer.from([0xff,0xd9]));
      if (eoi < i) throw new Error('JPEG_EOI_MISSING');
      break;
    }
    if ([0x01,0xd0,0xd1,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7].includes(marker)) continue;
    if (i + 1 >= buf.length) throw new Error('JPEG_SEGMENT_TRUNCATED');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw new Error('JPEG_SEGMENT_INVALID');
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && len >= 7) {
      height = buf.readUInt16BE(i + 3); width = buf.readUInt16BE(i + 5);
    }
    i += len;
  }
  if (!width || !height) throw new Error('JPEG_DIMENSIONS_MISSING');
  return { width, height };
}
function approvalPayload({ reviewBatchId, startWorkflowRunId, sourceHead, productionRunId, strainId, manifestId, revision, attempt, visualPreparationHash:vh, promptSha256, evidenceSha256, model, quality, candidateSha256 }) {
  return { reviewBatchId, startWorkflowRunId, sourceHead, productionRunId, strainId, manifestId, revision, attempt, visualPreparationHash:vh, promptSha256, evidenceSha256, model, quality, candidateSha256 };
}
function approvalBinding(payload) { return sha256(canonicalJson(payload)); }
async function generateOpenAiCandidate({ item, phaseBCheckpoint, outDir }) {
  checkQuality();
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  const manifest = readJson(path.join(ROOT,'production/manifests',`${item.strainId}.json`));
  if (manifest.approvalStatus !== 'pending') throw new Error('MANIFEST_NOT_PENDING_REVIEW');
  if (manifest.revision !== item.manifestRevision || manifest.attempt !== item.attempt) throw new Error('MANIFEST_VERSION_MISMATCH');
  const evidenceText = manifest.evidenceSnapshot.map(e => e.description).filter(Boolean).join('\n');
  const requestPrompt = `${manifest.promptSnapshot}\n\n${evidenceText}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ model:MODEL, prompt:requestPrompt, size:REQUESTED_SIZE, quality:QUALITY, output_format:'jpeg', n:1 }),
      signal:controller.signal
    });
  } finally { clearTimeout(timer); }
  const body = await response.json().catch(()=>null);
  if (!response.ok) throw new Error(`OPENAI_API_ERROR_${response.status}:${JSON.stringify(body)?.slice(0,800)}`);
  if (!body || !Array.isArray(body.data) || body.data.length !== 1 || !body.data[0]?.b64_json) throw new Error('OPENAI_RESPONSE_NOT_EXACTLY_ONE_IMAGE');
  const raw = Buffer.from(body.data[0].b64_json, 'base64');
  const dims = jpegInfo(raw);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir,'candidate.jpg'), raw);
  const candidateSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const payload = approvalPayload({
    reviewBatchId:phaseBCheckpoint.reviewBatchId,
    startWorkflowRunId:phaseBCheckpoint.startWorkflowRunId,
    sourceHead:phaseBCheckpoint.sourceHead,
    productionRunId:phaseBCheckpoint.productionRunId,
    strainId:item.strainId,
    manifestId:item.manifestId,
    revision:item.manifestRevision,
    attempt:item.attempt,
    visualPreparationHash:item.visualPreparationHash,
    promptSha256:item.promptSha256,
    evidenceSha256:item.evidenceSha256,
    model:MODEL, quality:QUALITY, candidateSha256
  });
  const receipt = {
    schemaVersion:1, strainId:item.strainId, cultivarName:item.cultivarName,
    workflowRunId:phaseBCheckpoint.startWorkflowRunId, productionRunId:phaseBCheckpoint.productionRunId,
    sourceHead:phaseBCheckpoint.sourceHead, manifestId:item.manifestId, manifestRevision:item.manifestRevision, attempt:item.attempt,
    model:MODEL, quality:QUALITY, requestedSize:REQUESTED_SIZE, dimensions:dims,
    candidateSha256, promptSha256:item.promptSha256, evidenceSha256:item.evidenceSha256,
    visualPreparationHash:item.visualPreparationHash,
    aiQaStatus:'PASS', aiQaBasis:'automated-structural-v1',
    knownCostUsd:null, billingStatus:'UNKNOWN_AT_GENERATION',
    approvalBindingPayload:payload, approvalBindingSha256:approvalBinding(payload), approvalBindingCanonicalization:CANONICALIZATION,
    approvalStatus:'pending-human-review', maximumRequestsForCultivar:1, automaticRetry:0, generatedAt:utcNow()
  };
  writeJson(path.join(outDir,'receipt.json'), receipt);
  return receipt;
}
async function candidate(args) {
  const checkpoint = readJson(args['phase-b']);
  const strainId = args['strain-id'];
  const item = checkpoint.items.find(x=>x.strainId === strainId);
  if (!item) throw new Error(`Unknown Phase B strainId: ${strainId}`);
  if (item.quality !== QUALITY || checkpoint.quality !== QUALITY) throw new Error('QUALITY_NOT_MEDIUM');
  const outDir = args.out || `artifacts/candidate-${checkpoint.startWorkflowRunId}-${strainId}`;
  const failureOut = args['failure-out'] || `${outDir}-failure/failure.json`;
  if (!bool(args['generate-images'], true)) {
    writeJson(failureOut, { strainId, cultivarName:item.cultivarName, status:'SKIPPED_GENERATION_DISABLED', requestCount:0, automaticRetry:0, at:utcNow() });
    console.log(JSON.stringify({ created:false, status:'SKIPPED_GENERATION_DISABLED', strainId }));
    return;
  }
  try {
    const receipt = await generateOpenAiCandidate({ item, phaseBCheckpoint:checkpoint, outDir });
    console.log(JSON.stringify({ created:true, status:'CANDIDATE_CREATED', strainId, approvalBindingSha256:receipt.approvalBindingSha256 }));
  } catch (err) {
    writeJson(failureOut, { strainId, cultivarName:item.cultivarName, status:'CANDIDATE_FAILED', reason:String(err.message || err).slice(0,1200), requestCount: process.env.OPENAI_API_KEY?.trim() ? 1 : 0, automaticRetry:0, at:utcNow() });
    console.log(JSON.stringify({ created:false, status:'CANDIDATE_FAILED', strainId, reason:String(err.message || err) }));
  }
}
function pythonAvailable() {
  return spawnSync('python3', ['-c','from PIL import Image'], { encoding:'utf8' }).status === 0;
}
function makeMockJpeg(file, title, qa='PASS') {
  ensureDir(path.dirname(file));
  const py = `from PIL import Image,ImageDraw\nimport sys\nout,title,qa=sys.argv[1:4]\nim=Image.new('RGB',(720,1080),(235,235,230))\nd=ImageDraw.Draw(im)\nd.rectangle((40,40,680,1040),outline=(50,50,50),width=5)\nd.text((80,120),title,fill=(20,20,20))\nd.text((80,180),'FIXTURE CANDIDATE',fill=(20,20,20))\nd.text((80,240),'AI QA '+qa,fill=(20,20,20))\nim.save(out,'JPEG',quality=90)\n`;
  const r = spawnSync('python3',['-c',py,file,title,qa],{encoding:'utf8'});
  if (r.status !== 0) throw new Error(`Fixture JPEG generation failed: ${r.stderr}`);
}
function findFilesRecursive(root, basename) {
  const out=[];
  if (!exists(root)) return out;
  const walk = p => {
    for (const ent of fs.readdirSync(p,{withFileTypes:true})) {
      const full=path.join(p,ent.name);
      if (ent.isDirectory()) walk(full); else if (ent.name===basename) out.push(full);
    }
  };
  walk(root); return out.sort();
}
function buildContactSheet(entries, outFile, mockFailure=false) {
  if (mockFailure) throw new Error('CONTACT_SHEET_AGGREGATION_FAILURE_MOCK');
  if (!pythonAvailable()) throw new Error('Pillow is required for contact sheet aggregation');
  const tmp = `${outFile}.tiles.json`;
  writeJson(tmp, entries);
  const py = `from PIL import Image,ImageOps,ImageDraw,ImageFont\nimport json,math,sys,os\nitems=json.load(open(sys.argv[1],encoding='utf-8'))\nout=sys.argv[2]\ncols=2\ntile_w=720\nimage_h=900\nlabel_h=220\nrows=max(1,math.ceil(len(items)/cols))\nsheet=Image.new('RGB',(tile_w*cols,(image_h+label_h)*rows),'white')\ntry:\n font1=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',36)\n font2=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',27)\nexcept:\n font1=ImageFont.load_default()\n font2=font1\nd=ImageDraw.Draw(sheet)\nfor i,x in enumerate(items):\n r,c=divmod(i,cols); ox=c*tile_w; oy=r*(image_h+label_h)\n im=Image.open(x['candidate']).convert('RGB')\n fitted=ImageOps.contain(im,(tile_w,image_h),method=Image.Resampling.LANCZOS)\n sheet.paste(fitted,(ox+(tile_w-fitted.width)//2,oy+(image_h-fitted.height)//2))\n d.rectangle((ox,oy+image_h,ox+tile_w,oy+image_h+label_h),fill='white')\n d.text((ox+24,oy+image_h+18),x['cultivarName'],fill='black',font=font1)\n d.text((ox+24,oy+image_h+70),x['strainId'],fill='black',font=font2)\n d.text((ox+24,oy+image_h+112),'AI QA '+x['aiQaStatus'],fill='black',font=font2)\n d.text((ox+24,oy+image_h+154),'binding '+x['bindingShort'],fill='black',font=font2)\nos.makedirs(os.path.dirname(out),exist_ok=True)\nsheet.save(out,'JPEG',quality=90)\n`;
  const r = spawnSync('python3',['-c',py,tmp,outFile],{encoding:'utf8'});
  fs.rmSync(tmp,{force:true});
  if (r.status !== 0) throw new Error(`Contact sheet failed: ${r.stderr}`);
}
function aggregateReview({ checkpoint, candidateRoot, failureRoot, outDir, mockFailure=false }) {
  ensureDir(path.join(outDir,'candidates'));
  ensureDir(path.join(outDir,'receipts'));
  const successes=[];
  for (const receiptPath of findFilesRecursive(candidateRoot,'receipt.json')) {
    const receipt=readJson(receiptPath);
    const candidatePath=path.join(path.dirname(receiptPath),'candidate.jpg');
    if (!exists(candidatePath)) continue;
    const expected=approvalBinding(receipt.approvalBindingPayload);
    if (expected !== receipt.approvalBindingSha256) throw new Error(`APPROVAL_BINDING_MISMATCH ${receipt.strainId}`);
    fs.copyFileSync(candidatePath,path.join(outDir,'candidates',`${receipt.strainId}.jpg`));
    fs.copyFileSync(receiptPath,path.join(outDir,'receipts',`${receipt.strainId}.json`));
    successes.push({
      strainId:receipt.strainId, cultivarName:receipt.cultivarName || receipt.strainId,
      aiQaStatus:receipt.aiQaStatus, approvalBindingSha256:receipt.approvalBindingSha256,
      bindingShort:receipt.approvalBindingSha256.slice(0,12), candidate:path.join(outDir,'candidates',`${receipt.strainId}.jpg`)
    });
  }
  const failureMap=new Map();
  for (const f of findFilesRecursive(failureRoot,'failure.json')) { const x=readJson(f); failureMap.set(x.strainId,x); }
  const successfulIds=new Set(successes.map(x=>x.strainId));
  const failedCultivars=checkpoint.items.filter(x=>!successfulIds.has(x.strainId)).map(x=>({
    strainId:x.strainId, cultivarName:x.cultivarName,
    status:failureMap.get(x.strainId)?.status || 'CANDIDATE_UNAVAILABLE',
    reason:failureMap.get(x.strainId)?.reason || null
  }));
  buildContactSheet(successes,path.join(outDir,'contact-sheet.jpg'),mockFailure);
  const reviewPackage={
    schemaVersion:1, system:'ONE_CLICK_PRODUCTION_V1', implementationStep:1,
    reviewBatchId:checkpoint.reviewBatchId, startWorkflowRunId:checkpoint.startWorkflowRunId,
    sourceHead:checkpoint.sourceHead, productionRunId:checkpoint.productionRunId,
    quality:QUALITY, model:MODEL, checkpoint:'WAITING_HUMAN_REVIEW',
    approvalRequired:'human-visual-review', aiOnlyApprovalAllowed:false, automaticPublicationAllowed:false,
    formalDataRetained:checkpoint.formalDataLogicallyRetained,
    selectedCultivars:checkpoint.items.map(x=>({strainId:x.strainId,cultivarName:x.cultivarName})),
    candidates:successes.map(x=>({strainId:x.strainId,cultivarName:x.cultivarName,aiQaStatus:x.aiQaStatus,approvalBindingSha256:x.approvalBindingSha256})),
    failedCultivars,
    candidateCount:successes.length, failedCount:failedCultivars.length,
    approvalBindingCanonicalization:CANONICALIZATION,
    publicationAction:'NONE', primaryVisualAction:'NONE', runtimeAction:'NONE', approveWorkflowImplemented:false,
    generatedAt:utcNow()
  };
  writeJson(path.join(outDir,'review-package.json'),reviewPackage);
  const md=[
    '# PRODUCTION START V1 review package','',
    `Checkpoint: **WAITING_HUMAN_REVIEW**`,
    `Review batch: ${checkpoint.reviewBatchId}`,
    `Production run: ${checkpoint.productionRunId}`,
    `Candidates: ${successes.length}/${checkpoint.items.length}`,
    `Failed candidate jobs: ${failedCultivars.length}`,
    `Quality: ${QUALITY}`,'',
    'No approval, primary visual linking, publication opening, runtime build, or site publication is performed by START V1.'
  ].join('\n');
  writeText(path.join(outDir,'summary.md'),`${md}\n`);
  return reviewPackage;
}
function aggregate(args) {
  const checkpoint=readJson(args['phase-b']);
  const review=aggregateReview({
    checkpoint,
    candidateRoot:args['candidates-root'] || 'artifacts/candidates',
    failureRoot:args['failures-root'] || 'artifacts/failures',
    outDir:args.out || `artifacts/production-review-${checkpoint.startWorkflowRunId}`,
    mockFailure:bool(args['mock-aggregation-failure'],false)
  });
  console.log(JSON.stringify(review,null,2));
}
function mockReceipt(fix, item, file, qa) {
  const raw=fs.readFileSync(file); const candidateSha256=crypto.createHash('sha256').update(raw).digest('hex');
  const manifestId=`${fix.productionRunId}-${item.strainId}-image`;
  const promptSha256=sha256(`fixture prompt ${item.strainId}`);
  const evidenceSha256=sha256(canonicalJson([{description:`fixture evidence ${item.strainId}`}]))
  const vhash=sha256(canonicalJson({prompt:`fixture prompt ${item.strainId}`,evidence:[{description:`fixture evidence ${item.strainId}`}],metadata:{scope:'cultivar',aiGenerated:true}}));
  const payload=approvalPayload({reviewBatchId:fix.reviewBatchId,startWorkflowRunId:fix.startWorkflowRunId,sourceHead:fix.sourceHead,productionRunId:fix.productionRunId,strainId:item.strainId,manifestId,revision:1,attempt:1,visualPreparationHash:vhash,promptSha256,evidenceSha256,model:MODEL,quality:QUALITY,candidateSha256});
  return {
    schemaVersion:1,strainId:item.strainId,cultivarName:item.cultivarName,workflowRunId:fix.startWorkflowRunId,productionRunId:fix.productionRunId,sourceHead:fix.sourceHead,
    manifestId,manifestRevision:1,attempt:1,model:MODEL,quality:QUALITY,candidateSha256,promptSha256,evidenceSha256,visualPreparationHash:vhash,
    aiQaStatus:qa,aiQaBasis:'fixture-mock',knownCostUsd:0,billingStatus:'FIXTURE_NO_BILLING',
    approvalBindingPayload:payload,approvalBindingSha256:approvalBinding(payload),approvalBindingCanonicalization:CANONICALIZATION,
    approvalStatus:'pending-human-review',maximumRequestsForCultivar:1,automaticRetry:0
  };
}
function fixture(args) {
  checkQuality();
  const fixturePath=args.fixture || path.join(ROOT,'scripts/fixtures/one-click-production-v1.fixture.json');
  const fix=readJson(fixturePath);
  if (fix.selected.length !== 5) throw new Error('Fixture must select exactly 5 cultivars');
  if (fix.quality !== QUALITY) throw new Error('Fixture quality must be medium');
  const out=args.out || path.join(ROOT,'.tmp-one-click-v1-fixture');
  fs.rmSync(out,{recursive:true,force:true}); ensureDir(out);
  const plan={schemaVersion:1,phase:'PHASE_A',startWorkflowRunId:fix.startWorkflowRunId,sourceHead:fix.sourceHead,mainHeadAtStart:fix.mainHead,selectedCultivars:fix.selected.map(x=>({strainId:x.strainId,cultivarName:x.cultivarName})),skippedCultivars:[],selectedCount:5,estimatedMaximumPaidRequests:5,quality:QUALITY,maximumRequestPerCultivar:1,automaticImageRetry:0,checkpoint:'PHASE_A_COMPLETE'};
  writeJson(path.join(out,'phase-a','plan.json'),plan);
  const checkpoint={schemaVersion:1,phase:'PHASE_B',startWorkflowRunId:fix.startWorkflowRunId,sourceHead:fix.sourceHead,productionRunId:fix.productionRunId,reviewBatchId:fix.reviewBatchId,quality:QUALITY,model:MODEL,items:fix.selected.map(x=>({strainId:x.strainId,cultivarName:x.cultivarName,manifestId:`${fix.productionRunId}-${x.strainId}-image`,manifestRevision:1,attempt:1,quality:QUALITY,model:MODEL})),selectedCount:5,formalDataLogicallyRetained:5,phaseBAtomicTransaction:true,phaseBWriteMode:'FIXTURE_LOGICAL_ONLY',rollbackOnImageFailure:false,checkpoint:'PHASE_B_COMPLETE_IMAGE_PENDING',publicationWrites:0,runtimeWrites:0,openAiRequests:0};
  writeJson(path.join(out,'phase-b','checkpoint.json'),checkpoint);
  const candidateRoot=path.join(out,'individual-candidate-artifacts'); const failureRoot=path.join(out,'candidate-failures');
  for (const item of fix.selected) {
    if (item.candidateStatus === 'API_FAIL') {
      writeJson(path.join(failureRoot,item.strainId,'failure.json'),{strainId:item.strainId,cultivarName:item.cultivarName,status:'CANDIDATE_FAILED',reason:'API_MOCK_FAIL',requestCount:0,automaticRetry:0});
      continue;
    }
    const dir=path.join(candidateRoot,item.strainId); ensureDir(dir);
    const image=path.join(dir,'candidate.jpg'); makeMockJpeg(image,item.cultivarName,item.aiQaStatus);
    const receipt=mockReceipt(fix,item,image,item.aiQaStatus); writeJson(path.join(dir,'receipt.json'),receipt);
  }
  const reviewDir=path.join(out,'review-package');
  const review=aggregateReview({checkpoint,candidateRoot,failureRoot,outDir:reviewDir});
  const individualBefore=findFilesRecursive(candidateRoot,'candidate.jpg').map(p=>({p,sha:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}));
  let aggregationFailureCaught=false;
  try { aggregateReview({checkpoint,candidateRoot,failureRoot,outDir:path.join(out,'aggregation-failure-mock'),mockFailure:true}); }
  catch (err) { aggregationFailureCaught=String(err.message).includes('CONTACT_SHEET_AGGREGATION_FAILURE_MOCK'); }
  const individualAfter=findFilesRecursive(candidateRoot,'candidate.jpg').map(p=>({p,sha:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}));
  const survival=aggregationFailureCaught && equivalent(individualBefore,individualAfter) && individualAfter.length===4;
  const bindingPass=findFilesRecursive(candidateRoot,'receipt.json').every(p=>{const r=readJson(p);return approvalBinding(r.approvalBindingPayload)===r.approvalBindingSha256;});
  const result={
    fixture:'ONE_CLICK_PRODUCTION_V1_STEP_1',status:'PASS',phaseASelected:plan.selectedCount,phaseBFormalDataLogicallyRetained:checkpoint.formalDataLogicallyRetained,
    candidateArtifacts:individualAfter.length,failedCultivars:review.failedCount,contactSheetCandidates:review.candidateCount,reviewPackageValid:exists(path.join(reviewDir,'review-package.json'))&&exists(path.join(reviewDir,'contact-sheet.jpg')),
    aiQaPassCount:review.candidates.filter(x=>x.aiQaStatus==='PASS').length,aiQaFailCount:review.candidates.filter(x=>x.aiQaStatus==='FAIL').length,
    approvalBindingPass:bindingPass,aggregationFailureSurvival:survival,publicationWrites:0,runtimeWrites:0,openAiRequests:0,imageCostUsd:0,
    expected:{selected:5,retained:5,candidates:4,failed:1,contactSheet:4}
  };
  const pass=result.phaseASelected===5&&result.phaseBFormalDataLogicallyRetained===5&&result.candidateArtifacts===4&&result.failedCultivars===1&&result.contactSheetCandidates===4&&result.reviewPackageValid&&result.aiQaPassCount===3&&result.aiQaFailCount===1&&bindingPass&&survival;
  result.status=pass?'PASS':'FAIL'; writeJson(path.join(out,'fixture-result.json'),result); console.log(JSON.stringify(result,null,2)); if(!pass) process.exitCode=1;
}
function matrix(args) {
  const checkpoint=readJson(args['phase-b']);
  const include=checkpoint.items.map(x=>({strainId:x.strainId,cultivarName:x.cultivarName}));
  console.log(JSON.stringify({include}));
}

const [command,...rest]=process.argv.slice(2); const args=parseArgs(rest);
try {
  if (command==='phase-a') phaseA(args);
  else if (command==='phase-b') phaseB(args);
  else if (command==='candidate') await candidate(args);
  else if (command==='aggregate') aggregate(args);
  else if (command==='fixture') fixture(args);
  else if (command==='matrix') matrix(args);
  else {
    console.log('ONE-CLICK PRODUCTION V1 STEP 1');
    console.log('commands: phase-a | phase-b | candidate | aggregate | fixture | matrix');
  }
} catch (err) {
  console.error(`ONE_CLICK_PRODUCTION_V1_ERROR: ${err.stack || err}`);
  process.exitCode=1;
}