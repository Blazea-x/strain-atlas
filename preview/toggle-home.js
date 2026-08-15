(() => {
  "use strict";

  const panels = () => [...document.querySelectorAll("[data-content-panel]")];
  const entries = () => [...document.querySelectorAll("[data-home-target]")];

  function closeHomePanel() {
    panels().forEach(panel => { panel.hidden = true; });
    entries().forEach(button => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function showCultivarsForSearch() {
    const cultivarPanel = document.querySelector('[data-content-panel="cultivars"]');
    if (!cultivarPanel) return;
    cultivarPanel.hidden = false;
    entries().forEach(button => {
      const active = button.dataset.homeTarget === "cultivars";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-home-target]");
    if (!button || button.getAttribute("aria-pressed") !== "true") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeHomePanel();
  }, true);

  document.addEventListener("input", event => {
    if (event.target?.id !== "search") return;
    if (!String(event.target.value || "").trim()) return;
    if (panels().every(panel => panel.hidden)) showCultivarsForSearch();
  }, true);
})();
