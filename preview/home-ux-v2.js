(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/runtime/catalog.json";
  const PUBLICATION_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/production/publication.json";
  const latestGrid = document.getElementById("latest-grid");
  const latestState = document.getElementById("latest-state");
  const latestCount = document.getElementById("latest-count");
  const allGrid = document.getElementById("cultivar-grid");
  const catalogMeta = document.getElementById("catalog-meta");

  let catalog = null;
  let cultivarById = new Map();
  let latestIds = [];
  const cardTemplates = new Map();

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

  function displayIdentity(cultivar) {
    const formalName = String(cultivar?.name || "").trim();
    const generation = String(cultivar?.breeding?.generation || "").trim();
    const visibleGeneration = generation && generation.toLowerCase() !== "unknown" ? generation : "";
    const suffix = visibleGeneration ? ` ${visibleGeneration}` : "";
    const displayName = suffix && formalName.endsWith(suffix) ? formalName.slice(0, -suffix.length) : formalName;
    return { formalName, displayName: displayName || formalName, generation: visibleGeneration };
  }

  function breederName(cultivar) {
    if (!catalog || !cultivar) return "";
    const relations = cultivar.relations || [];
    const preferred = relations.find(relation => (relation.roles || []).includes("breeder")) ||
      relations.find(relation => (relation.roles || []).includes("seedCompany"));
    if (!preferred) return "";
    return catalog.entities?.[preferred.entityId]?.name || "";
  }

  function decorateCard(card) {
    const cultivar = cultivarById.get(card?.dataset?.strainId);
    const nameNode = card?.querySelector(".tile-name");
    if (!cultivar || !nameNode) return;
    const identity = displayIdentity(cultivar);
    const breeder = breederName(cultivar);
    nameNode.innerHTML = `<div class="tile-name-row"><span class="tile-display-name">${esc(identity.displayName)}</span>${identity.generation ? `<span class="generation-badge">${esc(identity.generation)}</span>` : ""}</div>${breeder ? `<div class="tile-breeder">${esc(breeder)}</div>` : ""}`;
    card.dataset.displayDecorated = "true";
  }

  function captureCanonicalCards() {
    if (!allGrid || !catalog) return;
    allGrid.querySelectorAll("[data-strain-id]").forEach(card => {
      decorateCard(card);
      cardTemplates.set(card.dataset.strainId, card.cloneNode(true));
    });
    renderLatestCards();
  }

  function renderLatestCards() {
    if (!latestGrid || !latestIds.length) return;
    const fragment = document.createDocumentFragment();
    let rendered = 0;
    for (const id of latestIds) {
      const template = cardTemplates.get(id);
      if (!template) continue;
      fragment.appendChild(template.cloneNode(true));
      rendered += 1;
    }
    if (rendered !== latestIds.length) return;
    latestGrid.replaceChildren(fragment);
    latestState?.classList.add("is-ready");
    if (latestCount) latestCount.textContent = `${rendered}件`;
  }

  function sortPublicationEntries(entries, runtimeIds) {
    return entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry?.state === "published" && runtimeIds.has(entry.strainId))
      .sort((a, b) => {
        const aTime = a.entry.publishedAt ? Date.parse(a.entry.publishedAt) : Number.NEGATIVE_INFINITY;
        const bTime = b.entry.publishedAt ? Date.parse(b.entry.publishedAt) : Number.NEGATIVE_INFINITY;
        if (aTime !== bTime) return bTime - aTime;
        if (a.index !== b.index) return b.index - a.index;
        return String(a.entry.strainId).localeCompare(String(b.entry.strainId), "en");
      });
  }

  function localizeResultLabel() {
    const label = document.getElementById("result-label");
    if (!label) return;
    const text = label.textContent.trim();
    if (/^\d+\s*\/\s*\d+$/.test(text)) label.textContent = `表示 ${text}`;
  }

  function renderFooter() {
    if (!catalogMeta || !catalog) return;
    const counts = catalog.counts || {};
    catalogMeta.innerHTML = `<div class="catalog-footer-brand">Cannabis Strain Wisdom</div><div class="catalog-footer-counts">${esc(counts.cultivars ?? catalog.cultivars.length)} 品種 · ${esc(counts.sources ?? 0)} 出典 · ${esc(counts.entities ?? 0)} 関連組織・ブリーダー</div><nav class="catalog-footer-links" aria-label="ページ内リンク"><a href="#site-title">このサイトについて</a><a href="#cultivars">品種一覧</a><a href="#legal-alert">重要なお知らせ</a></nav>`;
  }

  function openLatestDetail(id) {
    if (!cultivarById.has(id)) return;
    const url = new URL(location.href);
    url.searchParams.set("strain", id);
    history.pushState({ strain: id }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: { strain: id } }));
  }

  if (latestGrid) {
    latestGrid.addEventListener("click", event => {
      const card = event.target.closest("[data-strain-id]");
      if (card) openLatestDetail(card.dataset.strainId);
    });
  }

  if (allGrid) {
    new MutationObserver(() => {
      captureCanonicalCards();
      localizeResultLabel();
    }).observe(allGrid, { childList: true, subtree: false });
  }

  const resultLabel = document.getElementById("result-label");
  if (resultLabel) new MutationObserver(localizeResultLabel).observe(resultLabel, { childList: true, characterData: true, subtree: true });

  async function bootHomeUxV2() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`runtime catalog HTTP ${response.status}`);
      catalog = await response.json();
      if (!Array.isArray(catalog.cultivars)) throw new Error("cultivars array is missing");
      cultivarById = new Map(catalog.cultivars.map(cultivar => [cultivar.id, cultivar]));
      renderFooter();
      captureCanonicalCards();
    } catch (error) {
      console.warn("HOME UX V2 catalog enhancement unavailable", error);
    }

    if (!catalog) return;
    try {
      const response = await fetch(PUBLICATION_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`publication registry HTTP ${response.status}`);
      const publication = await response.json();
      if (!Array.isArray(publication.entries)) throw new Error("publication entries are missing");
      const runtimeIds = new Set(catalog.cultivars.map(cultivar => cultivar.id));
      latestIds = sortPublicationEntries(publication.entries, runtimeIds).slice(0, 6).map(({ entry }) => entry.strainId);
      if (!latestIds.length) throw new Error("no published cultivar is eligible for recent display");
      renderLatestCards();
    } catch (error) {
      console.warn("HOME UX V2 publication registry unavailable", error);
      latestIds = [];
      latestGrid?.replaceChildren();
      if (latestState) {
        latestState.textContent = "新着情報を取得できません";
        latestState.classList.remove("is-ready");
        latestState.classList.add("is-error");
      }
      if (latestCount) latestCount.textContent = "取得不可";
    }
  }

  bootHomeUxV2();
})();
