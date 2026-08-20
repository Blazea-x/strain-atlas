import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("preview/detail-public-v1.js", "utf8");
const realFetch = globalThis.fetch;

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function renderDetail(strainId) {
  const queued = [];
  let fetchCount = 0;
  const shell = {
    children: strainId ? [{}] : [],
    innerHTML: "",
    addEventListener() {},
    querySelector() { return null; }
  };
  const sandbox = {
    console,
    URL,
    fetch: async (...args) => {
      fetchCount += 1;
      return realFetch(...args);
    },
    location: { href: strainId ? `https://example.invalid/?strain=${encodeURIComponent(strainId)}` : "https://example.invalid/" },
    document: { getElementById: id => id === "detail-shell" ? shell : null },
    MutationObserver: class { observe() {} },
    queueMicrotask: fn => queued.push(fn),
    window: { addEventListener() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "preview/detail-public-v1.js" });
  while (queued.length) await queued.shift()();
  return { shell, sandbox, fetchCount };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const home = await renderDetail("");
assert(home.fetchCount === 0, `HOME triggered detail catalog fetch (${home.fetchCount})`);

const bangi = await renderDetail("bangi-haze");
const b = bangi.shell.innerHTML;
assert(bangi.fetchCount === 1, `Bangi detail expected one public catalog fetch, got ${bangi.fetchCount}`);
assert(count(b, "<h2>Bangi Haze</h2>") === 1, "Bangi canonical Hero name is not exactly once");
assert(!b.slice(0, b.indexOf("</div>") + 6).includes("Bangi Haze"), "Bangi canonical name leaked into topbar");
assert(!/(?:正式登録名|Official name)\s*[:：]/i.test(b), "Bangi legacy official-name label rendered");
assert(!b.includes("detail-sub"), "Bangi jp:null rendered auxiliary name");
assert(b.includes('data-public-region="spec"') && b.includes("SPEC"), "Bangi SPEC missing");
assert(b.includes('data-public-region="profile"') && b.includes("PROFILE"), "Bangi PROFILE missing");
assert(b.includes('data-public-region="sources"') && b.includes("SOURCES"), "Bangi SOURCES missing");
assert(b.includes("サティバ"), "Bangi type missing");
assert(b.includes(">F8<"), "Bangi generation missing");
assert(b.includes("ACE Seeds") && b.includes("根拠 A"), "Bangi breeder/grade missing");
assert(!b.includes("THC含有量"), "Bangi unsupported THC tile rendered");
assert(b.includes("Congolese × Nepalese"), "Bangi lineage is not parent display");
assert(count(b, "public-aroma-chip") === 5, `Bangi aroma count ${count(b, "public-aroma-chip")}`);
assert(count(b, "public-terpene-chip") === 9, `Bangi terpene count ${count(b, "public-terpene-chip")}`);
assert(b.includes('data-profile-kind="origin"') && b.includes("根拠 A"), "Bangi origin missing");
assert(b.includes('data-profile-kind="history"') && b.includes("根拠 B"), "Bangi history missing");

const mazar = await renderDetail("mazar");
const m = mazar.shell.innerHTML;
assert(count(m, "<h2>Mazar</h2>") === 1, "Mazar canonical Hero name is not exactly once");
assert(!/(?:正式登録名|Official name)\s*[:：]/i.test(m), "Mazar legacy official-name label rendered");
assert(m.includes("インディカ"), "Mazar type missing");
assert(m.includes("THC含有量") && m.includes("約20%") && m.includes("根拠 A"), "Mazar THC regression");
assert(m.includes("Dutch Passion") && m.includes("根拠 A"), "Mazar breeder regression");
assert(m.includes('data-profile-kind="origin"'), "Mazar origin missing");
assert(m.includes("Skunk #1 × Afghani"), "Mazar lineage regression");
assert(m.includes("Dutch Passionは、この系譜を"), "Mazar lineage note missing");
assert(count(m, "public-aroma-chip") === 4, `Mazar aroma count ${count(m, "public-aroma-chip")}`);
assert(!m.includes('data-profile-kind="terpene"'), "Mazar terpene should remain hidden");
assert(m.includes('data-profile-kind="history"') && m.includes("根拠 B"), "Mazar history regression");
assert(m.includes("出典 1件"), "Mazar source count regression");
assert(!m.includes("CBD"), "Mazar CBD placeholder rendered");

const smokeContext = await renderDetail("");
const smoke = await smokeContext.sandbox.window.__CSWRunDetailRendererSmoke();
assert(smoke.total === 38, `renderer smoke expected 38 cultivars, got ${smoke.total}`);
assert(smoke.passed === 38 && smoke.failures.length === 0, `renderer smoke failures: ${JSON.stringify(smoke.failures)}`);

console.log(`DETAIL RENDERER SMOKE PASS ${smoke.passed}/${smoke.total}`);
console.log("BANGI HAZE REGRESSION PASS");
console.log("MAZAR REGRESSION PASS");
console.log("HOME DETAIL-IDLE PASS (0 detail fetches)");
