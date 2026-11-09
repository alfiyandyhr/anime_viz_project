"use strict";

(() => {
  const project = new URL("../../", document.currentScript.src);
  const $ = selector => document.querySelector(selector);
  const journey = $("#history-journey");
  const panel = $(".history-panel");
  const yearPicker = $("#year-picker");
  const previous = $("#previous-year");
  const next = $("#next-year");
  const dialog = $("#history-dialog");
  const retry = $("#retry-data");
  const yearTravel = 76;
  const number = new Intl.NumberFormat("en");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const legacyYears = new Map([
    ["#birth", 1963], ["#expansion", 1980], ["#global", 1990],
    ["#digital", 2000], ["#streaming", 2010], ["#modern", 2020]
  ]);
  let pairs = [];
  let chartStart;
  let chartEnd;
  let activeIndex = -1;
  let frame = 0;

  function safeURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function makeCard(id, label, sourceName) {
    const card = $(id);
    card.append($("#history-card-template").content.cloneNode(true));
    const kind = card.querySelector(".history-card-kind");
    const year = card.querySelector(".history-card-year");
    const title = card.querySelector("h2");
    const meta = card.querySelector(".history-card-meta");
    const summary = card.querySelector(".history-card-summary p");
    const cover = card.querySelector(".history-cover");
    const button = card.querySelector(".synopsis-button");
    kind.textContent = label;
    let entry;

    button.addEventListener("click", () => {
      $("#synopsis-kind").textContent = `${label} · ${entry.year}`;
      $("#synopsis-title").textContent = entry.title;
      $("#synopsis-text").textContent = entry.description;
      const source = $("#synopsis-source");
      const href = safeURL(entry.url);
      source.hidden = !href;
      source.href = href;
      source.textContent = `View on ${sourceName} ↗`;
      dialog.showModal();
    });
    cover.addEventListener("error", () => { cover.hidden = true; });

    return (work, emptyMessage) => {
      entry = work;
      year.textContent = work?.year ?? "";
      title.textContent = work?.title || emptyMessage;
      meta.textContent = work?.meta || "";
      meta.hidden = !work?.meta;
      summary.textContent = work ? work.description || "No synopsis available." : "";
      const image = safeURL(work?.cover);
      cover.hidden = !image;
      if (image) cover.src = image;
      else cover.removeAttribute("src");
      button.hidden = !work?.description;
      button.setAttribute("aria-label", `Read synopsis for ${work?.title ?? label}`);
    };
  }

  const updateAnime = makeCard("#history-anime", "Top anime", "AniList");
  const updateMovie = makeCard("#history-movie", "Movie match", "TMDB");

  function yFor(year) {
    return 34 + 234 * (year - chartStart) / Math.max(1, chartEnd - chartStart);
  }

  function drawTicks() {
    const ticks = $("#history-ticks");
    const marks = [];
    for (let year = Math.ceil(chartStart / 10) * 10; year <= chartEnd; year += 10) {
      const y = yFor(year);
      const mark = document.createElementNS(svgNamespace, "path");
      mark.setAttribute("class", "history-tick");
      mark.setAttribute("d", `M60 ${y} H66 M198 ${y} H204`);
      marks.push(mark);
      for (const [x, anchor] of [[55, "end"], [209, "start"]]) {
        const label = document.createElementNS(svgNamespace, "text");
        label.setAttribute("class", "history-tick-label");
        label.setAttribute("x", x);
        label.setAttribute("y", y);
        label.setAttribute("dy", ".35em");
        label.setAttribute("text-anchor", anchor);
        label.textContent = year;
        marks.push(label);
      }
    }
    ticks.replaceChildren(...marks);
  }

  function updatePoint(track, year) {
    const point = $(`#${track}-point`);
    const label = $(`#${track}-point-year`);
    point.toggleAttribute("hidden", year == null);
    label.toggleAttribute("hidden", year == null);
    if (year == null) return;
    const y = yFor(year);
    point.setAttribute("cy", y);
    label.setAttribute("y", y < 50 ? y + 16 : y - 8);
    label.textContent = year;
  }

  function render(index) {
    if (activeIndex === index) return;
    activeIndex = index;
    const { year, anime, movie, score } = pairs[index];
    yearPicker.value = year;
    previous.disabled = index === 0;
    next.disabled = index === pairs.length - 1;
    updateAnime(anime && {
      ...anime,
      meta: [Number.isFinite(anime.popularity) ? `${number.format(anime.popularity)} AniList users` : "",
        ...(anime.genres || []).slice(0, 2)].filter(Boolean).join(" · "),
      url: anime.site_url,
      cover: anime.cover?.large || anime.cover?.medium
    }, "No anime data for this year");
    updateMovie(movie && {
      ...movie, description: movie.synopsis, meta: (movie.genres || []).slice(0, 3).join(" · ")
    }, anime ? "No movie match available" : "No anime to match");

    updatePoint("anime", anime?.year);
    updatePoint("movie", movie?.year);
    const line = $("#history-connection");
    line.toggleAttribute("hidden", !movie);
    const caption = $("#history-score");
    if (movie) {
      const from = yFor(year);
      const to = yFor(movie.year);
      line.setAttribute("d", `M66 ${from} C120 ${from} 144 ${to} 198 ${to}`);
      const value = document.createElement("strong");
      value.textContent = score.toFixed(3);
      caption.replaceChildren("Cosine similarity ", value);
      $("#timeline-title").textContent = `${anime.title} (${year}) connected to ${movie.title} (${movie.year})`;
    } else {
      caption.textContent = `No match for ${year}`;
      $("#timeline-title").textContent = `Anime and movie release timelines for ${year}`;
    }
  }

  function stickyTop() {
    return parseFloat(getComputedStyle(panel).top);
  }

  function syncScroll() {
    frame = 0;
    if (!pairs.length) return;
    const offset = stickyTop() - journey.getBoundingClientRect().top;
    const index = Math.min(pairs.length - 1, Math.max(0, Math.round(offset / yearTravel)));
    render(index);
  }

  function queueSync() {
    if (!frame) frame = requestAnimationFrame(syncScroll);
  }

  function goTo(index) {
    if (!pairs[index]) return;
    const start = window.scrollY + journey.getBoundingClientRect().top - stickyTop();
    window.scrollTo({ top: Math.max(0, start + index * yearTravel), behavior: "instant" });
    syncScroll();
  }

  function followLegacyHash() {
    const year = legacyYears.get(location.hash);
    if (year && pairs.length) goTo(year - pairs[0].year);
  }

  async function load() {
    const status = $("#history-load");
    const message = status.querySelector("span");
    status.hidden = false;
    retry.hidden = true;
    message.textContent = "Loading annual anime and movie matches…";
    try {
      // Use the published archive so its annual winners match the offline score export.
      const [archive, bundle] = await Promise.all([
        AnivizAPI.fetchJSON(new URL("story.json", project), { timeout: 15000 }),
        AnivizAPI.fetchJSON(new URL("data/history_movie_matches.json", project), { timeout: 15000 })
      ]);
      pairs = StoryData.yearPairs(StoryData.validate(archive), bundle);
      const first = pairs[0].year;
      const last = pairs.at(-1).year;
      const years = pairs.flatMap(pair => pair.movie ? [pair.movie.year] : []);
      chartStart = Math.min(first, ...years);
      chartEnd = Math.max(last, ...years);
      drawTicks();

      yearPicker.replaceChildren(...pairs.map(({ year }) => new Option(year, year)));
      $("#history-range").textContent = `${first}–${last}`;
      $("#movie-count").textContent = number.format(bundle.meta.movie_count);
      $("#history-travel").style.height = `${(pairs.length - 1) * yearTravel}px`;
      for (const id of ["history-controls", "history-pair", "history-note"]) $(`#${id}`).hidden = false;
      status.hidden = true;
      syncScroll();
      followLegacyHash();
    } catch (error) {
      message.textContent = "The annual archive could not be loaded. Try again to open the timelines.";
      retry.hidden = false;
      console.warn("History data unavailable", error);
    }
  }

  window.addEventListener("scroll", queueSync, { passive: true });
  window.addEventListener("resize", queueSync);
  window.addEventListener("pageshow", queueSync);
  window.addEventListener("hashchange", followLegacyHash);
  yearPicker.addEventListener("change", () => goTo(yearPicker.selectedIndex));
  previous.addEventListener("click", () => goTo(activeIndex - 1));
  next.addEventListener("click", () => goTo(activeIndex + 1));
  retry.addEventListener("click", load);
  load();
})();
