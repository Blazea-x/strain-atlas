#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { evaluateProductionReadiness } from './production-readiness-v1.mjs';

const ROOT = process.cwd();
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

const syntheticA = {
  lineage: { status: 'confirmed' },
  aromas: { status: 'unknown', items: [] },
  terpenes: { status: 'unknown', items: [] }
};
const caseA = evaluateProductionReadiness(syntheticA);
assert.equal(caseA.ready, false);
assert.deepEqual(caseA.reasons, ['PUBLIC_CONTENT_MISSING:lineageNote']);

const syntheticB = {
  origin: { status: 'confirmed' },
  lineage: { status: 'confirmed' },
  history: { status: 'disputed' },
  aromas: { status: 'confirmed', items: ['floral'] },
  terpenes: { status: 'confirmed', items: ['beta-myrcene'] },
  publicContent: { ja: {
    origin: '由来本文',
    lineageNote: '系統本文',
    history: '履歴本文',
    aromaNote: '香り本文',
    terpeneNote: 'テルペン本文'
  } }
};
const caseB = evaluateProductionReadiness(syntheticB);
assert.equal(caseB.ready, true);
assert.deepEqual(caseB.reasons, []);

const syntheticC = {
  origin: { status: 'unknown' },
  lineage: { status: 'unknown' },
  history: { status: 'unknown' },
  aromas: { status: 'unknown', items: [] },
  terpenes: { status: 'unknown', items: [] }
};
const caseC = evaluateProductionReadiness(syntheticC);
assert.equal(caseC.ready, true);
assert.deepEqual(caseC.reasons, []);

let legacy = null;
let benchmark = null;
const legacyPath = 'stock/items/apple-fritter-s1.json';
const benchmarkPath = 'strains/bangi-haze/strain.json';
if (fs.existsSync(path.join(ROOT, legacyPath))) {
  const stock = readJson(legacyPath);
  legacy = evaluateProductionReadiness(stock.candidate?.strainData);
  assert.equal(legacy.ready, false);
  assert.ok(legacy.reasons.includes('PUBLIC_CONTENT_MISSING:lineageNote'));
}
if (fs.existsSync(path.join(ROOT, benchmarkPath))) {
  benchmark = evaluateProductionReadiness(readJson(benchmarkPath));
  assert.equal(benchmark.ready, true);
  assert.deepEqual(benchmark.reasons, []);
}

console.log(JSON.stringify({
  ok: true,
  cases: {
    A: caseA,
    B: caseB,
    C: caseC,
    legacyAppleFritterS1: legacy,
    benchmarkBangiHaze: benchmark
  }
}, null, 2));
