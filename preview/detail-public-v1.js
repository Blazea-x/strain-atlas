(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/runtime/catalog.json";
  const ASSET_BASE = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/";
  const detailShell = document.getElementById("detail-shell");
  if (!detailShell) return;

  // Presentation-only dictionaries. Canonical data is never rewritten here.
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
    resins: "レジン"
  });

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
    for (const claim of [cultivar.lineage, cultivar.aromas, cultivar.terpenes, cultivar.origin, cultivar.history]) {
      refs.push(...(claim?.sourceRefs || []));
    }
    for (const relation of cultivar.relations || []) refs.push(...(relation.sourceRefs || []));
    return [...new Set(refs)];
  }

  function sourcesForRefs(catalog, refs) {
    return [...new Set(refs || [])].map(id => catalog?.sources?.[id]).filter(source => source?.url);
  }

  function sourcesSupporting(catalog, cultivar, supportedKeys) {
    const keys = new Set(supportedKeys.map(value => value.toLowerCase()));
    return sourcesForRefs(catalog, sourceRefsFor(cultivar)).filter(source =>
      (source.supports || []).some(value => keys.has(String(value).toLowerCase()))
    );
  }

  function sourceLinks(sources) {
    if (!sources.length) return "";
    return `<div class="public-source-list">${sources.map(source => `<a class="public-source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>情報源を確認</span><strong>${esc(source.publisher || source.title || "公式資料")}</strong>${source.title && source.publisher ? `<small>${esc(source.title)}</small>` : ""}</a>`).join("")}</div>`;
  }

  function disclosure(kind, label, value, deep, grade = "", extraClass = "") {
    if (!value) return "";
    if (!deep) {
      return `<section class="public-card ${extraClass}"><div class="public-card-label">${esc(label)}</div><div class="public-card-value">${value}</div>${grade}</section>`;
    }
    const id = `public-detail-${kind}`;
    return `<section class="public-card public-detail-action ${extraClass}" data-detail-action>
      <button class="public-detail-toggle" type="button" aria-expanded="false" aria-controls="${id}" data-detail-toggle>
        <span class="public-card-copy"><span class="public-card-label">${esc(label)}</span><span class="public-card-value">${value}</span>${grade}</span>
        <span class="public-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="public-detail-deep" id="${id}">${deep}</div>
    </section>`;
  }

  function breederBasics(catalog, cultivar) {
    const relations = (cultivar.relations || []).filter(relation => (relation.roles || []).includes("breeder"));
    if (!relations.length) return null;
    const rows = relations.map(relation => {
      const entity = catalog.entities?.[relation.entityId];
      const name = String(entity?.name || relation.entityId || "").trim();
      return { relation, name, sources: sourcesForRefs(catalog, relation.sourceRefs || []) };
    }).filter(row => row.name);
    if (!rows.length) return null;
    const value = rows.map(row => esc(row.name)).join(" / ");
    const hasDeep = rows.some(row => row.sources.length || ["A", "B", "C"].includes(row.relation?.confidence));
    const deep = hasDeep ? rows.map(row => `<div class="public-breeder-detail"><div class="public-breeder-head"><strong>${esc(row.name)}</strong>${gradeBadge(row.relation)}</div>${sourceLinks(row.sources)}</div>`).join("") : "";
    return { value, deep };
  }

  function safeLineageValue(cultivar) {
    if (!cultivar.lineage || cultivar.lineage.status === "unknown") return "";
    const parents = (cultivar.lineage.parents || []).filter(Boolean);
    if (parents.length >= 2) return parents.map(esc).join(" × ");
    const display = String(cultivar.lineage.display || "").trim();
    if (display.includes("×") || hasJapanese(display)) return esc(display);
    if (parents.length === 1) return esc(parents[0]);
    return "";
  }

  function textClaimCard(catalog, cultivar, kind, label, claim) {
    if (!claim || claim.status === "unknown") return "";
    const text = String(claim.text || "").trim();
    const japaneseText = text && hasJapanese(text) ? `<p>${esc(text)}</p>` : "";
    const sources = sourcesForRefs(catalog, claim.sourceRefs || []);
    const deep = `${japaneseText}${sourceLinks(sources)}`;
    if (!deep) return "";
    const summary = japaneseText ? "詳細を見る" : "情報源を確認";
    return disclosure(kind, label, esc(summary), deep, gradeBadge(claim), "public-deep-card");
  }

  function lineageCard(catalog, cultivar) {
    const value = safeLineageValue(cultivar);
    const claim = cultivar.lineage;
    if (!claim || claim.status === "unknown") return "";
    const note = String(claim.note || "").trim();
    const japaneseNote = note && hasJapanese(note) ? `<p>${esc(note)}</p>` : "";
    const sources = sourcesForRefs(catalog, claim.sourceRefs || []);
    const deep = `${japaneseNote}${sourceLinks(sources)}`;
    if (!value && !deep) return "";
    return disclosure("lineage", "系譜", value || "情報源を確認", deep, gradeBadge(claim), "public-deep-card");
  }

  function sensoryCard(label, claim, kind) {
    const items = claim?.items || [];
    if (!items.length) return "";
    const chips = items.map(item => {
      const shown = kind === "aroma" ? displayAroma(item) : String(item);
      return `<span class="public-chip">${esc(shown)}</span>`;
    }).join("");
    return `<section class="public-card public-sensory-card"><div class="public-section-head"><span class="public-card-label">${esc(label)}</span>${gradeBadge(claim)}</div><div class="public-chips">${chips}</div></section>`;
  }

  function renderPublicDetail(catalog, cultivar) {
    const visual = primaryVisual(cultivar);
    const type = displayType(cultivar);
    const generation = displayGeneration(cultivar);
    const breeder = breederBasics(catalog, cultivar);
    const typeSources = type ? sourcesSupporting(catalog, cultivar, ["classification", "type"]) : [];
    const generationSources = generation ? sourcesSupporting(catalog, cultivar, ["breeding", "generation"]) : [];
    const allSources = sourcesForRefs(catalog, sourceRefsFor(cultivar));

    const basics = [
      type ? disclosure("type", "タイプ", esc(type), sourceLinks(typeSources), "", "public-basic-card") : "",
      generation ? disclosure("generation", "世代", esc(generation), sourceLinks(generationSources), "", "public-basic-card") : "",
      breeder ? disclosure("breeder", "ブリーダー", breeder.value, breeder.deep, "", "public-basic-card") : ""
    ].filter(Boolean).join("");

    const origin = textClaimCard(catalog, cultivar, "origin", "起源", cultivar.origin);
    const lineage = lineageCard(catalog, cultivar);
    const aromas = sensoryCard("香り", cultivar.aromas, "aroma");
    const terpenes = sensoryCard("テルペン", cultivar.terpenes, "terpene");
    const history = textClaimCard(catalog, cultivar, "history", "歴史", cultivar.history);
    const sources = allSources.length
      ? disclosure("sources", "出典", `出典 ${allSources.length}件`, sourceLinks(allSources), "", "public-deep-card public-sources-card")
      : "";

    detailShell.innerHTML = `
      <div class="detail-topbar"><strong>${esc(cultivar.name)}</strong><button class="close-detail" type="button" aria-label="詳細を閉じる">×</button></div>
      <section class="detail-hero">
        ${visual ? `<img src="${esc(asset(visual.src))}" alt="${esc(visual.alt || "")}">` : ""}
        <div class="detail-hero-copy"><h2>${esc(cultivar.name)}</h2>${cultivar.jp ? `<div class="detail-sub">${esc(cultivar.jp)}</div>` : ""}</div>
      </section>
      <main class="detail-public-v1" data-public-detail-id="${esc(cultivar.id)}">
        ${basics ? `<section class="public-basics" aria-label="基本情報">${basics}</section>` : ""}
        <section class="public-detail-sections" aria-label="品種情報">${origin}${lineage}${aromas}${terpenes}${history}${sources}</section>
      </main>
    `;
  }

  let scheduled = false;
  async function enhanceDetail() {
    scheduled = false;
    const id = new URL(location.href).searchParams.get("strain");
    if (!id || !detailShell.children.length) return;
    if (detailShell.querySelector(`.detail-public-v1[data-public-detail-id="${CSS.escape(id)}"]`)) return;
    const catalog = await getCatalog();
    const cultivar = catalog?.cultivars?.find(item => item.id === id);
    if (!cultivar) return;
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
  }, true);

  const observer = new MutationObserver(schedule);
  observer.observe(detailShell, { childList: true, subtree: false });
  window.addEventListener("popstate", schedule);
  schedule();
})();
