#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

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
  return p.replaceAll('\\\\', '/').replace(/^\.\//, '');
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

function duplicateScan() {
  const seen = new Map();
  const conflicts = [];
  const roots = [
    ['production-strain', path.join(ROOT, 'strains')],
    ['production-source', path.join(ROOT, 'sources')],
    ['production-entity', path.join(ROOT, 'entities')],
    ['stock', path.join(ROOT, 'stock', 'items')]
  ];

  function visit(kind, dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(kind, full);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        let data;
        try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
        const ids = [];
        if (typeof data.id === 'string') ids.push(data.id);
        if (typeof data.stockId === 'string') ids.push(data.stockId);
        if (data.candidate && typeof data.candidate.id === 'string') ids.push(data.candidate.id);
        for (const id of ids) {
          const key = `${kind.includes('source') ? 'source' : kind.includes('entity') ? 'entity' : 'strain'}:${id}`;
          const rel = normalizeRepoPath(path.relative(ROOT, full));
          if (seen.has(key) && seen.get(key) !== rel) conflicts.push({ key, first: seen.get(key), second: rel });
          else seen.set(key, rel);
        }
      }
    }
  }

  for (const [kind, dir] of roots) visit(kind, dir);
  return conflicts;
}

const config = readJson(CONFIG_PATH);
const [command, ...args] = process.argv.slice(2);

if (!command || command === 'help') {
  console.log('AUTO STOCK V1 guard');
  console.log('  node stock/_system/guard.mjs precommit <BASE_SHA> [HEAD]');
  console.log('  node stock/_system/guard.mjs postaudit <BASE_SHA> <END_SHA> <MAIN_START_SHA> <MAIN_END_SHA>');
  console.log('  node stock/_system/guard.mjs duplicates');
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
  const conflicts = duplicateScan();
  if (conflicts.length) fail('Duplicate/conflicting IDs require NEEDS_REVIEW', { conflicts });
  ok('No duplicate IDs detected by guard scan');
} else {
  fail('Unknown command', { command });
}
