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

  function normalizeVisibleTerpeneTones() {
    for (const chip of shell.querySelectorAll(".public-terpene-chip")) {
      for (const className of [...chip.classList]) if (toneClasses.has(className)) chip.classList.remove(className);
      chip.classList.add(toneFor(chip.textContent));
    }
  }

  const observer = new MutationObserver(normalizeVisibleTerpeneTones);
  observer.observe(shell, { childList: true, subtree: true });
  normalizeVisibleTerpeneTones();
})();
