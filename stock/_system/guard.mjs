#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const ROOT = process.cwd();
const SYSTEM_DIR = path.join(ROOT, 'stock', '_system');
const CONFIG_PATH = path.join(SYSTEM_DIR, 'config.json');
const SHA_RE = /^[0-9a-f]{40}$/;

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
  if (!isNewRunId(runId, config)) {
    fail('New runId does not match the required timestamp-plus-random format', {
      runId,
      requiredPattern: config.runIdentity.newRunIdPattern
    });
  }
  if (localRunExists(runId, config) || remoteExistingRunIds.includes(runId)) {
    fail('runId collision detected; existing run must never be overwritten', { runId });
  }
  return true;
}

function duplicateScan(config) {
  const policy = config.duplicatePolicy;
  const records = { strain: [], source: [], entity: [] };
  const results = { matches: [], conflicts: [] };

  function add(kind, record) {
    if (!record || typeof record.id !== 'string' || !record.id) return;
    records[kind].push(record);
  }

  function walkJson(dir, callback) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkJson(full, callback);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        let data;
        try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
        callback(data, normalizeRepoPath(path.relative(ROOT, full)));
      }
    }
  }

  if (policy.checkProduction) {
    walkJson(path.join(ROOT, 'strains'), (data, rel) => {
      add('strain', { id: data.id, canonicalName: data.canonicalName ?? data.name, payload: data, path: rel, origin: 'production' });
    });
    walkJson(path.join(ROOT, 'sources'), (data, rel) => {
      add('source', { id: data.id, url: data.url, payload: data, path: rel, origin: 'production' });
    });
    walkJson(path.join(ROOT, 'entities'), (data, rel) => {
      add('entity', { id: data.id, canonicalName: data.canonicalName ?? data.name, payload: data, path: rel, origin: 'production' });
    });
  }

  if (policy.checkExistingStock) {
    walkJson(path.join(ROOT, 'stock', 'items'), (data, rel) => {
      if (data.candidate && typeof data.candidate === 'object') {
        add('strain', {
          id: data.candidate.id,
          canonicalName: data.candidate.canonicalName,
          payload: data.candidate.strainData ?? data.candidate,
          path: rel,
          origin: 'stock'
        });
      }
      for (const source of Array.isArray(data.sources) ? data.sources : []) {
        add('source', {
          id: source.id,
          url: source.url,
          payload: source.payload ?? source,
          path: rel,
          origin: 'stock'
        });
      }
      for (const entity of Array.isArray(data.entities) ? data.entities : []) {
        add('entity', {
          id: entity.id,
          canonicalName: entity.canonicalName,
          payload: entity.payload ?? entity,
          path: rel,
          origin: 'stock'
        });
      }
    });
  }

  function compareKind(kind, keys) {
    const list = records[kind];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const matchedKeys = keys.filter(key => a[key] && b[key] && a[key] === b[key]);
        if (!matchedKeys.length) continue;

        const sameId = a.id === b.id;
        const contentEqual = sameContent(a.payload, b.payload);
        const entry = {
          kind,
          matchedKeys,
          first: a.path,
          second: b.path,
          firstOrigin: a.origin,
          secondOrigin: b.origin,
          id: sameId ? a.id : undefined
        };

        if (sameId && !contentEqual) {
          results.conflicts.push({
            ...entry,
            status: policy.conflictingSameIdStatus,
            automaticOverwrite: policy.automaticOverwriteOnConflict,
            reason: 'Same ID has different content; automatic overwrite is forbidden.'
          });
        } else {
          results.matches.push({
            ...entry,
            result: 'MATCH',
            reuse: true,
            reason: 'Existing equivalent key detected; reuse instead of duplicating.'
          });
        }
      }
    }
  }

  compareKind('strain', policy.strainKeys);
  compareKind('source', policy.sourceKeys);
  compareKind('entity', policy.entityKeys);
  return results;
}

const config = readJson(CONFIG_PATH);
const [command, ...args] = process.argv.slice(2);

if (!command || command === 'help') {
  console.log('AUTO STOCK V1 guard');
  console.log('  node stock/_system/guard.mjs precommit <BASE_SHA> [HEAD]');
  console.log('  node stock/_system/guard.mjs postaudit <BASE_SHA> <END_SHA> <MAIN_START_SHA> <MAIN_END_SHA>');
  console.log('  node stock/_system/guard.mjs duplicates');
  console.log('  node stock/_system/guard.mjs runid [REMOTE_EXISTING_RUN_ID ...]');
  console.log('  node stock/_system/guard.mjs check-runid <RUN_ID> [REMOTE_EXISTING_RUN_ID ...]');
  process.exit(0);
}

if (command === 'precommit') {
  const [base, head = 'HEAD'] = args;
  if (!base) fail('BASE_SHA is required');
  const files = changedFiles(base, head);
  const forbidden = files.filter(p => isForbiddenPath(p, config));
  const outside = files.filter(p => !isAllowedPath(p, config));
  if (forbidden.length || outside.length) fail('Precommit scope violation', { files, forbidden, outside });
  ok('Precommit scope is restricted to stock/**', { base, head, files });
} else if (command === 'postaudit') {
  const [base, end, mainStart, mainEnd] = args;
  if (![base, end, mainStart, mainEnd].every(v => SHA_RE.test(v || ''))) fail('Four 40-char SHAs are required');
  const files = changedFiles(base, end);
  const outside = files.filter(p => !isAllowedPath(p, config));
  const protectedTrees = ['strains', 'sources', 'entities', 'runtime', '.github/workflows'];
  const protectedFiles = ['data.js', 'sources.js'];
  const treeAudit = Object.fromEntries(protectedTrees.map(p => [p, { base: treeSha(base, p), end: treeSha(end, p) }]));
  const fileAudit = Object.fromEntries(protectedFiles.map(p => [p, { base: fileSha(base, p), end: fileSha(end, p) }]));
  const protectedTreesUnchanged = Object.values(treeAudit).every(x => x.base === x.end) && Object.values(fileAudit).every(x => x.base === x.end);
  const mainUnchanged = mainStart === mainEnd;
  const masterHeadChanged = base !== end;
  if (!masterHeadChanged || outside.length || !mainUnchanged || !protectedTreesUnchanged) {
    fail('Post-write audit failed', { masterHeadChanged, files, outside, mainUnchanged, protectedTreesUnchanged, treeAudit, fileAudit });
  }
  ok('Post-write audit passed', { masterHeadChanged, files, mainUnchanged, protectedTreesUnchanged, treeAudit, fileAudit });
} else if (command === 'duplicates') {
  const result = duplicateScan(config);
  if (result.conflicts.length) {
    fail('Duplicate conflicts require NEEDS_REVIEW; automatic overwrite is forbidden', result);
  }
  ok('Duplicate scan completed', result);
} else if (command === 'runid') {
  const generated = generateRunId(config, args);
  ok('Generated collision-free AUTO STOCK runId', {
    ...generated,
    path: `${config.runsRoot}${generated.runId}/run.json`,
    remoteCheckRequiredBeforeWrite: config.runIdentity.requireRemoteNonexistenceCheckBeforeWrite
  });
} else if (command === 'check-runid') {
  const [runId, ...remoteExistingRunIds] = args;
  if (!runId) fail('RUN_ID is required');
  assertNewRunIdAvailable(runId, config, remoteExistingRunIds);
  ok('New runId is available in the supplied local/remote run set', {
    runId,
    path: `${config.runsRoot}${runId}/run.json`,
    remoteCheckRequiredBeforeWrite: config.runIdentity.requireRemoteNonexistenceCheckBeforeWrite
  });
} else {
  fail('Unknown command', { command });
}
