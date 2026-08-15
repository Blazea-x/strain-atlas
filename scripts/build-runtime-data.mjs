import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const listJson = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => path.join(dir, entry.name))
  : [];

const strainRoot = path.join(ROOT, "strains");
const cultivarFiles = fs.readdirSync(strainRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(strainRoot, entry.name, "strain.json"))
  .filter(file => fs.existsSync(file));

const cultivars = cultivarFiles.map(readJson).sort((a, b) => a.name.localeCompare(b.name, "en"));
const sourceRecords = listJson(path.join(ROOT, "sources")).map(readJson);
const entityRecords = listJson(path.join(ROOT, "entities")).map(readJson);

const sources = Object.fromEntries(sourceRecords.map(source => [source.id, source]));
const entities = Object.fromEntries(entityRecords.map(entity => [entity.id, entity]));

const exploreMap = {
  "sativa": "sativa",
  "sativa-dominant-hybrid": "sativa",
  "indica": "indica",
  "indica-dominant-hybrid": "indica",
  "hybrid": "hybrid",
  "balanced-hybrid": "hybrid",
  "unknown": "unclassified"
};

const explore = { sativa: [], indica: [], hybrid: [], unclassified: [] };
for (const cultivar of cultivars) {
  const bucket = exploreMap[cultivar.classification?.type] ?? "unclassified";
  explore[bucket].push(cultivar.id);
}

const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceOfTruth: {
    cultivars: "strains/<id>/strain.json",
    sources: "sources/*.json",
    entities: "entities/*.json"
  },
  counts: {
    cultivars: cultivars.length,
    sources: sourceRecords.length,
    entities: entityRecords.length
  },
  explore,
  cultivars,
  sources,
  entities
};

const outDir = path.join(ROOT, "runtime");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "catalog.json");
fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`Built runtime/catalog.json: ${cultivars.length} cultivars / ${sourceRecords.length} sources / ${entityRecords.length} entities`);
