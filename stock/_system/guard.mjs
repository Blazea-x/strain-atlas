#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { evaluateProductionReadiness } from '../../scripts/production-readiness-v1.mjs';

const ROOT = process.cwd();
const SYSTEM_DIR = path.join(ROOT, 'stock', '_system');
const CONFIG_PATH = path.join(SYSTEM_DIR, 'config.json');
const SHA_RE = /^[0-9a-f]{40}$/;
const STOCK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, message, ...details }, null, 2));
  process.exit(1);
}

function ok(message, details = {}) {
  console.log(JSON.stringify({ ok: true, message, ...details }, null, 2));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot read JSON: ${file}`, { error: String(error.message || error) });
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`git ${args.join(' ')} failed`, { stderr: error.stderr?.toString()?.trim() || '' });
  }
}

function gitMaybe(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function normalizeRepoPath(p) {
  return p.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isAllowedPath(p, config) {
  const n = normalizeRepoPath(p);
  return config.allowedWritePrefixes.some(prefix => n.startsWith(prefix));
}

function isForbiddenPath(p, config) {
  const n = normalizeRepoPath(p);
  return config.forbiddenWritePaths.includes(n) || config.forbiddenWritePrefixes.some(prefix => n.startsWith(prefix));
}

function changedFiles(base, head) {
  if (!SHA_RE.test(base)) fail('Invalid BASE_SHA', { base });
  if (!(SHA_RE.test(head) || head === 'HEAD')) fail('Invalid HEAD/END_SHA', { head });
  const output = git(['diff', '--name-only', `${base}..${head}`]);
  return output ? output.split('\n').map(normalizeRepoPath).filter(Boolean) : [];
}

function treeSha(ref, treePath) {
  const out = git(['rev-parse', `${ref}:${treePath}`]);
  if (!SHA_RE.test(out)) fail('Unable to resolve protected tree', { ref, treePath, out });
  return out;
}

function fileSha(ref, filePath) {
  const out = git(['rev-parse', `${ref}:${filePath}`]);
  if (!SHA_RE.test(out)) fail('Unable to resolve protected file', { ref, filePath, out });
  return out;
}

function readJsonAtRef(ref, repoPath) {
  if (!SHA_RE.test(ref)) fail('Invalid ref for JSON read', { ref, repoPath });
  const content = git(['show', `${ref}:${normalizeRepoPath(repoPath)}`]);
  try {
    return JSON.parse(content);
  } catch (error) {
    fail('Cannot parse JSON at ref', { ref, repoPath, error: String(error.message || error) });
  }
}

function pathExistsAtRef(ref, repoPath) {
  if (!SHA_RE.test(ref)) fail('Invalid ref for path check', { ref, repoPath });
  return gitMaybe(['cat-file', '-e', `${ref}:${normalizeRepoPath(repoPath)}`]) !== null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sameContent(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function sameStringSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function formatRunTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

function isNewRunId(runId, config) {
  return new RegExp(config.runIdentity.newRunIdPattern).test(runId);
}

function localRunExists(runId, config) {
  return fs.existsSync(path.join(ROOT, config.runsRoot, runId));
}

function generateRunId(config, remoteExistingRunIds = []) {
  const policy = config.runIdentity;
  if (!policy) fail('runIdentity policy is missing from config.json');
  const remote = new Set(remoteExistingRunIds);
  for (let attempt = 1; attempt <= policy.maxGenerationAttempts; attempt += 1) {
    const suffix = randomBytes(Math.ceil(policy.randomHexLength / 2)).toString('hex').slice(0, policy.randomHexLength);
    const runId = `run-${formatRunTimestamp()}-${suffix}`;
    if (!isNewRunId(runId, config)) continue;
    if (localRunExists(runId, config) || remote.has(runId)) continue;
    return { runId, attempt };
  }
  fail('Unable to generate a collision-free runId', { attempts: policy.maxGenerationAttempts });
}

function assertNewRunIdAvailable(runId, config, remoteExistingRunIds = []) {
  if (!isNewRunId(runId, config)) fail('New runId does not match the required timestamp-plus-random format', { runId, requiredPattern: config.runIdentity.newRunIdPattern });
  if (localRunExists(runId, config) || remoteExistingRunIds.includes(runId)) fail('runId collision detected; existing run must never be overwritten', { runId });
  return true;
}

function getImageStockConfig(config) {
  const imageStock = config.imageStock;
  if (!imageStock || imageStock.enabled !== true) fail('IMAGE STOCK V1 is not enabled in config.json');
  if (imageStock.branch !== config.branch || imageStock.branch !== 'master-migration') fail('IMAGE STOCK branch must be master-migration and match AUTO STOCK branch', { imageStockBranch: imageStock.branch, autoStockBranch: config.branch });
  if (config.images?.mode !== 'disabled-v1' || config.images?.allowFiles !== false) fail('AUTO STOCK V1 image safety boundary has been weakened', { images: config.images });
  return imageStock;
}

function isNewImageRunId(runId, config) {
  return new RegExp(getImageStockConfig(config).runIdentity.newRunIdPattern).test(runId);
}

function localImageRunExists(runId, config) {
  return fs.existsSync(path.join(ROOT, getImageStockConfig(config).imageRunsRoot, runId));
}

function generateImageRunId(config, remoteExistingRunIds = []) {
  const imageStock = getImageStockConfig(config);
  const policy = imageStock.runIdentity;
  const remote = new Set(remoteExistingRunIds);
  for (let attempt = 1; attempt <= policy.maxGenerationAttempts; attempt += 1) {
    const suffix = randomBytes(Math.ceil(policy.randomHexLength / 2)).toString('hex').slice(0, policy.randomHexLength);
    const runId = `image-run-${formatRunTimestamp()}-${suffix}`;
    if (!isNewImageRunId(runId, config)) continue;
    if (localImageRunExists(runId, config) || remote.has(runId)) continue;
    return { runId, attempt };
  }
  fail('Unable to generate a collision-free IMAGE STOCK runId', { attempts: policy.maxGenerationAttempts });
}

function assertNewImageRunIdAvailable(runId, config, remoteExistingRunIds = []) {
  const imageStock = getImageStockConfig(config);
  if (!isNewImageRunId(runId, config)) fail('IMAGE STOCK runId does not match the required timestamp-plus-random format', { runId, requiredPattern: imageStock.runIdentity.newRunIdPattern });
  if (localImageRunExists(runId, config) || remoteExistingRunIds.includes(runId)) fail('IMAGE STOCK runId collision detected; existing run must never be overwritten', { runId });
  return true;
}

function expectedStockPath(stockId) { return `stock/items/${stockId}.json`; }
function expectedImagePath(stockId, config) { const i = getImageStockConfig(config); return `${i.imagesRoot}${stockId}/${i.primaryFilename}`; }
function expectedImageRunPath(runId, config) { return `${getImageStockConfig(config).imageRunsRoot}${runId}/run.json`; }

function assertVisualPreparation(stock, stockId) {
  const prep = stock.visualPreparation;
  if (!prep || typeof prep !== 'object') fail('visualPreparation is required', { stockId });
  if (typeof prep.prompt !== 'string' || !prep.prompt.trim()) fail('visualPreparation.prompt is required', { stockId });
  if (!Array.isArray(prep.evidence) || prep.evidence.length < 1) fail('visualPreparation.evidence is required', { stockId });
  for (const evidence of prep.evidence) if (!evidence || typeof evidence.description !== 'string' || !evidence.description.trim()) fail('Every visual evidence entry needs a description', { stockId });
  if (typeof prep.alt !== 'string' || !prep.alt.trim()) fail('visualPreparation.alt is required', { stockId });
  if (typeof prep.rights !== 'string' || !prep.rights.trim()) fail('visualPreparation.rights is required', { stockId });
  if (typeof prep.scope !== 'string' || !prep.scope.trim()) fail('visualPreparation.scope is required', { stockId });
  if (prep.aiGenerated !== true) fail('visualPreparation.aiGenerated must be true', { stockId });
}

function assertPendingStockObject(stock, stockId, context = 'current') {
  if (!stock || stock.stockId !== stockId || stock.candidate?.id !== stockId) fail('STOCK identity mismatch', { stockId, context, actualStockId: stock?.stockId, candidateId: stock?.candidate?.id });
  if (stock.status !== 'IMAGE_PENDING' || stock.visualStatus !== 'IMAGE_PENDING') fail('IMAGE STOCK target must be IMAGE_PENDING', { stockId, context, status: stock.status, visualStatus: stock.visualStatus });
  const top = stock.visuals;
  const nested = stock.candidate?.strainData?.visuals;
  if (!Array.isArray(top) || top.length !== 0 || !Array.isArray(nested) || nested.length !== 0) fail('IMAGE_PENDING requires both visual arrays to be empty', { stockId, context, topLevelVisuals: top, candidateVisuals: nested });
  assertVisualPreparation(stock, stockId);
}

function assertImagePreflight(stockIds, config) {
  const imageStock = getImageStockConfig(config);
  if (stockIds.length < 1 || stockIds.length > imageStock.batchSize) fail('IMAGE STOCK preflight requires 1..batchSize stock IDs', { supplied: stockIds.length, batchSize: imageStock.batchSize });
  if (new Set(stockIds).size !== stockIds.length) fail('Duplicate stockId supplied to IMAGE STOCK preflight', { stockIds });
  const checked = [];
  for (const stockId of stockIds) {
    if (!STOCK_ID_RE.test(stockId)) fail('Invalid stockId', { stockId });
    const stockPath = path.join(ROOT, expectedStockPath(stockId));
    if (!fs.existsSync(stockPath)) fail('STOCK item does not exist', { stockId, stockPath: expectedStockPath(stockId) });
    assertPendingStockObject(readJson(stockPath), stockId);
    const imagePath = path.join(ROOT, expectedImagePath(stockId, config));
    if (fs.existsSync(imagePath)) fail('IMAGE_PENDING target already has primary.webp; automatic overwrite is forbidden', { stockId, imagePath: expectedImagePath(stockId, config) });
    checked.push({ stockId, stockPath: expectedStockPath(stockId), imagePath: expectedImagePath(stockId, config) });
  }
  return checked;
}

function assertWebP(repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  if (!normalized.toLowerCase().endsWith('.webp')) fail('IMAGE STOCK file extension must be .webp', { repoPath: normalized });
  const full = path.join(ROOT, normalized);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) fail('IMAGE STOCK WebP file does not exist', { repoPath: normalized });
  const buf = fs.readFileSync(full);
  if (!(buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')) fail('IMAGE STOCK file is not a valid WebP container', { repoPath: normalized, size: buf.length });
  return { repoPath: normalized, size: buf.length };
}

function assertVisualObject(visual, stock, stockId, config) {
  const imageStock = getImageStockConfig(config);
  const required = ['role', 'src', 'aiGenerated', 'sourceType', 'rights', 'alt', 'scope'];
  if (!visual || typeof visual !== 'object' || Array.isArray(visual)) fail('READY visual must be an object', { stockId });
  const missing = required.filter(key => !(key in visual));
  const extra = Object.keys(visual).filter(key => !required.includes(key));
  if (missing.length || extra.length) fail('READY visual structure is not production-compatible', { stockId, missing, extra });
  if (visual.role !== 'primary') fail('READY visual role must be primary', { stockId });
  if (visual.src !== expectedImagePath(stockId, config)) fail('READY visual src does not match stockId image path', { stockId, src: visual.src, expected: expectedImagePath(stockId, config) });
  if (visual.aiGenerated !== true) fail('READY visual aiGenerated must be true', { stockId });
  if (visual.sourceType !== imageStock.sourceType) fail('READY visual sourceType does not match IMAGE STOCK policy', { stockId, sourceType: visual.sourceType });
  if (typeof visual.rights !== 'string' || typeof visual.alt !== 'string' || !visual.alt.trim() || !['cultivar', 'phenotype', 'product', 'lot'].includes(visual.scope)) fail('READY visual metadata invalid', { stockId });
  if (imageStock.visualPolicy.requirePreparationMetadataMatch && (visual.rights !== stock.visualPreparation.rights || visual.alt !== stock.visualPreparation.alt || visual.scope !== stock.visualPreparation.scope)) fail('READY visual metadata must match saved visualPreparation', { stockId });
}

function assertReadyStock(stockId, config) {
  const full = path.join(ROOT, expectedStockPath(stockId));
  if (!fs.existsSync(full)) fail('READY STOCK item does not exist', { stockId });
  const stock = readJson(full);
  if (stock.stockId !== stockId || stock.candidate?.id !== stockId) fail('READY STOCK identity mismatch', { stockId });
  if (stock.status !== 'READY' || stock.visualStatus !== 'READY') fail('READY STOCK must have status and visualStatus READY', { stockId, status: stock.status, visualStatus: stock.visualStatus });
  assertVisualPreparation(stock, stockId);
  const top = stock.visuals;
  const nested = stock.candidate?.strainData?.visuals;
  if (!Array.isArray(top) || top.length !== 1 || !Array.isArray(nested) || nested.length !== 1) fail('READY requires exactly one visual in both locations', { stockId });
  if (!sameContent(top, nested)) fail('READY visual arrays are not exactly synchronized', { stockId });
  assertVisualObject(top[0], stock, stockId, config);
  const webp = assertWebP(expectedImagePath(stockId, config));
  return { stock, visual: top[0], webp };
}

function readAndValidateImageRun(runPathArg, config) {
  const imageStock = getImageStockConfig(config);
  const normalized = normalizeRepoPath(runPathArg);
  const full = path.isAbsolute(runPathArg) ? runPathArg : path.join(ROOT, normalized);
  if (!fs.existsSync(full)) fail('IMAGE STOCK run record does not exist', { runPath: normalized });
  const run = readJson(full);
  if (run.schemaVersion !== imageStock.schemaVersion || !isNewImageRunId(run.runId, config)) fail('Invalid IMAGE STOCK run identity', { runId: run.runId, schemaVersion: run.schemaVersion });
  const expectedRunPath = expectedImageRunPath(run.runId, config);
  if (normalizeRepoPath(path.relative(ROOT, full)) !== expectedRunPath) fail('IMAGE STOCK run record path does not match runId', { expectedRunPath });
  if (!SHA_RE.test(run.baseSha || '')) fail('IMAGE STOCK run record requires a valid baseSha', { baseSha: run.baseSha });
  if (!Array.isArray(run.items) || run.items.length < 1 || run.items.length > imageStock.batchSize || new Set(run.items.map(i => i.stockId)).size !== run.items.length) fail('IMAGE STOCK run item count/identity invalid', { runId: run.runId });
  const tx = run.transaction || {};
  if (tx.branch !== 'master-migration' || tx.commitCount !== 1 || tx.refUpdateCount !== 1 || tx.forceUsed !== false || tx.branchCreated !== false || tx.method !== 'blob-tree-commit-ref-update') fail('IMAGE STOCK transaction policy violation', { runId: run.runId, transaction: tx });
  if (run.attempt < 1 || run.attempt > 2 || !Array.isArray(run.previousAttempts) || run.previousAttempts.length > 1) fail('IMAGE STOCK retry policy violation', { runId: run.runId });
  return { run, runPath: expectedRunPath };
}

function assertImageRunReadyState(run, config) {
  const imageStock = getImageStockConfig(config);
  const results = [];
  for (const item of run.items) {
    const stockId = item.stockId;
    if (!STOCK_ID_RE.test(stockId) || item.inputStatus !== 'IMAGE_PENDING') fail('IMAGE STOCK item must map from IMAGE_PENDING', { stockId });
    if (item.stockPath !== expectedStockPath(stockId) || item.imagePath !== expectedImagePath(stockId, config)) fail('IMAGE STOCK item path mismatch', { stockId });
    if (item.attachmentMapping?.confirmed !== true || typeof item.attachmentMapping?.sourceFileName !== 'string' || !item.attachmentMapping.sourceFileName.trim()) fail('Attachment image to stockId mapping is not explicitly confirmed', { stockId });
    if (item.webpVerified !== true) fail('IMAGE STOCK run must record webpVerified=true', { stockId });
    if (item.evidenceCheck?.result !== 'PASS' || typeof item.evidenceCheck?.note !== 'string' || !item.evidenceCheck.note.trim()) fail('Visual evidence check must explicitly PASS before READY', { stockId });
    const ready = assertReadyStock(stockId, config);
    const expectedEvidence = ready.stock.visualPreparation.evidence.map(entry => entry.description);
    if (!sameStringSet(item.evidenceCheck.checkedAgainst, expectedEvidence)) fail('Visual evidence check was not recorded against the current saved evidence', { stockId });
    if (!sameContent(item.visual, ready.visual)) fail('IMAGE STOCK run visual does not match synchronized READY visual', { stockId });
    if (imageStock.visualPolicy.requireEvidencePass !== true) fail('IMAGE STOCK evidence PASS policy must remain enabled', { stockId });
    results.push({ stockId, imagePath: item.imagePath, webpSize: ready.webp.size });
  }
  return results;
}

function assertPendingAtBase(run, base, config) {
  if (run.baseSha !== base) fail('IMAGE STOCK run baseSha does not match requested BASE_SHA', { runBaseSha: run.baseSha, base });
  for (const item of run.items) {
    assertPendingStockObject(readJsonAtRef(base, item.stockPath), item.stockId, 'BASE_SHA');
    if (pathExistsAtRef(base, item.imagePath)) fail('Target primary.webp already existed at BASE_SHA; overwrite is forbidden', { stockId: item.stockId, base, imagePath: item.imagePath });
  }
}

function expectedImageRunChangedFiles(run, config) {
  return [...run.items.flatMap(item => [expectedStockPath(item.stockId), expectedImagePath(item.stockId, config)]), expectedImageRunPath(run.runId, config)].sort();
}

function assertImageRunDiff(files, run, config) {
  const imageStock = getImageStockConfig(config);
  const normalized = [...files].map(normalizeRepoPath).sort();
  const expected = expectedImageRunChangedFiles(run, config);
  const outsideAllowed = normalized.filter(p => !imageStock.allowedWritePrefixes.some(prefix => p.startsWith(prefix)));
  const forbiddenInternal = normalized.filter(p => imageStock.forbiddenDuringImageRunPrefixes.some(prefix => p.startsWith(prefix)));
  if (outsideAllowed.length || forbiddenInternal.length || JSON.stringify(normalized) !== JSON.stringify(expected)) fail('IMAGE STOCK diff must contain only target STOCK JSON, target primary.webp, and one image run record', { files: normalized, expected, outsideAllowed, forbiddenInternal });
  return expected;
}

function assertAutoStockImageBoundary(files, config) {
  if (config.images?.mode !== 'disabled-v1' || config.images?.allowFiles !== false) fail('AUTO STOCK V1 image boundary is not disabled-v1/allowFiles=false', { images: config.images });
  const imageFiles = files.filter(p => p.startsWith('stock/images/') || p.startsWith('stock/image-runs/'));
  if (imageFiles.length) fail('AUTO STOCK V1 cannot write IMAGE STOCK files', { imageFiles });
  for (const repoPath of files.filter(p => /^stock\/items\/.+\.json$/.test(p))) {
    const full = path.join(ROOT, repoPath);
    if (!fs.existsSync(full)) fail('AUTO STOCK V1 cannot delete STOCK items', { repoPath });
    const stock = readJson(full);
    const nested = stock.candidate?.strainData?.visuals;
    if (stock.status === 'READY' || stock.visualStatus === 'READY' || (Array.isArray(stock.visuals) && stock.visuals.length) || (Array.isArray(nested) && nested.length)) fail('AUTO STOCK V1 cannot create READY images; use IMAGE STOCK V1', { repoPath });
    const readiness = evaluateProductionReadiness(stock.candidate?.strainData);
    if (!readiness.ready) fail('AUTO STOCK production-readiness failed', { repoPath, status: readiness.status, reasons: readiness.reasons });
  }
}

function duplicateScan(config) {
  const policy = config.duplicatePolicy;
  const records = { strain: [], source: [], entity: [] };
  const results = { matches: [], conflicts: [] };
  function add(kind, record) { if (record && typeof record.id === 'string' && record.id) records[kind].push(record); }
  function walkJson(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkJson(full, callback);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        let data; try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
        callback(data, normalizeRepoPath(path.relative(ROOT, full)));
      }
    }
  }
  if (policy.checkProduction) {
    walkJson(path.join(ROOT, 'strains'), (d, rel) => add('strain', { id: d.id, canonicalName: d.canonicalName ?? d.name, payload: d, path: rel, origin: 'production' }));
    walkJson(path.join(ROOT, 'sources'), (d, rel) => add('source', { id: d.id, url: d.url, payload: d, path: rel, origin: 'production' }));
    walkJson(path.join(ROOT, 'entities'), (d, rel) => add('entity', { id: d.id, canonicalName: d.canonicalName ?? d.name, payload: d, path: rel, origin: 'production' }));
  }
  if (policy.checkExistingStock) walkJson(path.join(ROOT, 'stock', 'items'), (d, rel) => {
    if (d.candidate && typeof d.candidate === 'object') add('strain', { id: d.candidate.id, canonicalName: d.candidate.canonicalName, payload: d.candidate.strainData ?? d.candidate, path: rel, origin: 'stock' });
    for (const s of Array.isArray(d.sources) ? d.sources : []) add('source', { id: s.id, url: s.url, payload: s.payload ?? s, path: rel, origin: 'stock' });
    for (const e of Array.isArray(d.entities) ? d.entities : []) add('entity', { id: e.id, canonicalName: e.canonicalName, payload: e.payload ?? e, path: rel, origin: 'stock' });
  });
  function compareKind(kind, keys) {
    const list = records[kind];
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j], matchedKeys = keys.filter(key => a[key] && b[key] && a[key] === b[key]);
      if (!matchedKeys.length) continue;
      const entry = { kind, matchedKeys, first: a.path, second: b.path, firstOrigin: a.origin, secondOrigin: b.origin, id: a.id === b.id ? a.id : undefined };
      if (a.id === b.id && !sameContent(a.payload, b.payload)) results.conflicts.push({ ...entry, status: policy.conflictingSameIdStatus, automaticOverwrite: policy.automaticOverwriteOnConflict, reason: 'Same ID has different content; automatic overwrite is forbidden.' });
      else results.matches.push({ ...entry, result: 'MATCH', reuse: true, reason: 'Existing equivalent key detected; reuse instead of duplicating.' });
    }
  }
  compareKind('strain', policy.strainKeys); compareKind('source', policy.sourceKeys); compareKind('entity', policy.entityKeys);
  return results;
}

const config = readJson(CONFIG_PATH);
const [command, ...args] = process.argv.slice(2);

if (!command || command === 'help') {
  console.log('AUTO STOCK V1 + IMAGE STOCK V1 guard');
  console.log('AUTO: precommit, postaudit, duplicates, runid, check-runid');
  console.log('IMAGE: image-runid, check-image-runid, image-preflight, image-precommit, image-postaudit');
  process.exit(0);
}

if (command === 'precommit') {
  const [base, head = 'HEAD'] = args;
  if (!base) fail('BASE_SHA is required');
  const files = changedFiles(base, head), forbidden = files.filter(p => isForbiddenPath(p, config)), outside = files.filter(p => !isAllowedPath(p, config));
  if (forbidden.length || outside.length) fail('Precommit scope violation', { files, forbidden, outside });
  assertAutoStockImageBoundary(files, config);
  ok('AUTO STOCK precommit scope passed; image creation remains disabled', { base, head, files, images: config.images });
} else if (command === 'postaudit') {
  const [base, end, mainStart, mainEnd] = args;
  if (![base, end, mainStart, mainEnd].every(v => SHA_RE.test(v || ''))) fail('Four 40-char SHAs are required');
  const files = changedFiles(base, end), outside = files.filter(p => !isAllowedPath(p, config));
  const protectedTrees = ['strains', 'sources', 'entities', 'runtime', '.github/workflows', 'images'], protectedFiles = ['data.js', 'sources.js'];
  const treeAudit = Object.fromEntries(protectedTrees.map(p => [p, { base: treeSha(base, p), end: treeSha(end, p) }]));
  const fileAudit = Object.fromEntries(protectedFiles.map(p => [p, { base: fileSha(base, p), end: fileSha(end, p) }]));
  const protectedTreesUnchanged = Object.values(treeAudit).every(x => x.base === x.end) && Object.values(fileAudit).every(x => x.base === x.end), mainUnchanged = mainStart === mainEnd, masterHeadChanged = base !== end;
  if (!masterHeadChanged || outside.length || !mainUnchanged || !protectedTreesUnchanged) fail('Post-write audit failed', { masterHeadChanged, files, outside, mainUnchanged, protectedTreesUnchanged, treeAudit, fileAudit });
  ok('Post-write audit passed', { masterHeadChanged, files, mainUnchanged, protectedTreesUnchanged, treeAudit, fileAudit });
} else if (command === 'duplicates') {
  const result = duplicateScan(config); if (result.conflicts.length) fail('Duplicate conflicts require NEEDS_REVIEW; automatic overwrite is forbidden', result); ok('Duplicate scan completed', result);
} else if (command === 'runid') {
  const generated = generateRunId(config, args); ok('Generated collision-free AUTO STOCK runId', { ...generated, path: `${config.runsRoot}${generated.runId}/run.json`, remoteCheckRequiredBeforeWrite: config.runIdentity.requireRemoteNonexistenceCheckBeforeWrite });
} else if (command === 'check-runid') {
  const [runId, ...remote] = args; if (!runId) fail('RUN_ID is required'); assertNewRunIdAvailable(runId, config, remote); ok('New AUTO STOCK runId is available', { runId });
} else if (command === 'image-runid') {
  const generated = generateImageRunId(config, args); ok('Generated collision-free IMAGE STOCK runId', { ...generated, path: expectedImageRunPath(generated.runId, config), remoteCheckRequiredBeforeWrite: getImageStockConfig(config).runIdentity.requireRemoteNonexistenceCheckBeforeWrite });
} else if (command === 'check-image-runid') {
  const [runId, ...remote] = args; if (!runId) fail('IMAGE RUN_ID is required'); assertNewImageRunIdAvailable(runId, config, remote); ok('New IMAGE STOCK runId is available', { runId, path: expectedImageRunPath(runId, config) });
} else if (command === 'image-preflight') {
  ok('IMAGE STOCK preflight passed; all targets are IMAGE_PENDING and have no primary.webp', { targets: assertImagePreflight(args, config) });
} else if (command === 'image-precommit') {
  const [base, runPath, head = 'HEAD'] = args; if (!SHA_RE.test(base || '') || !runPath) fail('IMAGE STOCK precommit requires BASE_SHA and IMAGE_RUN_JSON');
  const { run } = readAndValidateImageRun(runPath, config); if (run.audit?.baseMatchedBeforeWrite !== true) fail('IMAGE STOCK run must record baseMatchedBeforeWrite=true before commit', { runId: run.runId });
  assertPendingAtBase(run, base, config); const files = assertImageRunDiff(changedFiles(base, head), run, config), ready = assertImageRunReadyState(run, config); ok('IMAGE STOCK precommit passed', { base, head, runId: run.runId, files, ready });
} else if (command === 'image-postaudit') {
  const [base, end, mainStart, mainEnd, runPath] = args; if (![base, end, mainStart, mainEnd].every(v => SHA_RE.test(v || '')) || !runPath) fail('IMAGE STOCK postaudit requires four SHAs and IMAGE_RUN_JSON');
  const { run } = readAndValidateImageRun(runPath, config); assertPendingAtBase(run, base, config); const files = assertImageRunDiff(changedFiles(base, end), run, config);
  const protectedTrees = ['strains', 'sources', 'entities', 'runtime', '.github/workflows', 'images'], protectedFiles = ['data.js', 'sources.js'];
  const treeAudit = Object.fromEntries(protectedTrees.map(p => [p, { base: treeSha(base, p), end: treeSha(end, p) }])); const fileAudit = Object.fromEntries(protectedFiles.map(p => [p, { base: fileSha(base, p), end: fileSha(end, p) }]));
  const protectedTreesUnchanged = Object.values(treeAudit).every(x => x.base === x.end) && Object.values(fileAudit).every(x => x.base === x.end), mainUnchanged = mainStart === mainEnd, masterHeadChanged = base !== end, ready = assertImageRunReadyState(run, config);
  if (!masterHeadChanged || !mainUnchanged || !protectedTreesUnchanged) fail('IMAGE STOCK post-write audit failed', { masterHeadChanged, mainUnchanged, protectedTreesUnchanged, files, treeAudit, fileAudit });
  ok('IMAGE STOCK post-write audit passed', { masterHeadChanged, mainUnchanged, protectedTreesUnchanged, files, ready, treeAudit, fileAudit });
} else fail('Unknown command', { command });