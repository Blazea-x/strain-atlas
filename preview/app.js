(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/runtime/catalog.json";
  const ASSET_BASE = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/";
  const typeLabels = {
    "sativa": "SATIVA",
    "indica": "INDICA",
    "hybrid": "HYBRID",
    "sativa-dominant-hybrid": "SATIVA系 HYBRID",
    "indica-dominant-hybrid": "INDICA系 HYBRID",
    "balanced-hybrid": "BALANCED HYBRID",
    "unknown": "未分類"
  };
  const roleLabels = {
    originator: "ORIGINATOR",
    breeder: "BREEDER",
    seedCompany: "SEED COMPANY",
    producer: "PRODUCER",
    brand: "BRAND",
    distributor: "DISTRIBUTOR"
  };

  const grid = document.getElementById("cultivar-grid");
  const search = document.getElementById("search");
  const resultLabel = document.getElementById("result-label");
  const catalogMeta = document.getElementById("catalog-meta");
  const empty = document.getElementById("empty");
  const dataState = document.getElementById("data-state");
  const dialog = document.getElementById("detail-dialog");
  const detailShell = document.getElementById("detail-shell");

  let catalog = null;
  let activeExplore = "all";
  let savedScrollY = 0;
  let suppressCloseHistory = false;

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

  const inExplore = cultivar => activeExplore === "all" || (catalog?.explore?.[activeExplore] || []).includes(cultivar.id);

  function renderGrid() {
    if (!catalog) return;
    const query = (search?.value || "").trim().toLowerCase();
    const visible = catalog.cultivars.filter(cultivar => inExplore(cultivar) && (!query || searchBlob(cultivar).includes(query)));

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

    resultLabel.textContent = `${visible.length} / ${catalog.cultivars.length}`;
    empty.hidden = visible.length !== 0;
  }

  function setExplore(key, scrollToList = false) {
    activeExplore = key || "all";
    document.querySelectorAll("[data-explore]").forEach(item => item.classList.toggle("is-active", item.dataset.explore === activeExplore));
    renderGrid();
    if (scrollToList) document.getElementById("cultivars")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const chips = items => items?.length ? `<div class="chips">${items.map(item => `<span class="chip">${esc(item)}</span>`).join("")}</div>` : `<div class="status-value">未確認</div>`;
  const statusItem = (label, value, meta = "", wide = false) => `<section class="status-item${wide ? " wide" : ""}"><div class="status-label">${esc(label)}</div><div class="status-value">${value}</div>${meta ? `<div class="status-meta">${esc(meta)}</div>` : ""}</section>`;

  function sourceRefsFor(cultivar) {
    const refs = [];
    for (const claim of [cultivar.lineage, cultivar.aromas, cultivar.terpenes, cultivar.origin, cultivar.history]) refs.push(...(claim?.sourceRefs || []));
    for (const relation of cultivar.relations || []) refs.push(...(relation.sourceRefs || []));
    return [...new Set(refs)];
  }

  function renderDetail(cultivar) {
    const visual = primaryVisual(cultivar);
    const entities = relationNames(cultivar);
    const entityText = entities.length
      ? entities.map(item => `<div>${esc(item.name)} <small>${esc(item.roles.map(role => roleLabels[role] || role).join(" / "))}</small></div>`).join("")
      : "未確認";
    const generation = cultivar.breeding?.generation || "unknown";
    const sources = sourceRefsFor(cultivar).map(id => catalog.sources?.[id]).filter(Boolean);

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
        ${statusItem("LINEAGE", esc(cultivar.lineage?.display || "未確認"), evidenceText(cultivar.lineage), true)}
        ${statusItem("AROMA", chips(cultivar.aromas?.items || []), evidenceText(cultivar.aromas), true)}
        ${statusItem("TERPENE", chips(cultivar.terpenes?.items || []), evidenceText(cultivar.terpenes), true)}
      </div>
      ${cultivar.origin ? `<section class="deep-section"><h3>ORIGIN</h3><p>${esc(claimText(cultivar.origin) || "未確認")}</p></section>` : ""}
      <section class="deep-section"><h3>LINEAGE DETAILS</h3><p>${esc(cultivar.lineage?.note || "追加注記なし")}</p></section>
      ${cultivar.history ? `<section class="deep-section"><h3>HISTORY</h3><p>${esc(claimText(cultivar.history) || "未確認")}</p></section>` : ""}
      <section class="deep-section"><h3>SOURCES</h3><div class="source-list">${sources.length ? sources.map(source => `<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.publisher)} / ${esc(source.title)}<small>${esc(source.sourceType)} ・ checked ${esc(source.checkedAt)}</small></a>`).join("") : `<p>主張に紐付く出典は現在ありません。</p>`}</div></section>
    `;
  }

  function openDetail(id, updateHistory = true) {
    const cultivar = catalog?.cultivars?.find(item => item.id === id);
    if (!cultivar) return;
    savedScrollY = window.scrollY;
    renderDetail(cultivar);
    if (!dialog.open) dialog.showModal();
    if (updateHistory) {
      const url = new URL(location.href);
      url.searchParams.set("strain", id);
      history.pushState({ strain: id }, "", url);
    }
  }

  function closeDetail(updateHistory = true) {
    if (!dialog.open) return;
    suppressCloseHistory = !updateHistory;
    dialog.close();
  }

  dialog.addEventListener("close", () => {
    if (!suppressCloseHistory) {
      const url = new URL(location.href);
      if (url.searchParams.has("strain")) {
        url.searchParams.delete("strain");
        history.pushState({}, "", url);
      }
    }
    suppressCloseHistory = false;
    requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
  });

  detailShell.addEventListener("click", event => {
    if (event.target.closest(".close-detail")) closeDetail(true);
  });

  grid.addEventListener("click", event => {
    const card = event.target.closest("[data-strain-id]");
    if (card) openDetail(card.dataset.strainId, true);
  });

  search.addEventListener("input", renderGrid);

  document.getElementById("explore")?.addEventListener("click", event => {
    const button = event.target.closest("[data-explore]");
    if (button) setExplore(button.dataset.explore || "all", false);
  });

  document.querySelector(".home-entries")?.addEventListener("click", event => {
    const button = event.target.closest("[data-home-target]");
    if (!button) return;
    const target = button.dataset.homeTarget;
    if (target === "cultivars") document.getElementById("cultivars")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (target === "media") document.getElementById("media")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (target === "explore") document.querySelector(".explore-overview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector(".explore-overview")?.addEventListener("click", event => {
    const button = event.target.closest("[data-explore-jump]");
    if (button) setExplore(button.dataset.exploreJump, true);
  });

  window.addEventListener("popstate", () => {
    const id = new URL(location.href).searchParams.get("strain");
    if (id) openDetail(id, false);
    else if (dialog.open) closeDetail(false);
  });

  function setCount(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? 0);
  }

  async function boot() {
    try {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`runtime catalog HTTP ${response.status}`);
      catalog = await response.json();
      if (!Array.isArray(catalog.cultivars)) throw new Error("cultivars array is missing");

      dataState.textContent = "MASTER DATA";
      catalogMeta.textContent = `${catalog.counts?.cultivars ?? 0} CULTIVARS · ${catalog.counts?.sources ?? 0} SOURCES · ${catalog.counts?.entities ?? 0} ENTITIES`;
      setCount("entry-cultivar-count", catalog.counts?.cultivars);
      for (const key of ["sativa", "indica", "hybrid"]) {
        const count = catalog.explore?.[key]?.length || 0;
        setCount(`count-${key}`, count);
        setCount(`overview-${key}`, count);
      }
      renderGrid();

      const initialId = new URL(location.href).searchParams.get("strain");
      if (initialId) openDetail(initialId, false);
    } catch (error) {
      console.error(error);
      dataState.textContent = "DATA ERROR";
      dataState.classList.add("is-error");
      resultLabel.textContent = "読み込み失敗";
      grid.innerHTML = `<div class="error-box">MASTER runtime dataを読み込めませんでした。runtime/catalog.json の生成状態を確認してください。</div>`;
    }
  }

  boot();
})();
