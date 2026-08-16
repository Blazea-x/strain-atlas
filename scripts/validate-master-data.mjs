import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];
const warnings = [];

const WORKFLOW_STATUS = new Set(["draft","review","approved","published"]);
const INFO_STATUS = new Set(["confirmed","disputed","unknown"]);
const CONFIDENCE = new Set(["A","B","C"]);
const TYPE = new Set(["sativa","indica","hybrid","sativa-dominant-hybrid","indica-dominant-hybrid","balanced-hybrid","unknown"]);
const ENTITY_ROLE = new Set(["originator","breeder","seedCompany","producer","brand","distributor"]);
const SCOPE = new Set(["cultivar","phenotype","product","lot"]);
const BASIS = new Set(["registered","breederOfficial","seedCompanyOfficial","scientificPublication","specialistDatabase","historicalSource"]);
const GENERATION = new Set(["S1","F1","F2","BX1","IBL","unknown","other"]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const addError = (scope, message) => errors.push(`${scope}: ${message}`);
const addWarning = (scope, message) => warnings.push(`${scope}: ${message}`);
const hasText = value => typeof value === "string" && value.trim().length > 0;
const isObject = value => value && typeof value === "object" && !Array.isArray(value);
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const stripQuery = src => String(src ?? "").split("?")[0].split("#")[0];

function listJsonFiles(dir, nested = false) {
  if (!fs.existsSync(dir)) return [];
  if (!nested) return fs.readdirSync(dir).filter(name => name.endsWith(".json")).map(name => path.join(dir, name));
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    const stat = fs.statSync(child);
    if (stat.isDirectory()) {
      const candidate = path.join(child, "strain.json");
      if (fs.existsSync(candidate)) out.push(candidate);
    }
  }
  return out;
}

function loadRegistry(files, kind) {
  const map = new Map();
  for (const file of files) {
    let data;
    try { data = readJson(file); }
    catch (error) { addError(file, `JSON parse failed: ${error.message}`); continue; }
    const id = data?.id;
    const scope = `${kind}:${id || file}`;
    if (!hasText(id) || !ID_RE.test(id)) addError(scope, "invalid id");
    if (map.has(id)) addError(scope, `duplicate id also used by ${map.get(id).__file}`);
    data.__file = file;
    map.set(id, data);
  }
  return map;
}

const sourceFiles = listJsonFiles(path.join(ROOT, "sources"));
const entityFiles = listJsonFiles(path.join(ROOT, "entities"));
const strainFiles = listJsonFiles(path.join(ROOT, "strains"), true);
const sources = loadRegistry(sourceFiles, "source");
const entities = loadRegistry(entityFiles, "entity");
const strains = loadRegistry(strainFiles, "strain");

for (const source of sources.values()) {
  const scope = `source:${source.id}`;
  if (source.schemaVersion !== 1) addError(scope, "schemaVersion must be 1");
  for (const field of ["publisher","title","url","sourceType","checkedAt"]) if (!hasText(source[field])) addError(scope, `${field} is required`);
  if (!Array.isArray(source.supports) || source.supports.length === 0) addError(scope, "supports must contain at least one claim key");
  if (!Object.prototype.hasOwnProperty.call(source, "note")) addError(scope, "note must be present, even when empty");
}

for (const entity of entities.values()) {
  const scope = `entity:${entity.id}`;
  if (entity.schemaVersion !== 1) addError(scope, "schemaVersion must be 1");
  if (!hasText(entity.name)) addError(scope, "name is required");
  if (!Array.isArray(entity.roles) || entity.roles.length === 0) addError(scope, "roles must not be empty");
  for (const role of entity.roles ?? []) if (!ENTITY_ROLE.has(role)) addError(scope, `invalid role ${role}`);
  for (const field of ["checkedAt","updatedAt"]) if (!hasText(entity[field])) addError(scope, `${field} is required`);
}

function validateEvidence(claim, scope) {
  if (!isObject(claim)) { addError(scope, "claim must be an object"); return; }
  if (!INFO_STATUS.has(claim.status)) addError(scope, `invalid information status ${claim.status}`);
  if (claim.status === "confirmed" || claim.status === "disputed") {
    if (!CONFIDENCE.has(claim.confidence)) addError(scope, "confirmed/disputed claim requires confidence A/B/C");
    if (!BASIS.has(claim.basis)) addError(scope, "confirmed/disputed claim requires valid basis");
    if (!Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0) addError(scope, "confirmed/disputed claim requires sourceRefs");
  }
  for (const sourceId of claim.sourceRefs ?? []) if (!sources.has(sourceId)) addError(scope, `unknown sourceRef ${sourceId}`);
}

for (const strain of strains.values()) {
  const scope = `strain:${strain.id}`;
  const folder = path.basename(path.dirname(strain.__file));
  if (folder !== strain.id) addError(scope, `folder name ${folder} must match id`);
  if (strain.schemaVersion !== 1) addError(scope, "schemaVersion must be 1");
  if (!WORKFLOW_STATUS.has(strain.status)) addError(scope, `invalid workflow status ${strain.status}`);
  if (!hasText(strain.name)) addError(scope, "name is required");
  if (!(strain.jp === null || hasText(strain.jp))) addError(scope, "jp must be null or a non-empty string");
  if (!Array.isArray(strain.aliases)) addError(scope, "aliases must be an array");
  if (!TYPE.has(strain.classification?.type)) addError(scope, `invalid TYPE ${strain.classification?.type}`);
  if (!GENERATION.has(strain.breeding?.generation)) addError(scope, `invalid generation ${strain.breeding?.generation}`);

  validateEvidence(strain.lineage, `${scope}.lineage`);
  if (!Array.isArray(strain.lineage?.parents)) addError(`${scope}.lineage`, "parents must be an array");
  if (!Object.prototype.hasOwnProperty.call(strain.lineage ?? {}, "note")) addError(`${scope}.lineage`, "note must be present");

  for (const [key, claim] of [["aromas",strain.aromas],["terpenes",strain.terpenes],["history",strain.history],["origin",strain.origin]]) {
    if (claim === undefined) continue;
    validateEvidence(claim, `${scope}.${key}`);
    if ((key === "aromas" || key === "terpenes") && !Array.isArray(claim.items)) addError(`${scope}.${key}`, "items must be an array");
  }

  if (!Array.isArray(strain.relations)) addError(scope, "relations must be an array");
  for (const [index, relation] of (strain.relations ?? []).entries()) {
    const relScope = `${scope}.relations[${index}]`;
    if (!entities.has(relation.entityId)) addError(relScope, `unknown entityId ${relation.entityId}`);
    if (!Array.isArray(relation.roles) || relation.roles.length === 0) addError(relScope, "roles must not be empty");
    for (const role of relation.roles ?? []) if (!ENTITY_ROLE.has(role)) addError(relScope, `invalid role ${role}`);
    validateEvidence(relation, relScope);
  }

  // Empty visuals is an intentional image-pending state; populated visuals remain strictly validated.
  if (!Array.isArray(strain.visuals)) {
    addError(scope, "visuals must be an array");
  } else if (strain.visuals.length === 0) {
    addWarning(scope, "image pending");
  } else {
    const primaryCount = strain.visuals.filter(v => v.role === "primary").length;
    if (primaryCount !== 1) addError(scope, `exactly one primary visual is required, found ${primaryCount}`);
    for (const [index, visual] of strain.visuals.entries()) {
      const visualScope = `${scope}.visuals[${index}]`;
      if (!hasText(visual.role)) addError(visualScope, "role is required");
      if (!hasText(visual.src)) addError(visualScope, "src is required");
      if (typeof visual.aiGenerated !== "boolean") addError(visualScope, "aiGenerated must be boolean");
      if (!hasText(visual.sourceType)) addError(visualScope, "sourceType is required");
      if (typeof visual.rights !== "string") addError(visualScope, "rights must be present");
      if (!hasText(visual.alt)) addError(visualScope, "alt is required");
      if (!SCOPE.has(visual.scope)) addError(visualScope, `invalid scope ${visual.scope}`);
      const localPath = stripQuery(visual.src);
      if (!/^https?:\/\//i.test(localPath) && !fs.existsSync(path.join(ROOT, localPath))) addError(visualScope, `image file not found: ${localPath}`);
    }
  }

  for (const field of ["checkedAt","updatedAt"]) if (!hasText(strain[field])) addError(scope, `${field} is required`);
  if (strain.status === "published") warnings.push(`${scope}: published requires human approval; machine validation cannot verify approval state`);
}

console.log("\nCannabis Strain Wisdom MASTER validator V1");
console.log(`cultivars: ${strains.size} / sources: ${sources.size} / entities: ${entities.size}`);

if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length})`);
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.error(`\nERRORS (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("\nPASS: MASTER data references and controlled values are consistent.\n");
