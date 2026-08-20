(() => {
  "use strict";

  const shell = document.getElementById("detail-shell");
  if (!shell) return;

  const toneMap = Object.freeze({
    "alpha-pinene": "tone-1",
    "beta-pinene": "tone-2",
    myrcene: "tone-3",
    "beta-myrcene": "tone-3",
    limonene: "tone-4",
    terpinolene: "tone-5",
    linalool: "tone-6",
    caryophyllene: "tone-7",
    "beta-caryophyllene": "tone-7",
    ocimene: "tone-8",
    "trans-ocimene": "tone-8",
    guaiol: "tone-9"
  });
  const palette = Object.freeze(["tone-1", "tone-2", "tone-3", "tone-4", "tone-5", "tone-6", "tone-7", "tone-8", "tone-9"]);
  const toneClasses = new Set(palette);
  const normalize = value => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/[\s_–—]+/g, "-")
    .replace(/-+/g, "-");
  const toneFor = value => {
    const key = normalize(value);
    if (toneMap[key]) return toneMap[key];
    let hash = 0;
    for (const ch of key) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
    return palette[hash % palette.length];
  };

  const aromaToneMap = new Map();
  const registerAromaTone = (tone, values) => values.forEach(value => aromaToneMap.set(normalize(value), tone));
  registerAromaTone("aroma-sweet", ["sweet", "スイート", "crème", "クリーム", "vanilla", "バニラ", "sweet carrot", "スイート・キャロット"]);
  registerAromaTone("aroma-floral", ["floral", "フローラル", "flowers", "フラワー"]);
  registerAromaTone("aroma-citrus", ["lemon", "レモン", "citrus", "シトラス", "sweet citrus", "スイート・シトラス", "ripe mandarin", "熟したマンダリン", "orange", "オレンジ"]);
  registerAromaTone("aroma-fruit", ["fruity", "フルーティー", "tropical fruit", "トロピカルフルーツ", "exotic fruits", "エキゾチックフルーツ", "fresh fruit", "フレッシュフルーツ", "guava", "グアバ", "mango", "マンゴー", "strawberry", "ストロベリー"]);
  registerAromaTone("aroma-forest", ["pine", "パイン", "fresh forest", "フレッシュ・フォレスト", "fresh", "フレッシュ", "wood", "ウッド", "woody", "ウッディ"]);
  registerAromaTone("aroma-earth", ["earthy", "アーシー", "earthy hash", "アーシー・ハッシュ", "musky", "ムスク", "oil", "オイル", "resins", "レジン", "hazy", "ヘイズ"]);
  registerAromaTone("aroma-spice", ["spicy", "スパイシー", "sweet-spicy", "スイート・スパイシー", "anisette", "アニゼット", "aniseed", "アニスシード", "liquorice", "リコリス", "cloves", "クローブ", "incense", "インセンス", "sumac", "スマック", "savoury", "セイボリー"]);
  registerAromaTone("aroma-sharp", ["pungent", "パングェント", "gas", "ガス", "skunk", "スカンク", "sharp", "シャープ", "strong", "ストロング", "sour", "サワー", "tangy", "タンジー", "acidic", "アシディック"]);
  const aromaToneClasses = new Set(["aroma-sweet", "aroma-floral", "aroma-citrus", "aroma-fruit", "aroma-forest", "aroma-earth", "aroma-spice", "aroma-sharp"]);
  const aromaToneFor = value => aromaToneMap.get(normalize(value)) || "aroma-neutral";

  const styleId = "public-aroma-tone-v1";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.public-aroma-chip{border-color:var(--aroma-border);background:var(--aroma-bg);color:var(--aroma-text)}
.public-aroma-chip.aroma-sweet{--aroma-border:rgba(213,166,93,.44);--aroma-bg:rgba(147,99,35,.18);--aroma-text:#f3dfbd}
.public-aroma-chip.aroma-floral{--aroma-border:rgba(176,137,194,.44);--aroma-bg:rgba(111,74,132,.18);--aroma-text:#eadcf0}
.public-aroma-chip.aroma-citrus{--aroma-border:rgba(207,184,86,.46);--aroma-bg:rgba(149,119,32,.18);--aroma-text:#f3e9b8}
.public-aroma-chip.aroma-fruit{--aroma-border:rgba(197,126,135,.44);--aroma-bg:rgba(133,69,79,.18);--aroma-text:#f1d8dc}
.public-aroma-chip.aroma-forest{--aroma-border:rgba(96,177,137,.44);--aroma-bg:rgba(39,117,79,.18);--aroma-text:#d7eee1}
.public-aroma-chip.aroma-earth{--aroma-border:rgba(170,151,104,.44);--aroma-bg:rgba(110,91,48,.18);--aroma-text:#ece3cb}
.public-aroma-chip.aroma-spice{--aroma-border:rgba(197,133,91,.44);--aroma-bg:rgba(135,76,42,.18);--aroma-text:#f0d9c8}
.public-aroma-chip.aroma-sharp{--aroma-border:rgba(97,157,181,.44);--aroma-bg:rgba(49,101,124,.18);--aroma-text:#d7e8ee}
.public-aroma-chip.aroma-neutral{--aroma-border:rgba(129,157,139,.3);--aroma-bg:rgba(82,111,91,.12);--aroma-text:#d6e3d9}
`;
    document.head.appendChild(style);
  }

  function normalizeVisibleSensoryTones() {
    for (const chip of shell.querySelectorAll(".public-terpene-chip")) {
      for (const className of [...chip.classList]) if (toneClasses.has(className)) chip.classList.remove(className);
      chip.classList.add(toneFor(chip.textContent));
    }

    for (const card of shell.querySelectorAll(".public-sensory-card")) {
      const label = card.querySelector(".public-card-label")?.textContent.trim();
      if (label !== "香り") continue;
      for (const chip of card.querySelectorAll(".public-chip:not(.public-terpene-chip)")) {
        chip.classList.add("public-aroma-chip");
        for (const className of [...chip.classList]) if (aromaToneClasses.has(className) || className === "aroma-neutral") chip.classList.remove(className);
        chip.classList.add(aromaToneFor(chip.textContent));
      }
    }
  }

  const observer = new MutationObserver(normalizeVisibleSensoryTones);
  observer.observe(shell, { childList: true, subtree: true });
  normalizeVisibleSensoryTones();
})();
