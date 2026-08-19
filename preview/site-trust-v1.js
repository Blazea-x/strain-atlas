(() => {
  "use strict";

  const UPDATES_URL = "preview/site-updates.json";
  const MAX_UPDATES = 3;
  const updatesSection = document.getElementById("updates");
  const updatesList = document.getElementById("updates-list");
  const updatesState = document.getElementById("updates-state");
  const latestSection = document.querySelector(".latest-section");
  const catalogMeta = document.getElementById("catalog-meta");

  function syncHomeOnlyVisibility() {
    if (!updatesSection) return;
    updatesSection.hidden = Boolean(latestSection?.hidden);
  }

  function normalizeEntry(entry, index) {
    if (!entry || typeof entry !== "object") return null;
    const date = String(entry.date || "").trim();
    const category = String(entry.category || "").trim();
    const title = String(entry.title || "").trim();
    const summary = String(entry.summary || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !category || !title || !summary) return null;
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time)) return null;
    return { date, category, title, summary, time, index };
  }

  function formatDate(date) {
    return date.replace(/-/g, ".");
  }

  function renderUpdates(entries) {
    if (!updatesList || !updatesState) return;
    updatesList.replaceChildren();
    if (!entries.length) {
      updatesState.textContent = "現在お知らせはありません";
      updatesState.hidden = false;
      return;
    }

    const fragment = document.createDocumentFragment();
    entries.forEach(entry => {
      const row = document.createElement("article");
      row.className = "update-row";

      const meta = document.createElement("div");
      meta.className = "update-meta";
      const time = document.createElement("time");
      time.dateTime = entry.date;
      time.textContent = formatDate(entry.date);
      const category = document.createElement("span");
      category.className = "update-category";
      category.textContent = entry.category;
      meta.append(time, category);

      const copy = document.createElement("div");
      copy.className = "update-copy";
      const heading = document.createElement("h3");
      heading.textContent = entry.title;
      const summary = document.createElement("p");
      summary.textContent = entry.summary;
      copy.append(heading, summary);

      row.append(meta, copy);
      fragment.appendChild(row);
    });
    updatesList.appendChild(fragment);
    updatesState.hidden = true;
  }

  async function loadUpdates() {
    if (!updatesSection || !updatesList || !updatesState) return;
    try {
      const response = await fetch(UPDATES_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`updates HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.entries)) throw new Error("updates entries are missing");
      const entries = payload.entries
        .map(normalizeEntry)
        .filter(Boolean)
        .sort((a, b) => b.time - a.time || a.index - b.index)
        .slice(0, MAX_UPDATES);
      renderUpdates(entries);
    } catch (error) {
      console.warn("SITE TRUST updates unavailable", error);
      renderUpdates([]);
    }
  }

  function patchFooterLinks() {
    const nav = catalogMeta?.querySelector(".catalog-footer-links");
    if (!nav) return;
    const links = [
      ["#updates", "お知らせ"],
      ["#about", "この図鑑について"]
    ];
    links.forEach(([href, label]) => {
      if (nav.querySelector(`a[href="${href}"]`)) return;
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      nav.appendChild(link);
    });
  }

  if (latestSection) {
    new MutationObserver(syncHomeOnlyVisibility).observe(latestSection, { attributes: true, attributeFilter: ["hidden"] });
  }
  if (catalogMeta) {
    new MutationObserver(patchFooterLinks).observe(catalogMeta, { childList: true, subtree: true });
  }

  syncHomeOnlyVisibility();
  patchFooterLinks();
  loadUpdates();
})();
