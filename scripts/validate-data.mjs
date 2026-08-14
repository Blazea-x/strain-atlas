import fs from "node:fs";
import vm from "node:vm";

const ROOT = process.cwd();
const errors = [];
const warnings = [];

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const isArray = Array.isArray;
const stripQuery = (src) => String(src ?? "").split("?")[0].split("#")[0];
const addError = (scope, message) => errors.push(`${scope}: ${message}`);
const addWarning = (scope, message) => warnings.push(`${scope}: ${message}`);

function loadBrowserData(file) {
  const source = fs.readFileSync(file, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  return sandbox.window;
}

let dataWindow;
let sourceWindow;
try {
  dataWindow = loadBrowserData("data.js");
  sourceWindow = loadBrowserData("sources.js");
} catch (error) {
  console.error(`❌ データファイルを読み込めません: ${error.message}`);
  process.exit(1);
}

const strains = dataWindow.STRAINS;
const sources = sourceWindow.SOURCES;

if (!isArray(strains)) addError("data.js", "window.STRAINS が配列ではありません");
if (!sources || typeof sources !== "object" || isArray(sources)) addError("sources.js", "window.SOURCES がオブジェクトではありません");

if (errors.length === 0) {
  const seenIds = new Map();
  const seenNames = new Map();
  const seenAliases = new Map();

  for (const [index, strain] of strains.entries()) {
    const scope = hasText(strain?.id) ? strain.id : `STRAINS[${index}]`;

    for (const [field, value] of [
      ["id", strain?.id],
      ["name", strain?.name],
      ["jp", strain?.jp],
      ["type.label", strain?.type?.label],
      ["identity.note", strain?.identity?.note],
      ["lineage.display", strain?.lineage?.display],
      ["confidence.display", strain?.confidence?.display],
      ["confidence.note", strain?.confidence?.note]
    ]) {
      if (!hasText(value)) addError(scope, `必須項目 ${field} が空です`);
    }

    if (!isArray(strain?.aliases)) addError(scope, "aliases は配列である必要があります");
    if (!isArray(strain?.aromas) || strain.aromas.length === 0) addError(scope, "aromas は1件以上必要です");
    if (!isArray(strain?.visuals) || strain.visuals.length === 0) addError(scope, "visuals は1件以上必要です");
    if (!isArray(strain?.sourceIds) || strain.sourceIds.length === 0) addError(scope, "sourceIds は1件以上必要です");
    if (!isArray(strain?.lineage?.parents)) addError(scope, "lineage.parents は配列である必要があります");

    const id = normalize(strain?.id);
    if (id) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) addError(scope, "id は小文字英数字とハイフンのみで指定してください");
      if (seenIds.has(id)) addError(scope, `id が ${seenIds.get(id)} と重複しています`);
      else seenIds.set(id, scope);
    }

    const canonicalName = normalize(strain?.name);
    if (canonicalName) {
      if (seenNames.has(canonicalName)) addError(scope, `品種名が ${seenNames.get(canonicalName)} と重複しています`);
      else seenNames.set(canonicalName, scope);
    }

    for (const alias of strain?.aliases ?? []) {
      const key = normalize(alias);
      if (!key) continue;
      const owner = seenAliases.get(key) ?? seenNames.get(key);
      if (owner && owner !== scope) addWarning(scope, `別名「${alias}」が ${owner} と重複しています`);
      else seenAliases.set(key, scope);
    }

    for (const sourceId of strain?.sourceIds ?? []) {
      if (!sources[sourceId]) addError(scope, `sourceIds の「${sourceId}」が sources.js に存在しません`);
    }

    for (const [visualIndex, visual] of (strain?.visuals ?? []).entries()) {
      const visualScope = `${scope} visuals[${visualIndex}]`;
      if (!hasText(visual?.src)) {
        addError(visualScope, "src が空です");
        continue;
      }
      const localPath = stripQuery(visual.src);
      if (/^https?:\/\//i.test(localPath)) {
        addWarning(visualScope, "外部画像URLはV1では存在確認できません");
      } else if (!fs.existsSync(`${ROOT}/${localPath}`)) {
        addError(visualScope, `画像ファイル「${localPath}」が存在しません`);
      }
      if (typeof visual?.aiGenerated !== "boolean") addError(visualScope, "aiGenerated は true / false を明示してください");
      if (!hasText(visual?.alt)) addWarning(visualScope, "alt が空です");
    }

    const confidence = String(strain?.confidence?.display ?? "");
    const claimsA = /(^|[^A-Za-z])A([^A-Za-z]|$)/.test(confidence);
    if (claimsA && isArray(strain?.sourceIds)) {
      const hasPrimary = strain.sourceIds.some((id) => sources[id]?.type === "primary");
      if (!hasPrimary) addError(scope, "Confidence A を含みますが一次情報 source がありません");
    }

    const lineageDisplay = String(strain?.lineage?.display ?? "");
    const lineageUncertain = /(確定していない|不明|諸説|複数説)/.test(lineageDisplay);
    if (lineageUncertain && (strain?.lineage?.parents?.length ?? 0) > 0) {
      addWarning(scope, "系譜が不確定表記ですが lineage.parents に親品種が入っています。断定になっていないか確認してください");
    }
  }

  for (const [sourceId, source] of Object.entries(sources)) {
    const scope = `source:${sourceId}`;
    if (!hasText(source?.name)) addError(scope, "name が空です");
    if (!hasText(source?.url)) addError(scope, "url が空です");
    if (!hasText(source?.type)) addError(scope, "type が空です");
    if (!hasText(source?.checked)) addWarning(scope, "checked（確認日）が空です");
    if (!isArray(source?.supports) || source.supports.length === 0) addWarning(scope, "supports が空です");
  }
}

console.log(`\n🔎 Cannabis Wisdom data validator V1`);
console.log(`品種: ${isArray(strains) ? strains.length : 0} / 出典: ${sources && typeof sources === "object" ? Object.keys(sources).length : 0}`);

if (warnings.length) {
  console.log(`\n⚠️ WARNINGS (${warnings.length})`);
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.error(`\n❌ ERRORS (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  console.error("\n公開前チェックに失敗しました。上記エラーを修正してください。\n");
  process.exit(1);
}

console.log(`\n✅ PASS: 重大なデータ矛盾は見つかりませんでした${warnings.length ? `（警告 ${warnings.length}件）` : ""}。\n`);
