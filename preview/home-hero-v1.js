(() => {
  "use strict";

  const DATA_URL = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/runtime/catalog.json";
  const ASSET_BASE = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/";
  const heroImage = document.getElementById("home-hero-image");
  const heroCaption = document.getElementById("home-hero-caption");

  if (!heroImage) return;

  const asset = src => /^https?:\/\//i.test(src || "")
    ? src
    : ASSET_BASE + String(src || "").replace(/^\/+/, "");

  const primaryVisual = cultivar =>
    (cultivar?.visuals || []).find(visual => visual.role === "primary") ||
    (cultivar?.visuals || [])[0] ||
    null;

  async function loadHero() {
    try {
      const response = await fetch(`${DATA_URL}?hero=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`runtime catalog HTTP ${response.status}`);
      const catalog = await response.json();
      if (!Array.isArray(catalog.cultivars)) throw new Error("cultivars array is missing");

      const preferred = catalog.cultivars.find(cultivar => cultivar.id === "bubble-gum" && primaryVisual(cultivar));
      const fallback = catalog.cultivars.find(cultivar => primaryVisual(cultivar));
      const cultivar = preferred || fallback;
      const visual = primaryVisual(cultivar);
      if (!cultivar || !visual?.src) return;

      heroImage.addEventListener("load", () => {
        heroImage.classList.add("is-ready");
      }, { once: true });
      heroImage.src = asset(visual.src);
      heroImage.alt = visual.alt || `${cultivar.name} archive visual`;
      heroImage.removeAttribute("aria-hidden");
      if (heroCaption) heroCaption.textContent = `ARCHIVE VISUAL · ${cultivar.name}`;
    } catch (error) {
      console.warn("HOME HERO V1 visual unavailable", error);
    }
  }

  loadHero();
})();
