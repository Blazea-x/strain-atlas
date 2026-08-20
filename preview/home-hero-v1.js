(() => {
  "use strict";

  const ASSET_BASE = "https://raw.githubusercontent.com/Blazea-x/strain-atlas/master-migration/";
  const HERO = Object.freeze({
    name: "Bubble Gum",
    src: "strains/bubble-gum/images/generated/primary-v2.webp",
    alt: "Bubble Gumの乾燥前の花を資料に基づいて表現したAI生成参考ビジュアル"
  });

  const heroImage = document.getElementById("home-hero-image");
  const heroCaption = document.getElementById("home-hero-caption");
  if (!heroImage) return;

  heroImage.addEventListener("load", () => {
    heroImage.classList.add("is-ready");
  }, { once: true });
  heroImage.src = ASSET_BASE + HERO.src;
  heroImage.alt = HERO.alt;
  heroImage.removeAttribute("aria-hidden");
  if (heroCaption) heroCaption.textContent = `ARCHIVE VISUAL · ${HERO.name}`;
})();
