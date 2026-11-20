"use strict";

(function (root) {
  const posterZoom = 6;

  function attach({ container, svg, d3, extent, label, onStart, onZoom, zoomInPoint, zoomContent = "posters",
    maxZoom = 12, canDragFrom = () => true }) {
    svg.attr("role", "group").attr("tabindex", 0)
      .attr("aria-description", `Zoom in for ${zoomContent}. When zoomed in, drag or use arrow keys to pan.`);
    const controls = d3.select(container).append("div").attr("class", "dust-zoom-controls")
      .attr("role", "group").attr("aria-label", `${label} zoom controls`)
      .html(`<button type="button" aria-label="Zoom out" title="Zoom out">−</button>
        <button type="button" class="dust-zoom-reset" aria-label="Reset zoom" title="Reset zoom">1×</button>
        <button type="button" aria-label="Zoom in" title="Zoom in">+</button>`);
    const [zoomOut, resetZoom, zoomIn] = controls.selectAll("button").nodes();
    const getTransform = () => d3.zoomTransform(svg.node());
    const zoom = d3.zoom().extent(extent).translateExtent(extent).scaleExtent([1, maxZoom]).clickDistance(4)
      .filter(event => {
        if (event.type === "wheel") return !event.button;
        if (event.ctrlKey || event.button || !canDragFrom(event.target)) return false;
        return event.type !== "mousedown" || getTransform().k > 1;
      })
      .on("start", onStart)
      .on("zoom", ({ transform }) => {
        const { k } = transform;
        const showPosters = k >= posterZoom;
        svg.classed("is-zoomed", k > 1).classed("shows-posters", showPosters);
        zoomOut.disabled = resetZoom.disabled = k === 1;
        zoomIn.disabled = k === maxZoom;
        resetZoom.textContent = `${Number(k.toFixed(1))}×`;
        onZoom(transform, showPosters);
      });
    svg.call(zoom).on("dblclick.zoom", null);
    const zoomTouchMove = svg.on("touchmove.zoom");
    if (zoomTouchMove) {
      svg.on("touchmove.zoom", function (event, datum) {
        // Let a single finger scroll the page in the overview while retaining pinch zoom.
        if (event.touches.length > 1 || getTransform().k > 1) zoomTouchMove.call(this, event, datum);
      });
    }
    svg.on("keydown", event => {
      const { k } = getTransform();
      if (event.target !== svg.node() || k === 1) return;
      const delta = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const step = 48 / k;
      svg.call(zoom.translateBy, delta[0] * step, delta[1] * step);
    });
    zoomOut.disabled = resetZoom.disabled = true;
    zoomOut.addEventListener("click", () => svg.call(zoom.scaleBy, .5));
    resetZoom.addEventListener("click", () => svg.call(zoom.transform, d3.zoomIdentity));
    zoomIn.addEventListener("click", () => svg.call(zoom.scaleBy, 2, zoomInPoint?.(getTransform())));
    return {
      getTransform,
      setTransform: transform => svg.call(zoom.transform, zoom.constrain()(transform, extent, extent))
    };
  }

  function addCards(posters, { title, color }) {
    const cards = posters.attr("width", 68).attr("height", 124)
      .append("xhtml:div").attr("class", "dust-poster-card");
    const images = cards.append("img").attr("alt", "").attr("decoding", "async").property("hidden", true)
      .on("error", function () { this.hidden = true; });
    const titles = cards.append("span").attr("class", "dust-poster-title").style("color", color).text(title);
    return { images, titles };
  }

  function drawArtwork(images, thumbnail) {
    images.each(function (item) {
      const url = thumbnail(item) || null;
      if (url === this.getAttribute("src")) return;
      this.hidden = !url;
      if (url) this.setAttribute("src", url);
      else this.removeAttribute("src");
    });
  }

  root.AnivizPosterZoom = Object.freeze({ attach, addCards, drawArtwork });
})(globalThis);
