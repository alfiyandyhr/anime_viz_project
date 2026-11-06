"use strict";
Object.assign(elements, {
  networkSearch: document.querySelector("#network-search"),
  networkTypeButtons: document.querySelectorAll("[data-network-type]"),
  networkSummary: document.querySelector("#network-summary")
});
let networkDust = null;
registerPage({
  bindControls() {
    try { networkDust = AnivizNetworkScope.read(sessionStorage); } catch (_) { /* Direct catalogue fallback. */ }
    const select = document.querySelector("#network-scope");
    select.querySelector('[value="dust"]').disabled = !networkDust;
    const params = new URL(window.location.href).searchParams;
    const requested = params.get("scope") || (params.get("mode") === "catalogue" ? "catalogue" : "dust");
    select.value = requested === "catalogue" ? "catalogue" : networkDust ? "dust" : "catalogue";
    select.addEventListener("change", renderPage);
    elements.networkSearch.addEventListener("input", debounce(renderPage, 200));
    elements.networkTypeButtons.forEach(button => button.addEventListener("click", () => {
      const type = button.dataset.networkType;
      if (state.networkTypes.has(type)) state.networkTypes.delete(type);
      else state.networkTypes.add(type);
      button.setAttribute("aria-pressed", state.networkTypes.has(type));
      renderNetwork();
    }));
  },
  render() {
    const scope = AnivizNetworkScope.resolve(state.data.anime, networkDust, document.querySelector("#network-scope").value);
    state.networkAnime = scope.anime;
    state.networkScopeInfo = scope;
    renderNetwork();
  },
  destroy() { state.networkSimulation?.stop(); }
});
