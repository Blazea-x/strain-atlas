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

// Compatibility outputs for the current UI. These files are generated from
// MASTER records so the existing design can stay unchanged while the data
// source remains strains/, sources/, and entities/.
const typeLabels = {
  "sativa": "サティバ",
  "sativa-dominant-hybrid": "サティバ優勢",
  "indica": "インディカ",
  "indica-dominant-hybrid": "インディカ優勢",
  "hybrid": "ハイブリッド",
  "balanced-hybrid": "ハイブリッド",
  "unknown": "未分類"
};

const unique = values => [...new Set(values.filter(Boolean))];
const sourceRefsFor = cultivar => unique([
  ...(cultivar.lineage?.sourceRefs || []),
  ...(cultivar.aromas?.sourceRefs || []),
  ...(cultivar.terpenes?.sourceRefs || []),
  ...(cultivar.origin?.sourceRefs || []),
  ...(cultivar.history?.sourceRefs || []),
  ...(cultivar.relations || []).flatMap(relation => relation.sourceRefs || [])
]);

const confidenceFor = cultivar => {
  const parts = [];
  const add = (label, section) => {
    if (section?.confidence) parts.push(`${label} ${section.confidence}`);
  };
  add("LINEAGE", cultivar.lineage);
  add("AROMA", cultivar.aromas);
  add("TERPENE", cultivar.terpenes);
  add("ORIGIN", cultivar.origin);
  add("HISTORY", cultivar.history);
  return {
    display: parts.join(" / "),
    note: "正本データの項目別confidenceを表示"
  };
};

const legacyStrains = cultivars.map(cultivar => {
  const breederRelation = (cultivar.relations || []).find(relation => (relation.roles || []).includes("breeder"))
    || (cultivar.relations || []).find(relation => (relation.roles || []).includes("seedCompany"));
  const breederEntity = breederRelation ? entities[breederRelation.entityId] : null;
  const typeKey = cultivar.classification?.type || "unknown";

  return {
    id: cultivar.id,
    name: cultivar.name,
    jp: cultivar.jp || "",
    type: { key: typeKey, label: typeLabels[typeKey] || typeKey },
    aliases: cultivar.aliases || [],
    identity: {
      scope: "cultivar",
      note: "品種一般の情報。特定ロット・製品・フェノタイプを示すものではありません。"
    },
    lineage: {
      display: cultivar.lineage?.display || "",
      parents: cultivar.lineage?.parents || [],
      note: cultivar.lineage?.note || ""
    },
    aromas: cultivar.aromas?.items || [],
    breeder: { name: breederEntity?.name || "", era: "" },
    terpenes: cultivar.terpenes?.items || [],
    originHistory: cultivar.origin?.text || "",
    history: cultivar.history?.text || "",
    confidence: confidenceFor(cultivar),
    visuals: (cultivar.visuals || []).map(visual => ({
      ...visual,
      label: visual.role === "primary"
        ? "VISUAL REFERENCE"
        : visual.role === "aroma"
          ? "AROMA VISUAL"
          : String(visual.role || "VISUAL").toUpperCase()
    })),
    sourceIds: sourceRefsFor(cultivar),
    reviews: []
  };
});

const sourceTypeMap = {
  breederOfficial: { type: "primary", typeLabel: "一次情報" },
  specialistDatabase: { type: "specialist", typeLabel: "専門資料" },
  historicalSource: { type: "historical", typeLabel: "歴史資料" }
};

const legacySources = Object.fromEntries(sourceRecords.map(source => {
  const mapped = sourceTypeMap[source.sourceType] || { type: source.sourceType || "source", typeLabel: "資料" };
  return [source.id, {
    name: [source.publisher, source.title].filter(Boolean).join(" — ") || source.id,
    url: source.url || "#",
    type: mapped.type,
    typeLabel: mapped.typeLabel,
    checked: source.checkedAt || "",
    supports: source.supports || []
  }];
}));

fs.writeFileSync(
  path.join(ROOT, "data.js"),
  `window.STRAINS=${JSON.stringify(legacyStrains, null, 2)};\n`,
  "utf8"
);
fs.writeFileSync(
  path.join(ROOT, "sources.js"),
  `window.SOURCES=${JSON.stringify(legacySources, null, 2)};\n`,
  "utf8"
);

console.log(`Built runtime/catalog.json + display compatibility data: ${cultivars.length} cultivars / ${sourceRecords.length} sources / ${entityRecords.length} entities`);
