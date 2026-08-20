import fs from "node:fs";
import vm from "node:vm";

const catalog = JSON.parse(fs.readFileSync("runtime/smoke-catalog.json", "utf8"));
const rendererSource = fs.readFileSync("preview/detail-public-v1.js", "utf8");

const handlers = {};
const detailShell = {
  children: [{}],
  innerHTML: "",
  querySelector() { return null; },
  addEventListener() {}
};

globalThis.window = {
  __CSWDetailRendererSmoke: null,
  addEventListener(type, handler) { handlers[type] = handler; }
};
globalThis.document = {
  getElementById(id) { return id === "detail-shell" ? detailShell : null; }
};
globalThis.location = { href: "https://example.test/?strain=mazar" };
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() {}
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => catalog });

vm.runInThisContext(rendererSource, { filename: "preview/detail-public-v1.js" });

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
for (let i = 0; i < 50 && !window.__CSWDetailRendererSmoke; i += 1) await tick();

const smoke = window.__CSWDetailRendererSmoke;
if (!smoke) throw new Error("renderer smoke did not run");
if (smoke.total !== 38 || smoke.passed !== 38 || smoke.failures.length) {
  throw new Error(`renderer smoke failed: ${JSON.stringify(smoke)}`);
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function render(id) {
  location.href = `https://example.test/?strain=${id}`;
  detailShell.innerHTML = "<seed></seed>";
  assert(typeof handlers.popstate === "function", "popstate handler missing");
  handlers.popstate();
  await tick();
  await tick();
  return detailShell.innerHTML;
}

const mazar = await render("mazar");
assert(mazar.includes("<h2>Mazar</h2>"), "Mazar canonical title missing");
assert(!mazar.includes('class="detail-sub"'), "Mazar duplicate auxiliary name rendered");
assert(mazar.includes("Skunk #1 × Afghani"), "Mazar canonical lineage missing");

const bangi = await render("bangi-haze");
assert(bangi.includes("F8 stabilized Congolese/Nepalese hybrid"), "Bangi Haze canonical lineage.display missing");
assert(!/public-card-value">Congolese × Nepalese<\/div>/.test(bangi), "Bangi Haze lineage condensed from parents");

const og = await render("og-kush");
assert(/public-chip public-aroma-chip aroma-citrus">レモン<\/span>/.test(og), "OG Kush lemon tone mismatch");
assert(/public-chip public-aroma-chip aroma-forest">パイン<\/span>/.test(og), "OG Kush pine tone mismatch");
assert(/public-chip public-aroma-chip aroma-sharp">フューエル<\/span>/.test(og), "OG Kush fuel tone mismatch");
assert(/public-chip public-aroma-chip aroma-earth">アーシー<\/span>/.test(og), "OG Kush earthy tone mismatch");

const strawberryBananaS1 = await render("strawberry-banana-s1");
assert(strawberryBananaS1.includes("Original Strawberry Banana (selfed S1)"), "Strawberry Banana S1 canonical lineage.display missing");

const theOg18 = await render("the-og-18");
assert(/public-chip public-aroma-chip aroma-sharp">フューエル \/ ディーゼル<\/span>/.test(theOg18), "The OG #18 fuel/diesel tone mismatch");

const result = {
  passed: true,
  catalogCount: catalog?.counts?.cultivars,
  smoke,
  representatives: {
    mazar: { canonicalTitle: true, duplicateAuxiliaryName: false, lineage: "Skunk #1 × Afghani" },
    bangiHaze: { lineage: "F8 stabilized Congolese/Nepalese hybrid" },
    ogKush: { aromaTones: { "レモン": "aroma-citrus", "パイン": "aroma-forest", "フューエル": "aroma-sharp", "アーシー": "aroma-earth" } },
    strawberryBananaS1: { lineage: "Original Strawberry Banana (selfed S1)" },
    theOg18: { aromaTones: { "フューエル / ディーゼル": "aroma-sharp" } }
  },
  testedRendererBlob: "21cb97d45ce87b9b2e52597e103897c0e78c9e3f",
  masterCatalogBlob: "37b3994a19dfe061629053c2e4509428e65e7a40"
};

fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/detail-smoke-result.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(`DETAIL RENDERER SMOKE PASS ${smoke.passed}/${smoke.total}`);
