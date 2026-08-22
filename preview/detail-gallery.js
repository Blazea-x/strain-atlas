(() => {
  "use strict";

  const DATA_URL = "runtime/catalog.json";
  const ASSET_BASE = "";
  const detailShell = document.getElementById("detail-shell");
  if (!detailShell) return;

  const asset = src => /^https?:\/\//i.test(src || "") ? src : ASSET_BASE + String(src || "").replace(/^\/+/, "");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const orderedVisuals = cultivar => {
    const visuals = (cultivar?.visuals || []).filter(visual => visual?.src);
    const primary = visuals.filter(visual => visual.role === "primary");
    const rest = visuals.filter(visual => visual.role !== "primary");
    return [...primary, ...rest];
  };

  const style = document.createElement("style");
  style.id = "detail-native-gallery-styles";
  style.textContent = `
    .detail-hero .detail-gallery{position:relative;width:100%;background:#07100b}
    .detail-hero .detail-gallery-track{display:flex;width:100%;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;touch-action:pan-x pan-y}
    .detail-hero .detail-gallery-track::-webkit-scrollbar{display:none}
    .detail-hero .detail-gallery-slide{flex:0 0 100%;width:100%;height:min(58vh,150vw);display:flex;align-items:center;justify-content:center;scroll-snap-align:start;scroll-snap-stop:always;background:#07100b}
    .detail-hero .detail-gallery-slide img{display:block;width:100%;height:100%;max-height:none;object-fit:contain;background:#07100b}
    .detail-hero .detail-gallery-count{position:absolute;right:10px;bottom:10px;z-index:3;min-width:42px;padding:4px 8px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(3,10,7,.72);color:#edf2ef;font-size:10px;font-weight:800;line-height:1.2;text-align:center;backdrop-filter:blur(5px)}
  `;
  document.head.appendChild(style);

  let catalogPromise;
  const getCatalog = () => {
    if (!catalogPromise) {
      catalogPromise = fetch(DATA_URL, { cache: "no-store" })
        .then(response => {
          if (!response.ok) throw new Error(`catalog ${response.status}`);
          return response.json();
        })
        .catch(error => {
          console.warn("detail gallery catalog unavailable", error);
          return null;
        });
    }
    return catalogPromise;
  };

  async function enhanceDetail() {
    const hero = detailShell.querySelector(".detail-hero");
    if (!hero || hero.dataset.galleryEnhanced === "true") return;
    const fallbackImage = hero.querySelector(":scope > img");
    if (!fallbackImage) return;

    const strainId = new URL(location.href).searchParams.get("strain");
    if (!strainId) return;
    const catalog = await getCatalog();
    const cultivar = catalog?.cultivars?.find(item => item.id === strainId);
    const visuals = orderedVisuals(cultivar);
    if (visuals.length < 2) return;

    const gallery = document.createElement("div");
    gallery.className = "detail-gallery";
    gallery.setAttribute("aria-label", `${cultivar.name || strainId} 画像ギャラリー`);
    gallery.innerHTML = `<div class="detail-gallery-track" data-detail-gallery-track>${visuals.map((visual, index) => `<div class="detail-gallery-slide"><img src="${esc(asset(visual.src))}" alt="${esc(visual.alt || "")}"${index ? ' loading="lazy"' : ""}></div>`).join("")}</div><div class="detail-gallery-count" data-detail-gallery-count>1 / ${visuals.length}</div>`;
    fallbackImage.replaceWith(gallery);
    hero.dataset.galleryEnhanced = "true";

    const track = gallery.querySelector("[data-detail-gallery-track]");
    const count = gallery.querySelector("[data-detail-gallery-count]");
    let scheduled = false;
    const updateCount = () => {
      scheduled = false;
      const width = track.clientWidth || 1;
      const index = Math.max(0, Math.min(visuals.length - 1, Math.round(track.scrollLeft / width)));
      count.textContent = `${index + 1} / ${visuals.length}`;
    };
    track.addEventListener("scroll", () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(updateCount);
    }, { passive: true });
  }

  const observer = new MutationObserver(() => queueMicrotask(enhanceDetail));
  observer.observe(detailShell, { childList: true });
  queueMicrotask(enhanceDetail);
})();
