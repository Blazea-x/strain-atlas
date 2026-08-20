(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/runtime/catalog.json";
  const ASSET_BASE = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/";
  const detailShell = document.getElementById("detail-shell");
  if (!detailShell) return;

  const typeLabels = Object.freeze({
    sativa: "サティバ",
    indica: "インディカ",
    hybrid: "ハイブリッド",
    "sativa-dominant-hybrid": "サティバ優勢ハイブリッド",
    "indica-dominant-hybrid": "インディカ優勢ハイブリッド"
  });

  const aromaLabels = Object.freeze({
    earthy: "アーシー",
    pine: "パイン",
    pungent: "パングェント",
    sweet: "スイート",
    spicy: "スパイシー",
    "sweet citrus": "スイート・シトラス",
    floral: "フローラル",
    musky: "ムスク",
    lemon: "レモン",
    anisette: "アニゼット",
    gas: "ガス",
    guava: "グアバ",
    "crème": "クリーム",
    sumac: "スマック",
    tangy: "タンジー",
    "tropical fruit": "トロピカルフルーツ",
    hazy: "ヘイズ",
    aniseed: "アニスシード",
    liquorice: "リコリス",
    cloves: "クローブ",
    "fresh forest": "フレッシュ・フォレスト",
    citrus: "シトラス",
    fruity: "フルーティー",
    sharp: "シャープ",
    savoury: "セイボリー",
    "sweet-spicy": "スイート・スパイシー",
    fresh: "フレッシュ",
    "exotic fruits": "エキゾチックフルーツ",
    oil: "オイル",
    wood: "ウッド",
    "sweet carrot": "スイート・キャロット",
    "ripe mandarin": "熟したマンダリン",
    "earthy hash": "アーシー・ハッシュ",
    incense: "インセンス",
    vanilla: "バニラ",
    strawberry: "ストロベリー",
    sour: "サワー",
    woody: "ウッディ",
    skunk: "スカンク",
    strong: "ストロング",
    acidic: "アシディック",
    "fresh fruit": "フレッシュフルーツ",
    mango: "マンゴー",
    orange: "オレンジ",
    flowers: "フラワー",
    resins: "レジン",
    fuel: "フューエル",
    "fuel / diesel": "フューエル / ディーゼル",
    bubblegum: "バブルガム",
    berry: "ベリー",
    banana: "バナナ",
    pepper: "ペッパー",
    coffee: "コーヒー",
    chocolate: "チョコレート",
    "sweet vanilla": "スイートバニラ",
    chestnut: "チェスナット",
    "lemon zest": "レモンゼスト",
    "earthy / musk": "アーシー / ムスク",
    "gas / fuel": "ガス / フューエル"
  });

  const normalizeSensoryKey = value => String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/[\s_‐‑‒–—―]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const terpeneToneMap = Object.freeze({
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
  const terpeneTonePalette = Object.freeze(["tone-1", "tone-2", "tone-3", "tone-4", "tone-5", "tone-6", "tone-7", "tone-8", "tone-9"]);
  const terpeneTone = value => {
    const compound = normalizeSensoryKey(value);
    if (terpeneToneMap[compound]) return terpeneToneMap[compound];
    let hash = 0;
    for (const ch of compound) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
    return terpeneTonePalette[hash % terpeneTonePalette.length];
  };

  const aromaToneMap = new Map();
  const registerAromaTone = (tone, values) => values.forEach(value => {
    aromaToneMap.set(normalizeSensoryKey(value), tone);
    const localized = aromaLabels[value];
    if (localized) aromaToneMap.set(normalizeSensoryKey(localized), tone);
  });
  registerAromaTone("aroma-sweet", ["sweet", "crème", "vanilla", "sweet carrot", "bubblegum", "chocolate", "sweet vanilla"]);
  registerAromaTone("aroma-floral", ["floral", "flowers"]);
  registerAromaTone("aroma-citrus", ["lemon", "citrus", "sweet citrus", "ripe mandarin", "orange", "lemon zest"]);
  registerAromaTone("aroma-fruit", ["fruity", "tropical fruit", "exotic fruits", "fresh fruit", "guava", "mango", "strawberry", "berry", "banana"]);
  registerAromaTone("aroma-forest", ["pine", "fresh forest", "fresh", "wood", "woody"]);
  registerAromaTone("aroma-earth", ["earthy", "earthy hash", "musky", "oil", "resins", "hazy", "coffee", "chestnut", "earthy / musk"]);
  registerAromaTone("aroma-spice", ["spicy", "sweet-spicy", "anisette", "aniseed", "liquorice", "cloves", "incense", "sumac", "savoury", "pepper"]);
  registerAromaTone("aroma-sharp", ["pungent", "gas", "skunk", "sharp", "strong", "sour", "tangy", "acidic", "fuel", "fuel / diesel", "gas / fuel"]);
  const aromaTone = value => aromaToneMap.get(normalizeSensoryKey(value)) || "aroma-neutral";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
  const asset = src => /^https?:\/\//i.test(src || "") ? src : ASSET_BASE + String(src || "").replace(/^\/+/, "");
  const hasJapanese = value => /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
  const primaryVisual = cultivar => (cultivar.visuals || []).find(item => item.role === "primary") || (cultivar.visuals || [])[0];
  const isFormalGeneration = value => /^(?:S1|F[1-9][0-9]*|BX[1-9][0-9]*|IBL)$/.test(String(value || "").trim());
  const displayType = cultivar => typeLabels[cultivar?.classification?.type] || "";
  const displayGeneration = cultivar => isFormalGeneration(cultivar?.breeding?.generation) ? String(cultivar.breeding.generation).trim() : "";
  const displayAroma = value => aromaLabels[String(value)] || String(value || "");
  const gradeBadge = claim => ["A", "B", "C"].includes(claim?.confidence)
    ? `<span class="public-grade grade-${claim.confidence.toLowerCase()}">根拠 ${esc(claim.confidence)}</span>`
    : "";

  const normalizeIdentityValue = value => String(value ?? "").trim().replace(/[\s\u3000]+/g, " ");
  const stripKnownNamePrefix = value => normalizeIdentityValue(value).replace(/^(?:正式登録名|Official name)\s*[:：]\s*/i, "");
  const isCanonicalNameDuplicate = (value, cultivar) => {
    const candidate = stripKnownNamePrefix(value);
    const canonical = normalizeIdentityValue(cultivar?.name);
    return Boolean(candidate && canonical && candidate === canonical);
  };
  const auxiliaryName = cultivar => {
    const raw = String(cultivar?.jp ?? "").trim();
    return !raw || isCanonicalNameDuplicate(raw, cultivar) ? "" : raw;
  };
  const publicJapanese = (cultivar, key) => {
    const value = cultivar?.publicContent?.ja?.[key];
    return typeof value === "string" ? value.trim() : "";
  };

  let catalogPromise;
  const getCatalog = () => {
    if (!catalogPromise) {
      catalogPromise = fetch(`${DATA_URL}?detail=${Date.now()}`, { cache: "no-store" })
        .then(response => {
          if (!response.ok) throw new Error(`runtime catalog HTTP ${response.status}`);
          return response.json();
        })
        .then(catalog => {
          auditMappings(catalog);
          return catalog;
        })
        .catch(error => {
          console.warn("detail public renderer catalog unavailable", error);
          return null;
        });
    }
    return catalogPromise;
  };

  function auditMappings(catalog) {
    const types = new Set();
    const unmappedTypes = new Set();
    const generations = new Set();
    const unmappedAromas = new Set();
    for (const cultivar of catalog?.cultivars || []) {
      const type = String(cultivar.classification?.type || "").trim();
      if (type) types.add(type);
      if (type && type !== "unknown" && !typeLabels[type]) unmappedTypes.add(type);
      const generation = String(cultivar.breeding?.generation || "").trim();
      if (generation) generations.add(generation);
      for (const aroma of cultivar.aromas?.items || []) {
        const value = String(aroma || "");
        if (/[A-Za-z]/.test(value) && !aromaLabels[value]) unmappedAromas.add(value);
      }
    }
    console.info("[CSW detail] canonical types", [...types].sort());
    console.info("[CSW detail] canonical generations", [...generations].sort());
    if (unmappedTypes.size) console.warn("[CSW detail] unmapped type values hidden", [...unmappedTypes].sort());
    if (unmappedAromas.size) console.warn("[CSW detail] unmapped aroma values kept in source language", [...unmappedAromas].sort());
  }

  function sourceRefsFor(cultivar) {
    const refs = [];
    const cannabinoidClaims = Object.values(cultivar.cannabinoids || {});
    for (const claim of [cultivar.lineage, cultivar.aromas, cultivar.terpenes, ...cannabinoidClaims, cultivar.origin, cultivar.history]) {
      refs.push(...(claim?.sourceRefs || []));
    }
    for (const relation of cultivar.relations || []) refs.push(...(relation.sourceRefs || []));
    return [...new Set(refs)];
  }

  function sourcesForRefs(catalog, refs) {
    return [...new Set(refs || [])].map(id => catalog?.sources?.[id]).filter(source => source?.url);
  }

  function uniqueSourcesWithinSection(sources) {
    const seenUrls = new Set();
    return (sources || []).filter(source => {
      const url = String(source?.url || "");
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
  }

  function sourceLinks(sources) {
    const uniqueSources = uniqueSourcesWithinSection(sources);
    if (!uniqueSources.length) return "";
    return `<div class="public-source-list">${uniqueSources.map(source => {
      const title = String(source.title || "").trim();
      const publisher = String(source.publisher || "").trim();
      const identity = [title, publisher && publisher !== title ? publisher : ""].filter(Boolean).join(" | ") || "公式資料";
      return `<a class="public-source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>情報源</span><strong>${esc(identity)} <i aria-hidden="true">↗</i></strong></a>`;
    }).join("")}</div>`;
  }

  function publicCard(cultivarId, kind, label, value, deep, grade = "", extraClass = "", keepStatic = false) {
    const hasValue = Boolean(String(value || "").trim());
    const hasDeep = Boolean(String(deep || "").trim());
    if (!hasValue && !hasDeep && !keepStatic) return "";
    if (!hasDeep) {
      return `<section class="public-card public-static-card ${extraClass}" data-profile-kind="${esc(kind)}">
        <div class="public-section-head"><span class="public-card-label">${esc(label)}</span>${grade}</div>
        ${hasValue ? `<div class="public-card-value">${value}</div>` : ""}
      </section>`;
    }
    const id = `public-detail-${cultivarId}-${kind}`;
    const closedLabel = `${label}の詳細を表示`;
    const openLabel = `${label}の詳細を閉じる`;
    return `<section class="public-card public-detail-action ${extraClass}" data-detail-action data-profile-kind="${esc(kind)}">
      <button class="public-detail-toggle" type="button" aria-expanded="false" aria-controls="${esc(id)}" aria-label="${esc(closedLabel)}" data-closed-label="${esc(closedLabel)}" data-open-label="${esc(openLabel)}" data-detail-toggle>
        <span class="public-card-copy"><span class="public-card-label">${esc(label)}</span>${hasValue ? `<span class="public-card-value">${value}</span>` : ""}${grade}</span>
        <span class="public-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="public-detail-deep" id="${esc(id)}">${deep}</div>
    </section>`;
  }

  function breederBasics(catalog, cultivar) {
    const relations = (cultivar.relations || []).filter(relation => (relation.roles || []).includes("breeder"));
    if (!relations.length) return null;
    const rows = relations.map(relation => {
      const entity = catalog.entities?.[relation.entityId];
      const name = String(entity?.name || relation.entityId || "").trim();
      return { relation, name };
    }).filter(row => row.name);
    return rows.length ? rows : null;
  }

  function breederSpecCard(catalog, cultivar) {
    const rows = breederBasics(catalog, cultivar);
    if (!rows) return "";
    return `<section class="public-card public-static-card public-spec-card public-breeder-card" data-spec-kind="breeder">
      <div class="public-card-label">ブリーダー</div>
      <div class="public-breeder-values">${rows.map(row => `<div class="public-breeder-value"><span class="public-card-value">${esc(row.name)}</span>${gradeBadge(row.relation)}</div>`).join("")}</div>
    </section>`;
  }

  function simpleSpecCard(kind, label, value) {
    return value ? `<section class="public-card public-static-card public-spec-card" data-spec-kind="${esc(kind)}"><div class="public-card-label">${esc(label)}</div><div class="public-card-value">${esc(value)}</div></section>` : "";
  }

  function safeLineageValue(cultivar) {
    if (!cultivar.lineage || cultivar.lineage.status === "unknown") return "";
    const parents = (cultivar.lineage.parents || []).filter(Boolean);
    if (parents.length >= 2) return parents.map(esc).join(" × ");
    const display = String(cultivar.lineage.display || "").trim();
    if (display) return esc(display);
    if (parents.length === 1) return esc(parents[0]);
    return "";
  }

  function textClaimCard(cultivar, kind, label, claim) {
    if (!claim || claim.status === "unknown") return "";
    const text = String(claim.text || "").trim();
    const value = text && hasJapanese(text) ? esc(text) : "";
    const prose = publicJapanese(cultivar, kind);
    const deep = prose ? `<p>${esc(prose)}</p>` : "";
    const grade = gradeBadge(claim);
    return publicCard(cultivar.id, kind, label, value, deep, grade, "public-profile-card", Boolean(grade));
  }

  function lineageCard(cultivar) {
    const claim = cultivar.lineage;
    if (!claim || claim.status === "unknown") return "";
    const value = safeLineageValue(cultivar);
    const prose = publicJapanese(cultivar, "lineageNote");
    const deep = prose ? `<p>${esc(prose)}</p>` : "";
    const grade = gradeBadge(claim);
    return publicCard(cultivar.id, "lineage", "系譜", value, deep, grade, "public-profile-card", Boolean(grade));
  }

  function sensoryCard(label, claim, kind) {
    const items = claim?.items || [];
    if (!items.length) return "";
    const chips = items.map(item => {
      const shown = kind === "aroma" ? displayAroma(item) : String(item);
      const tone = kind === "aroma" ? aromaTone(item) : terpeneTone(item);
      const chipClass = kind === "aroma"
        ? `public-chip public-aroma-chip ${tone}`
        : `public-chip public-terpene-chip ${tone}`;
      return `<span class="${chipClass}">${esc(shown)}</span>`;
    }).join("");
    return `<section class="public-card public-static-card public-sensory-card public-profile-card" data-profile-kind="${esc(kind)}"><div class="public-section-head"><span class="public-card-label">${esc(label)}</span>${gradeBadge(claim)}</div><div class="public-chips">${chips}</div></section>`;
  }

  const percentText = value => typeof value === "number" && Number.isFinite(value) ? String(value) : "";

  function cannabinoidMeasurementText(measurement) {
    if (!measurement || measurement.unit !== "%") return "";
    const approximate = measurement.approximate ? "約" : "";
    if (measurement.kind === "range") {
      const min = percentText(measurement.min);
      const max = percentText(measurement.max);
      return min && max ? `${approximate}${min}〜${max}%` : "";
    }
    const value = percentText(measurement.value);
    if (!value) return "";
    if (measurement.kind === "single") return `${approximate}${value}%`;
    if (measurement.kind === "maximum") return `最大${approximate}${value}%`;
    if (measurement.kind === "less-than") return `${approximate}${value}%未満`;
    return "";
  }

  function cannabinoidSpecCard(cultivar) {
    const rows = [["THC", cultivar.cannabinoids?.thc], ["CBD", cultivar.cannabinoids?.cbd]].map(([label, claim]) => ({
      label,
      claim,
      value: claim?.status === "unknown" ? "" : cannabinoidMeasurementText(claim?.measurement)
    })).filter(row => row.value);
    if (!rows.length) return { html: "", hasData: false };

    const cardLabel = rows.length === 1 ? `${rows[0].label}含有量` : "THC / CBD";
    if (rows.length === 1) {
      const row = rows[0];
      return {
        hasData: true,
        html: `<section class="public-card public-static-card public-spec-card public-cannabinoid-card" data-spec-kind="cannabinoid"><div class="public-section-head"><span class="public-card-label">${esc(cardLabel)}</span>${gradeBadge(row.claim)}</div><strong class="public-card-value public-cannabinoid-value">${esc(row.value)}</strong></section>`
      };
    }

    const first = rows[0];
    const sharedConfidence = rows.every(row => row.claim?.confidence === first.claim?.confidence);
    const sharedGrade = sharedConfidence ? gradeBadge(first.claim) : "";
    const values = rows.map(row => `<div class="public-cannabinoid-row"><span class="public-cannabinoid-name">${esc(row.label)}</span><strong class="public-cannabinoid-value">${esc(row.value)}</strong>${sharedConfidence ? "" : gradeBadge(row.claim)}</div>`).join("");
    return {
      hasData: true,
      html: `<section class="public-card public-static-card public-spec-card public-cannabinoid-card" data-spec-kind="cannabinoid"><div class="public-section-head"><span class="public-card-label">${esc(cardLabel)}</span>${sharedGrade}</div><div class="public-cannabinoid-values">${values}</div></section>`
    };
  }

  function regionHeading(kicker, title, id) {
    return `<header class="public-region-head"><span class="public-region-kicker">${esc(kicker)}</span><h3 id="${esc(id)}">${esc(title)}</h3></header>`;
  }

  function sourcesRegion(cultivar, allSources) {
    if (!allSources.length) return "";
    const deep = sourceLinks(allSources);
    const card = publicCard(cultivar.id, "sources", "出典", `出典 ${allSources.length}件`, deep, "", "public-sources-card", false);
    const id = `public-sources-title-${cultivar.id}`;
    return `<section class="public-region public-sources-region" aria-labelledby="${esc(id)}" data-public-region="sources">${regionHeading("SOURCES", "出典", id)}${card}</section>`;
  }

  function renderPublicDetailMarkup(catalog, cultivar) {
    const visual = primaryVisual(cultivar);
    const type = displayType(cultivar);
    const generation = displayGeneration(cultivar);
    const auxiliary = auxiliaryName(cultivar);
    const allSources = uniqueSourcesWithinSection(sourcesForRefs(catalog, sourceRefsFor(cultivar)));
    const cannabinoid = cannabinoidSpecCard(cultivar);

    const specCards = [
      simpleSpecCard("type", "タイプ", type),
      cannabinoid.html,
      simpleSpecCard("generation", "世代", generation),
      breederSpecCard(catalog, cultivar)
    ].filter(Boolean);
    const specId = `public-spec-title-${cultivar.id}`;
    const specRegion = specCards.length
      ? `<section class="public-region public-spec-region" aria-labelledby="${esc(specId)}" data-public-region="spec">${regionHeading("SPEC", "基本スペック", specId)}<div class="public-spec-grid" data-spec-count="${specCards.length}">${specCards.join("")}</div>${cannabinoid.hasData ? `<p class="public-cannabinoid-note">含有量は個体・栽培条件・分析ロット等により変動します。</p>` : ""}</section>`
      : "";

    const profileCards = [
      textClaimCard(cultivar, "origin", "起源", cultivar.origin),
      lineageCard(cultivar),
      sensoryCard("香り", cultivar.aromas, "aroma"),
      sensoryCard("テルペン", cultivar.terpenes, "terpene"),
      textClaimCard(cultivar, "history", "歴史", cultivar.history)
    ].filter(Boolean);
    const profileId = `public-profile-title-${cultivar.id}`;
    const profileRegion = profileCards.length
      ? `<section class="public-region public-profile" aria-labelledby="${esc(profileId)}" data-public-region="profile">${regionHeading("PROFILE", "品種プロフィール", profileId)}<div class="public-profile-stack">${profileCards.join("")}</div></section>`
      : "";

    return `
      <div class="detail-topbar detail-topbar-public"><span class="detail-topbar-line" aria-hidden="true"></span><button class="close-detail" type="button" aria-label="詳細を閉じる">×</button></div>
      <header class="detail-hero public-detail-hero${visual ? "" : " public-detail-hero-no-visual"}">
        ${visual ? `<div class="public-hero-media"><img src="${esc(asset(visual.src))}" alt="${esc(visual.alt || "")}"></div>` : ""}
        <div class="detail-hero-copy public-hero-copy"><span class="public-hero-kicker">CULTIVAR</span><h2>${esc(cultivar.name)}</h2>${auxiliary ? `<div class="detail-sub">${esc(auxiliary)}</div>` : ""}</div>
      </header>
      <main class="detail-public-v1" data-public-detail-id="${esc(cultivar.id)}">
        ${specRegion}${profileRegion}${sourcesRegion(cultivar, allSources)}
      </main>
    `;
  }

  function renderPublicDetail(catalog, cultivar) {
    detailShell.innerHTML = renderPublicDetailMarkup(catalog, cultivar);
  }

  function runRendererSmoke(catalog) {
    const failures = [];
    let passed = 0;
    const cultivars = catalog?.cultivars || [];
    for (const cultivar of cultivars) {
      try {
        const markup = renderPublicDetailMarkup(catalog, cultivar);
        const encodedName = esc(cultivar.name);
        const heroNeedle = `<h2>${encodedName}</h2>`;
        const heroNameCount = markup.split(heroNeedle).length - 1;
        if (heroNameCount !== 1) throw new Error(`canonical name count ${heroNameCount}`);
        const topbarEnd = markup.indexOf("</div>");
        const topbarMarkup = topbarEnd >= 0 ? markup.slice(0, topbarEnd + 6) : "";
        if (topbarMarkup.includes(encodedName)) throw new Error("canonical name leaked into topbar");
        if (/(?:正式登録名|Official name)\s*[:：]/i.test(markup)) throw new Error("legacy official-name label rendered");
        if (/data-public-region="spec"/.test(markup) && !/data-spec-count="[1-9][0-9]*"/.test(markup)) throw new Error("empty spec region");
        if (/data-public-region="profile"/.test(markup) && !/class="public-profile-stack">\s*<section class="public-card/.test(markup)) throw new Error("empty profile region");
        if (/data-public-region="sources"/.test(markup) && !/public-sources-card/.test(markup)) throw new Error("empty sources region");
        if (/(?:UNKNOWN|未登録|日本語表記は現在未確認)/.test(markup)) throw new Error("unknown placeholder rendered");
        const profileStart = markup.indexOf('data-public-region="profile"');
        const sourcesStart = markup.indexOf('data-public-region="sources"');
        const profileMarkup = profileStart >= 0 ? markup.slice(profileStart, sourcesStart > profileStart ? sourcesStart : undefined) : "";
        if (profileMarkup.includes("public-source-link")) throw new Error("source link leaked into PROFILE");
        const canonicalLineageDisplay = cultivar.lineage?.status === "unknown" ? "" : String(cultivar.lineage?.display || "").trim();
        const lineageParents = (cultivar.lineage?.parents || []).filter(Boolean);
        if (canonicalLineageDisplay && lineageParents.length < 2 && !profileMarkup.includes(esc(canonicalLineageDisplay))) throw new Error("canonical lineage.display missing");
        for (const aroma of cultivar.aromas?.items || []) {
          if (hasJapanese(aroma) && aromaTone(aroma) === "aroma-neutral") throw new Error(`unmapped Japanese aroma tone: ${aroma}`);
        }
        passed += 1;
      } catch (error) {
        failures.push({ id: cultivar?.id || "unknown", error: String(error?.message || error) });
      }
    }
    const result = { total: cultivars.length, passed, failures };
    window.__CSWDetailRendererSmoke = result;
    return result;
  }

  window.__CSWRunDetailRendererSmoke = async () => {
    const catalog = await getCatalog();
    if (!catalog) {
      const result = { total: 0, passed: 0, failures: [{ id: "catalog", error: "runtime catalog unavailable" }] };
      window.__CSWDetailRendererSmoke = result;
      return result;
    }
    return runRendererSmoke(catalog);
  };

  function publicDetailIsCanonical(cultivar) {
    const publicRoot = detailShell.querySelector(".detail-public-v1[data-public-detail-id]");
    if (!publicRoot || publicRoot.dataset.publicDetailId !== String(cultivar.id) || detailShell.querySelector(":scope > .status-grid")) return false;
    const heroName = detailShell.querySelector(".public-hero-copy h2");
    if (!heroName || normalizeIdentityValue(heroName.textContent) !== normalizeIdentityValue(cultivar.name)) return false;
    const sub = detailShell.querySelector(".detail-hero .detail-sub");
    const expected = auxiliaryName(cultivar);
    if (!expected) return !sub;
    return Boolean(sub) && normalizeIdentityValue(sub.textContent) === normalizeIdentityValue(expected);
  }

  let scheduled = false;
  async function enhanceDetail() {
    scheduled = false;
    const id = new URL(location.href).searchParams.get("strain");
    if (!id || !detailShell.children.length) return;
    const catalog = await getCatalog();
    const cultivar = catalog?.cultivars?.find(item => item.id === id);
    if (!cultivar || publicDetailIsCanonical(cultivar)) return;
    renderPublicDetail(catalog, cultivar);
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(enhanceDetail);
  };

  detailShell.addEventListener("click", event => {
    const button = event.target.closest(".public-detail-toggle[data-detail-toggle]");
    if (!button) return;
    const box = button.closest(".public-detail-action[data-detail-action]");
    if (!box) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const open = !box.classList.contains("open");
    box.classList.toggle("open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    const accessibleLabel = open ? button.dataset.openLabel : button.dataset.closedLabel;
    if (accessibleLabel) button.setAttribute("aria-label", accessibleLabel);
  }, true);

  const observer = new MutationObserver(schedule);
  observer.observe(detailShell, { childList: true, subtree: false });
  window.addEventListener("popstate", schedule);
  schedule();
})();
