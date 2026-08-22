(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/cannabis-strain-wisdom/strain-atlas/master-migration/runtime/catalog.json";
  const runtimeCatalogPromise = window.__CSWRuntimeCatalogPromise || (
    window.__CSWRuntimeCatalogPromise = Promise.resolve().then(async () => {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`runtime catalog HTTP ${response.status}`);
      const parsedCatalog = await response.json();
      if (!Array.isArray(parsedCatalog.cultivars)) throw new Error("cultivars array is missing");
      return parsedCatalog;
    })
  );
  const ASSET_BASE = "https://raw.githubusercontent.com/cannabis-strain-wisdom/strain-atlas/master-migration/";
  const typeLabels = {
    "sativa": "SATIVA",
    "indica": "INDICA",
    "hybrid": "HYBRID",
    "sativa-dominant-hybrid": "SATIVA系 HYBRID",
    "indica-dominant-hybrid": "INDICA系 HYBRID",
    "balanced-hybrid": "BALANCED HYBRID",
    "unknown": "未分類"
  };
  const exploreLabels = {
    sativa: "SATIVA系",
    indica: "INDICA系",
    hybrid: "HYBRID"
  };
  const roleLabels = {
    originator: "ORIGINATOR",
    breeder: "BREEDER",
    seedCompany: "SEED COMPANY",
    producer: "PRODUCER",
    brand: "BRAND",
    distributor: "DISTRIBUTOR"
  };
  const historyHeadlines = {
    "wedding-cake": "2018 SoCal Cup 1位 / 2019 Leafly SOTY / 系譜説の変遷",
    "bubble-gum": "Indiana由来から複数ブリーダー系統へ",
    "og-kush": "West Coast OGファミリーの基盤",
    "strawberry-banana-s1": "Original Strawberry BananaからS1へ",
    "super-lemon-haze": "2008・2009年の主要カップで1位"
  };
  const validExploreValues = new Set(["sativa", "indica", "hybrid"]);
  const ownedFilterParams = ["type", "generation", "breeder", "q"];
  const detailHistoryMarker = "__cswDetailEntry";
  const nativePushState = history.pushState.bind(history);
  history.pushState = (state, title, url) => {
    const currentUrl = new URL(location.href);
    const nextUrl = url === undefined || url === null ? new URL(location.href) : new URL(String(url), location.href);
    const opensDetail = !currentUrl.searchParams.has("strain") && nextUrl.searchParams.has("strain");
    const nextState = opensDetail ? { ...(state || {}), [detailHistoryMarker]: true } : state;
    return nativePushState(nextState, title, url);
  };

  const grid = document.getElementById("cultivar-grid");
  const search = document.getElementById("search");
  const resultLabel = document.getElementById("result-label");
  const catalogMeta = document.getElementById("catalog-meta");
  const empty = document.getElementById("empty");
  const dataState = document.getElementById("data-state");
  const dialog = document.getElementById("detail-dialog");
  const detailShell = document.getElementById("detail-shell");
  const homeContent = document.getElementById("home-content");
  const contentPanels = [...document.querySelectorAll("[data-content-panel]")];
  const homeEntries = [...document.querySelectorAll("[data-home-target]")];
  const catalogTotal = document.getElementById("catalog-total");
  const allCultivarsTitle = document.getElementById("all-cultivars-title");
  const latestSection = document.querySelector(".latest-section");
  const generationOptions = document.getElementById("generation-options");
  const generationFilterGroup = document.getElementById("generation-filter-group");
  const breederFilter = document.getElementById("breeder-filter");
  const breederFilterGroup = document.getElementById("breeder-filter-group");
  const filterSummaryCount = document.getElementById("filter-summary-count");
  const clearFilters = document.getElementById("clear-filters");
  const filterDisclosure = document.getElementById("filter-disclosure");
  let viewResults = document.getElementById("view-results");

  let catalog = null;
  let activeExplore = "all";
  const activeGenerations = new Set();
  let activeBreeder = "";
  let activeHomePanel = null;
  let savedScrollY = 0;
  let suppressCloseHistory = false;
  let availableGenerations = new Set();
  let availableBreeders = new Set();

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const asset = src => /^https?:\/\//i.test(src || "") ? src : ASSET_BASE + String(src || "").replace(/^\/+/, "");
  const compact = values => values.filter(value => value !== undefined && value !== null && String(value).trim() !== "");
  const primaryVisual = cultivar => (cultivar.visuals || []).find(v => v.role === "primary") || (cultivar.visuals || [])[0];

  const claimText = claim => claim?.text || claim?.display || "";
  const evidenceText = claim => {
    if (!claim) return "未登録";
    if (claim.status === "unknown") return "UNKNOWN";
    return compact([String(claim.status || "").toUpperCase(), claim.confidence]).join(" / ");
  };
  const evidenceShort = claim => claim?.confidence || (claim?.status === "unknown" ? "?" : "-");
  const evidenceBadge = claim => {
    const grade = String(claim?.confidence || "unknown").toLowerCase();
    const cls = ["a", "b", "c"].includes(grade) ? grade : "unknown";
    return `<span class="confidence-badge ${cls}"><i aria-hidden="true"></i>${esc(evidenceText(claim))}</span>`;
  };

  const sensoryColor = (item, kind) => {
    const x = String(item || "").toLowerCase();
    if (kind === "aroma") {
      if (/strawberry|ストロベリー|berry|ベリー/.test(x)) return "242,78,125";
      if (/banana|バナナ/.test(x)) return "242,204,66";
      if (/bubble|バブルガム|sweet|スイート/.test(x)) return "232,103,190";
      if (/gas|fuel|フューエル|ガス/.test(x)) return "242,132,62";
      if (/vanilla|バニラ/.test(x)) return "232,195,132";
      if (/lemon|レモン|citrus|シトラス/.test(x)) return "217,221,75";
      if (/pine|パイン/.test(x)) return "65,182,108";
      if (/floral|フローラル|haze|ヘイズ/.test(x)) return "180,105,218";
      if (/earth|アーシー|wood|ウッド/.test(x)) return "157,132,82";
      if (/pepper|ペッパー/.test(x)) return "224,99,73";
      return "198,112,162";
    }
    if (/limonene/.test(x)) return "238,205,61";
    if (/myrcene/.test(x)) return "72,190,107";
    if (/caryophyllene/.test(x)) return "190,104,211";
    if (/terpinolene/.test(x)) return "64,185,207";
    return "86,169,207";
  };

  const ensureDetailUxStyles = () => {
    if (document.getElementById("restored-detail-ux")) return;
    const style = document.createElement("style");
    style.id = "restored-detail-ux";
    style.textContent = `
      .detail-shell .status-item{position:relative;overflow:hidden}
      .detail-shell .detail-action{padding-right:68px}
      .detail-shell .detail-action.open{padding-right:9px;border-color:rgba(217,182,93,.22)}
      .detail-shell .detail-toggle{position:absolute;right:0;top:0;bottom:0;width:58px;border:0;border-left:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));color:#cfd8d2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}
      .detail-shell .detail-toggle small{font-size:6px;font-weight:950;letter-spacing:.13em}
      .detail-shell .detail-toggle b{font-size:22px;line-height:.8;font-weight:400;transition:transform .16s ease}
      .detail-shell .detail-action.open .detail-toggle{bottom:auto;height:58px}
      .detail-shell .detail-action.open .detail-toggle b{transform:rotate(90deg)}
      .detail-shell .detail-action.open>.status-label,.detail-shell .detail-action.open>.status-value,.detail-shell .detail-action.open>.status-meta{padding-right:58px}
      .detail-shell .detail-deep{display:none;margin-top:11px;padding-top:11px;border-top:1px solid rgba(255,255,255,.08);color:#dbe3de;font-size:11px;line-height:1.72}
      .detail-shell .detail-action.open .detail-deep{display:block}
      .detail-shell .detail-deep-heading{margin:0 0 7px;color:#cfd8d2;font-size:7px;font-weight:950;letter-spacing:.13em}
      .detail-shell .detail-deep p{margin:0 0 10px}
      .detail-shell .detail-deep p:last-child{margin-bottom:0}
      .detail-shell .detail-deep-note{padding-top:9px;border-top:1px solid rgba(255,255,255,.06);color:#9eaaa3;font-size:9px;line-height:1.65}
      .detail-shell .detail-lineage{border-color:rgba(160,138,84,.22)}
      .detail-shell .detail-history{border-color:rgba(120,106,160,.22)}
      .detail-shell .detail-sources{border-color:rgba(176,148,82,.22)}
      .detail-shell .chips{gap:7px;margin-top:8px}
      .detail-shell .chip{--chip:180,180,180;display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid rgba(var(--chip),.34);border-radius:999px;background:rgba(255,255,255,.035);color:#edf2ef;font-size:8px;line-height:1.2}
      .detail-shell .chip-dot{width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:rgb(var(--chip));box-shadow:0 0 5px rgba(var(--chip),.95),0 0 12px rgba(var(--chip),.58)}
      .detail-shell .sensory-aroma{border-color:rgba(212,93,145,.18)}
      .detail-shell .sensory-terpene{border-color:rgba(59,181,196,.18)}
      .detail-shell .confidence-badge{display:inline-flex;align-items:center;gap:5px;color:#8f9d95;font-size:7px;font-weight:820;letter-spacing:.02em}
      .detail-shell .confidence-badge i{width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:currentColor;box-shadow:0 0 5px currentColor}
      .detail-shell .confidence-badge.a{color:#69d783}.detail-shell .confidence-badge.b{color:#efbd50}.detail-shell .confidence-badge.c{color:#e58c64}.detail-shell .confidence-badge.unknown{color:#83908a}
      .detail-shell .source-detail-link{display:block;margin:0 0 10px;padding:8px;border:1px solid rgba(255,255,255,.065);border-radius:10px;background:rgba(255,255,255,.02);color:#dfc775;text-decoration:none;font-size:9px;line-height:1.4}
      .detail-shell .source-detail-link:last-child{margin-bottom:0}
      .detail-shell .source-detail-link small{display:block;margin-top:3px;color:#84958b}
    `;
    document.head.appendChild(style);
  };

  const relationNames = cultivar => (cultivar.relations || []).map(relation => {
    const entity = catalog?.entities?.[relation.entityId];
    return {
      name: entity?.name || relation.entityId,
      roles: relation.roles || [],
      evidence: evidenceText(relation)
    };
  });

  const searchBlob = cultivar => {
    const relations = relationNames(cultivar).flatMap(item => [item.name, ...item.roles.map(role => roleLabels[role] || role)]);
    return compact([
      cultivar.id,
      cultivar.name,
      cultivar.jp,
      ...(cultivar.aliases || []),
      cultivar.classification?.type,
      typeLabels[cultivar.classification?.type],
      cultivar.breeding?.generation,
      cultivar.lineage?.display,
      ...(cultivar.lineage?.parents || []),
      cultivar.lineage?.note,
      ...(cultivar.aromas?.items || []),
      ...(cultivar.terpenes?.items || []),
      cultivar.origin?.text,
      cultivar.history?.text,
      ...relations
    ]).join(" ").toLowerCase();
  };

  function filterState(query = currentQuery(), explore = activeExplore) {
    return {
      explore,
      generations: new Set(activeGenerations),
      breeder: activeBreeder,
      query: String(query || "").trim().toLowerCase()
    };
  }

  const inExplore = (cultivar, explore) => explore === "all" || (catalog?.explore?.[explore] || []).includes(cultivar.id);
  const inGeneration = (cultivar, generations) => !generations.size || generations.has(String(cultivar.breeding?.generation || "").trim());
  const inBreeder = (cultivar, breeder) => !breeder || (cultivar.relations || []).some(relation =>
    relation.entityId === breeder && (relation.roles || []).includes("breeder")
  );
  const matchesFilters = (cultivar, state) =>
    inExplore(cultivar, state.explore) &&
    inGeneration(cultivar, state.generations) &&
    inBreeder(cultivar, state.breeder) &&
    (!state.query || searchBlob(cultivar).includes(state.query));

  const currentQuery = () => (search?.value || "").trim();
  const getVisibleCultivars = (state = filterState()) => catalog?.cultivars?.filter(cultivar => matchesFilters(cultivar, state)) || [];
  const resultModeFor = query =>
    activeExplore !== "all" ||
    activeGenerations.size > 0 ||
    Boolean(activeBreeder) ||
    Boolean(query);

  function generationSortKey(value) {
    const text = String(value || "").trim();
    if (text === "S1") return [0, 1, text];
    const f = text.match(/^F([1-9][0-9]*)$/);
    if (f) return [1, Number(f[1]), text];
    const bx = text.match(/^BX([1-9][0-9]*)$/);
    if (bx) return [2, Number(bx[1]), text];
    if (text === "IBL") return [3, 0, text];
    return [4, 0, text.toLowerCase()];
  }

  function compareGeneration(a, b) {
    const aa = generationSortKey(a);
    const bb = generationSortKey(b);
    return aa[0] - bb[0] || aa[1] - bb[1] || String(aa[2]).localeCompare(String(bb[2]), "en");
  }

  function activeBreederName() {
    if (!activeBreeder) return "";
    return String(catalog?.entities?.[activeBreeder]?.name || activeBreeder).trim();
  }

  function scrollResultsIntoView() {
    const target = document.getElementById("cultivars");
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function ensureResultButton() {
    if (viewResults) return;
    const panel = filterDisclosure?.querySelector(".filter-panel");
    if (!panel) return;
    viewResults = document.createElement("button");
    viewResults.id = "view-results";
    viewResults.type = "button";
    viewResults.className = "filter-clear filter-results";
    viewResults.hidden = true;
    viewResults.disabled = true;
    panel.appendChild(viewResults);
    viewResults.addEventListener("click", () => {
      const query = currentQuery();
      if (!resultModeFor(query)) return;
      if (filterDisclosure?.open) filterDisclosure.open = false;
      requestAnimationFrame(scrollResultsIntoView);
    });
  }

  function syncFilterUi() {
    document.querySelectorAll("[data-explore]").forEach(item => {
      const active = item.dataset.explore === activeExplore;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    generationOptions?.querySelectorAll("[data-generation]").forEach(item => {
      const active = activeGenerations.has(item.dataset.generation || "");
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (breederFilter && breederFilter.value !== activeBreeder) breederFilter.value = activeBreeder;
    const detailCount = activeGenerations.size + (activeBreeder ? 1 : 0);
    if (filterSummaryCount) {
      filterSummaryCount.textContent = String(detailCount);
      filterSummaryCount.hidden = detailCount === 0;
    }
    if (clearFilters) clearFilters.disabled = activeExplore === "all" && detailCount === 0;
  }

  function setupDetailedFilters() {
    const generations = [...new Set(catalog.cultivars
      .map(cultivar => String(cultivar.breeding?.generation || "").trim())
      .filter(value => value && value.toLowerCase() !== "unknown"))]
      .sort(compareGeneration);
    availableGenerations = new Set(generations);
    if (generationOptions) {
      generationOptions.innerHTML = generations.map(value =>
        `<button type="button" class="generation-chip" data-generation="${esc(value)}" aria-pressed="false">${esc(value)}</button>`
      ).join("");
    }
    if (generationFilterGroup) generationFilterGroup.hidden = generations.length === 0;

    const breeders = new Map();
    for (const cultivar of catalog.cultivars) {
      for (const relation of cultivar.relations || []) {
        if (!(relation.roles || []).includes("breeder")) continue;
        const entity = catalog.entities?.[relation.entityId];
        const name = String(entity?.name || "").trim();
        if (name) breeders.set(relation.entityId, name);
      }
    }
    const breederEntries = [...breeders.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"));
    availableBreeders = new Set(breederEntries.map(([id]) => id));
    if (breederFilter) {
      breederFilter.innerHTML = `<option value="">すべてのBreeder</option>${breederEntries.map(([id, name]) =>
        `<option value="${esc(id)}">${esc(name)}</option>`
      ).join("")}`;
    }
    if (breederFilterGroup) breederFilterGroup.hidden = breederEntries.length === 0;
    ensureResultButton();
  }

  function showHomePanel(target, scroll = false) {
    if (!target) return;
    activeHomePanel = target;
    contentPanels.forEach(panel => {
      panel.hidden = panel.dataset.contentPanel !== target;
    });
    homeEntries.forEach(button => {
      const active = button.dataset.homeTarget === target;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    if (scroll) requestAnimationFrame(() => homeContent?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function firstValidParam(params, name, validator) {
    for (const raw of params.getAll(name)) {
      const value = String(raw || "").trim();
      if (validator(value)) return value;
    }
    return "";
  }

  function firstQueryParam(params) {
    for (const raw of params.getAll("q")) {
      const value = String(raw || "").trim();
      if (value) return value;
    }
    return "";
  }

  function readUrlFilterState(url = new URL(location.href)) {
    const params = url.searchParams;
    const explore = firstValidParam(params, "type", value => validExploreValues.has(value)) || "all";
    const generations = [...new Set(params.getAll("generation")
      .map(value => String(value || "").trim())
      .filter(value => availableGenerations.has(value)))]
      .sort(compareGeneration);
    const breeder = firstValidParam(params, "breeder", value => availableBreeders.has(value));
    const query = firstQueryParam(params);
    return { explore, generations, breeder, query };
  }

  function canonicalFilterUrl() {
    const url = new URL(location.href);
    for (const name of ownedFilterParams) url.searchParams.delete(name);
    if (activeExplore !== "all") url.searchParams.append("type", activeExplore);
    [...activeGenerations].sort(compareGeneration).forEach(value => url.searchParams.append("generation", value));
    if (activeBreeder) url.searchParams.append("breeder", activeBreeder);
    const query = currentQuery();
    if (query) url.searchParams.append("q", query);
    return url;
  }

  function syncFilterUrl() {
    const url = canonicalFilterUrl();
    if (url.href === location.href) return;
    history.replaceState(history.state, "", url);
  }

  function applyUrlState({ canonicalize = false } = {}) {
    const state = readUrlFilterState();
    activeExplore = state.explore;
    activeGenerations.clear();
    state.generations.forEach(value => activeGenerations.add(value));
    activeBreeder = state.breeder;
    if (search) search.value = state.query;
    if (canonicalize) syncFilterUrl();
  }

  function setCount(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? 0);
  }

  function updateTypeFacetCounts(state) {
    const nonTypeState = { ...state, explore: "all" };
    const eligible = catalog.cultivars.filter(cultivar => matchesFilters(cultivar, nonTypeState));
    const eligibleIds = new Set(eligible.map(cultivar => cultivar.id));
    setCount("count-all", eligible.length);
    for (const key of ["sativa", "indica", "hybrid"]) {
      const count = (catalog.explore?.[key] || []).reduce((total, id) => total + (eligibleIds.has(id) ? 1 : 0), 0);
      setCount(`count-${key}`, count);
    }
  }

  function updateResultHeading(visible, query, isResultMode) {
    const count = visible.length;
    if (!isResultMode) {
      if (allCultivarsTitle) allCultivarsTitle.textContent = "すべての品種";
      if (catalogTotal) catalogTotal.textContent = `${catalog.cultivars.length}品種を収録`;
      if (resultLabel) {
        resultLabel.textContent = "";
        resultLabel.hidden = true;
      }
      if (viewResults) {
        viewResults.textContent = `${count}件の結果を見る`;
        viewResults.hidden = true;
        viewResults.disabled = true;
      }
      return;
    }

    if (resultLabel) {
      resultLabel.hidden = false;
      resultLabel.textContent = `${count}件表示`;
    }
    if (viewResults) {
      viewResults.textContent = `${count}件の結果を見る`;
      viewResults.hidden = false;
      viewResults.disabled = false;
    }

    const hasExplore = activeExplore !== "all";
    const generations = [...activeGenerations];
    const breeder = activeBreederName();
    const hasBreeder = Boolean(activeBreeder);
    const hasQuery = Boolean(query);
    const conditionCount = (hasExplore ? 1 : 0) + generations.length + (hasBreeder ? 1 : 0) + (hasQuery ? 1 : 0);

    if (conditionCount === 1 && hasExplore) {
      if (allCultivarsTitle) allCultivarsTitle.textContent = `${exploreLabels[activeExplore] || activeExplore}の品種`;
      if (catalogTotal) catalogTotal.textContent = "";
      return;
    }
    if (conditionCount === 1 && generations.length === 1) {
      if (allCultivarsTitle) allCultivarsTitle.textContent = `育種世代 ${generations[0]}`;
      if (catalogTotal) catalogTotal.textContent = "";
      return;
    }
    if (conditionCount === 1 && hasBreeder) {
      if (allCultivarsTitle) allCultivarsTitle.textContent = `${breeder}の品種`;
      if (catalogTotal) catalogTotal.textContent = "";
      return;
    }
    if (conditionCount === 1 && hasQuery) {
      if (allCultivarsTitle) allCultivarsTitle.textContent = "検索結果";
      if (catalogTotal) catalogTotal.textContent = `「${query}」`;
      return;
    }

    const parts = [];
    if (hasExplore) parts.push(exploreLabels[activeExplore] || activeExplore);
    parts.push(...generations);
    if (hasBreeder) parts.push(breeder);
    if (hasQuery) parts.push(`「${query}」`);
    if (allCultivarsTitle) allCultivarsTitle.textContent = "絞り込み結果";
    if (catalogTotal) catalogTotal.textContent = parts.join(" · ");
  }

  function renderGrid(visible) {
    if (!catalog) return;
    grid.innerHTML = visible.map(cultivar => {
      const visual = primaryVisual(cultivar);
      const aromas = (cultivar.aromas?.items || []).slice(0, 2);
      const type = typeLabels[cultivar.classification?.type] || cultivar.classification?.type || "未分類";
      return `<button class="cultivar-card" type="button" data-strain-id="${esc(cultivar.id)}" aria-label="${esc(cultivar.name)}の詳細を見る">
        <div class="tile-visual">
          ${visual ? `<img src="${esc(asset(visual.src))}" alt="${esc(visual.alt || "")}" loading="lazy">` : ""}
          <span class="tile-type">${esc(type)}</span>
        </div>
        <div class="tile-copy">
          <div class="tile-name">${esc(cultivar.name)}</div>
          <div class="tile-aromas">${aromas.map(item => `<span>${esc(item)}</span>`).join("")}</div>
          <div class="tile-meta"><span>LINEAGE ${esc(evidenceShort(cultivar.lineage))}</span><span>${esc(String(cultivar.status || "").toUpperCase())}</span></div>
        </div>
      </button>`;
    }).join("");
    empty.hidden = visible.length !== 0;
  }

  function updateResults({ scrollToResults = false, writeHistory = true } = {}) {
    if (!catalog) return { query: currentQuery(), visible: [], isResultMode: false };
    const query = currentQuery();
    const state = filterState(query);
    const visible = getVisibleCultivars(state);
    const isResultMode = resultModeFor(query);
    updateTypeFacetCounts(state);
    syncFilterUi();
    if (latestSection) latestSection.hidden = isResultMode;
    updateResultHeading(visible, query, isResultMode);
    renderGrid(visible);
    if (writeHistory) syncFilterUrl();
    if (scrollToResults && isResultMode) requestAnimationFrame(scrollResultsIntoView);
    return { query, visible, isResultMode };
  }

  function setExplore(key) {
    activeExplore = validExploreValues.has(key) ? key : "all";
    return updateResults({ scrollToResults: true, writeHistory: true });
  }

  const chips = (items, kind) => items?.length
    ? `<div class="chips">${items.map(item => `<span class="chip" style="--chip:${sensoryColor(item, kind)}"><i class="chip-dot" aria-hidden="true"></i><span>${esc(item)}</span></span>`).join("")}</div>`
    : `<div class="status-value">未確認</div>`;

  const statusItem = (label, value, meta = "", wide = false) => `<section class="status-item${wide ? " wide" : ""}"><div class="status-label">${esc(label)}</div><div class="status-value">${value}</div>${meta ? `<div class="status-meta">${esc(meta)}</div>` : ""}</section>`;

  const sensoryItem = (label, items, claim, kind) => `<section class="status-item wide sensory-${kind}"><div class="status-label">${esc(label)}</div><div class="status-value">${chips(items, kind)}</div><div class="status-meta">${evidenceBadge(claim)}</div></section>`;

  const actionItem = (kind, label, summary, deep, claim, metaText = "") => {
    const id = `detail-${kind}-${Math.random().toString(36).slice(2, 9)}`;
    return `<section class="status-item wide detail-action detail-${kind}" data-detail-action>
      <div class="status-label">${esc(label)}</div>
      <div class="status-value">${summary}</div>
      <div class="status-meta">${claim ? evidenceBadge(claim) : esc(metaText)}</div>
      <button class="detail-toggle" type="button" aria-expanded="false" aria-controls="${id}" data-detail-toggle><small>DETAIL</small><b>›</b></button>
      <div class="detail-deep" id="${id}">${deep}</div>
    </section>`;
  };

  function sourceRefsFor(cultivar) {
    const refs = [];
    for (const claim of [cultivar.lineage, cultivar.aromas, cultivar.terpenes, cultivar.origin, cultivar.history]) refs.push(...(claim?.sourceRefs || []));
    for (const relation of cultivar.relations || []) refs.push(...(relation.sourceRefs || []));
    return [...new Set(refs)];
  }

  function renderDetail(cultivar) {
    ensureDetailUxStyles();
    const visual = primaryVisual(cultivar);
    const entities = relationNames(cultivar);
    const entityText = entities.length
      ? entities.map(item => `<div>${esc(item.name)} <small>${esc(item.roles.map(role => roleLabels[role] || role).join(" / "))}</small></div>`).join("")
      : "未確認";
    const generation = cultivar.breeding?.generation || "unknown";
    const sources = sourceRefsFor(cultivar).map(id => catalog.sources?.[id]).filter(Boolean);

    const lineageSummary = esc(cultivar.lineage?.display || "未確認");
    const lineageNote = cultivar.lineage?.note || "";
    const lineage = lineageNote
      ? actionItem("lineage", "LINEAGE", lineageSummary, `<div class="detail-deep-heading">BACKGROUND / EVIDENCE</div><p>${esc(lineageNote)}</p>`, cultivar.lineage)
      : statusItem("LINEAGE", lineageSummary, evidenceText(cultivar.lineage), true);

    const historyText = cultivar.history?.status !== "unknown" ? (cultivar.history?.text || "") : "";
    const historyNote = cultivar.history?.note || "";
    const historyHeadline = historyHeadlines[cultivar.id] || "背景・受賞・変遷を詳しく見る";
    const history = historyText
      ? actionItem("history", "HISTORY", esc(historyHeadline), `<div class="detail-deep-heading">FULL HISTORY</div><p>${esc(historyText)}</p>${historyNote ? `<p class="detail-deep-note">${esc(historyNote)}</p>` : ""}`, cultivar.history)
      : "";

    const sourceDeep = sources.length
      ? `<div class="detail-deep-heading">SOURCE LIST</div>${sources.map(source => `<a class="source-detail-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.publisher)} / ${esc(source.title)}<small>${esc(source.sourceType)} ・ checked ${esc(source.checkedAt)}</small></a>`).join("")}`
      : `<div class="detail-deep-heading">SOURCE LIST</div><p>主張に紐付く出典は現在ありません。</p>`;
    const sourceAction = actionItem("sources", "SOURCES", `${sources.length} SOURCES`, sourceDeep, null, "EVIDENCE");

    detailShell.innerHTML = `
      <div class="detail-topbar"><strong>${esc(cultivar.name)}</strong><button class="close-detail" type="button" aria-label="詳細を閉じる">×</button></div>
      <section class="detail-hero">
        ${visual ? `<img src="${esc(asset(visual.src))}" alt="${esc(visual.alt || "")}">` : ""}
        <div class="detail-hero-copy"><h2>${esc(cultivar.name)}</h2><div class="detail-sub">${cultivar.jp ? esc(cultivar.jp) : "日本語表記は現在未確認"} ・ ${esc(String(cultivar.status || "").toUpperCase())}</div></div>
      </section>
      <div class="status-grid">
        ${statusItem("TYPE", esc(typeLabels[cultivar.classification?.type] || cultivar.classification?.type || "未分類"))}
        ${statusItem("GENERATION", esc(generation))}
        ${statusItem("BREEDER / ENTITY", entityText, entities.map(item => item.evidence).join(" ・ "))}
        ${statusItem("UPDATED", esc(cultivar.updatedAt || ""), `CHECKED ${cultivar.checkedAt || "-"}`)}
        ${cultivar.origin && cultivar.origin.status !== "unknown" ? statusItem("ORIGIN", esc(claimText(cultivar.origin) || "未確認"), evidenceText(cultivar.origin), true) : ""}
        ${lineage}
        ${cultivar.aromas?.items?.length ? sensoryItem("AROMA", cultivar.aromas.items, cultivar.aromas, "aroma") : ""}
        ${cultivar.terpenes?.items?.length ? sensoryItem("TERPENE", cultivar.terpenes.items, cultivar.terpenes, "terpene") : ""}
        ${history}
        ${sourceAction}
      </div>
    `;
  }

  async function openDetail(id, updateHistory = true) {
    const cultivar = catalog?.cultivars?.find(item => item.id === id);
    if (!cultivar) return false;
    if (!dialog.open) savedScrollY = window.scrollY;
    if (updateHistory) {
      const url = new URL(location.href);
      url.searchParams.set("strain", id);
      const state = { ...(history.state || {}), strain: id, [detailHistoryMarker]: true };
      history.pushState(state, "", url);
    }

    let publicRendered = false;
    const publicRenderer = window.__CSWRenderPublicDetail;
    if (typeof publicRenderer === "function") {
      try {
        publicRendered = await publicRenderer(cultivar) === true;
      } catch (error) {
        console.warn("public detail render failed; using legacy fallback", error);
      }
    }
    if (!publicRendered) renderDetail(cultivar);
    if (!dialog.open) dialog.showModal();
    return true;
  }

  function closeDetail(updateHistory = false) {
    if (!dialog.open) return;
    suppressCloseHistory = !updateHistory;
    dialog.close();
  }

  function requestDetailClose() {
    if (!dialog.open) return;
    const url = new URL(location.href);
    if (!url.searchParams.has("strain")) {
      closeDetail(false);
      return;
    }
    if (history.state?.[detailHistoryMarker] === true) {
      history.back();
      return;
    }
    url.searchParams.delete("strain");
    const state = { ...(history.state || {}) };
    delete state.strain;
    delete state[detailHistoryMarker];
    history.replaceState(state, "", url);
    closeDetail(false);
  }

  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    requestDetailClose();
  });

  dialog.addEventListener("close", () => {
    suppressCloseHistory = false;
    requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
  });

  detailShell.addEventListener("click", event => {
    if (event.target.closest(".close-detail")) {
      requestDetailClose();
      return;
    }
    const button = event.target.closest("[data-detail-toggle]");
    if (!button) return;
    const box = button.closest("[data-detail-action]");
    if (!box) return;
    const open = !box.classList.contains("open");
    detailShell.querySelectorAll("[data-detail-action].open").forEach(other => {
      if (other === box) return;
      other.classList.remove("open");
      other.querySelector("[data-detail-toggle]")?.setAttribute("aria-expanded", "false");
    });
    box.classList.toggle("open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  });

  grid.addEventListener("click", event => {
    const card = event.target.closest("[data-strain-id]");
    if (card) openDetail(card.dataset.strainId, true);
  });

  if (search) {
    search.setAttribute("enterkeyhint", "search");
    const handleSearchChange = () => {
      if (currentQuery() && activeHomePanel !== "cultivars") showHomePanel("cultivars", false);
      updateResults({ writeHistory: true });
    };
    search.addEventListener("input", handleSearchChange);
    search.addEventListener("search", handleSearchChange);
    search.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      search.blur();
      const state = updateResults({ writeHistory: true });
      if (state.isResultMode) requestAnimationFrame(scrollResultsIntoView);
    });
  }

  document.getElementById("explore")?.addEventListener("click", event => {
    const button = event.target.closest("[data-explore]");
    if (button) setExplore(button.dataset.explore || "all");
  });

  generationOptions?.addEventListener("click", event => {
    const button = event.target.closest("[data-generation]");
    if (!button) return;
    const generation = button.dataset.generation || "";
    if (!availableGenerations.has(generation)) return;
    if (activeGenerations.has(generation)) activeGenerations.delete(generation);
    else activeGenerations.add(generation);
    updateResults({ writeHistory: true });
  });

  breederFilter?.addEventListener("change", () => {
    const value = breederFilter.value || "";
    activeBreeder = availableBreeders.has(value) ? value : "";
    updateResults({ writeHistory: true });
  });

  clearFilters?.addEventListener("click", () => {
    activeExplore = "all";
    activeGenerations.clear();
    activeBreeder = "";
    updateResults({ writeHistory: true });
  });

  document.querySelector(".home-entries")?.addEventListener("click", event => {
    const button = event.target.closest("[data-home-target]");
    if (!button) return;
    showHomePanel(button.dataset.homeTarget, true);
  });

  document.querySelector(".explore-overview")?.addEventListener("click", event => {
    const button = event.target.closest("[data-explore-jump]");
    if (!button) return;
    setExplore(button.dataset.exploreJump);
    showHomePanel("cultivars", false);
  });

  window.addEventListener("popstate", async () => {
    if (!catalog) return;
    applyUrlState({ canonicalize: true });
    updateResults({ writeHistory: false });
    const id = new URL(location.href).searchParams.get("strain");
    if (id && await openDetail(id, false)) return;
    if (dialog.open) closeDetail(false);
  });

  async function boot() {
    try {
      catalog = await runtimeCatalogPromise;

      dataState.textContent = "MASTER DATA";
      catalogMeta.textContent = `${catalog.counts?.cultivars ?? 0} CULTIVARS · ${catalog.counts?.sources ?? 0} SOURCES · ${catalog.counts?.entities ?? 0} ENTITIES`;
      setCount("entry-cultivar-count", catalog.counts?.cultivars);
      for (const key of ["sativa", "indica", "hybrid", "unclassified"]) {
        const count = catalog.explore?.[key]?.length || 0;
        setCount(`overview-${key}`, count);
      }
      setupDetailedFilters();
      applyUrlState({ canonicalize: true });
      updateResults({ writeHistory: false });

      const initialId = new URL(location.href).searchParams.get("strain");
      if (initialId) await openDetail(initialId, false);
    } catch (error) {
      console.error(error);
      dataState.textContent = "DATA ERROR";
      dataState.classList.add("is-error");
      resultLabel.hidden = false;
      resultLabel.textContent = "読み込み失敗";
      grid.innerHTML = `<div class="error-box">MASTER runtime dataを読み込めませんでした。runtime/catalog.json の生成状態を確認してください。</div>`;
    }
  }

  boot();
})();