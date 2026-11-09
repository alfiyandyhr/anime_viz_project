"use strict";
Object.assign(elements, {
  networkSearch: document.querySelector("#network-search"),
  networkTypeButtons: document.querySelectorAll("[data-network-type]"),
  networkSummary: document.querySelector("#network-summary")
});
let networkDust = null;
registerPage({
  bindControls() {
    const select = document.querySelector("#network-scope");
    const params = new URL(window.location.href).searchParams;
    let requested = params.get("scope") || (params.get("mode") === "catalogue" ? "catalogue" : "dust");
    function readDustScope() {
      try { networkDust = AnivizNetworkScope.read(sessionStorage); } catch (_) { networkDust = null; }
      select.querySelector('[value="dust"]').disabled = !networkDust?.ids;
      select.value = requested === "catalogue" || !networkDust?.ids ? "catalogue" : "dust";
      document.querySelector("#network-dust-note").hidden = !networkDust?.movieDust;
    }
    readDustScope();
    window.addEventListener("pageshow", event => {
      if (event.persisted) { readDustScope(); renderPage(); }
    });
    select.addEventListener("change", () => { requested = select.value; renderPage(); });
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
