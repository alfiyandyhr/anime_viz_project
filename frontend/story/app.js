"use strict";

(() => {
  const project = new URL("../../", document.currentScript.src);
  const $ = selector => document.querySelector(selector);
  const journey = $("#history-journey");
  const pairPanel = $("#history-pair");
  const animeAxis = $("#anime-axis");
  const movieAxis = $("#movie-axis");
  const highlightLine = $("#history-highlight-line");
  const yearPicker = $("#year-picker");
  const matchCount = $("#match-count");
  const previous = $("#previous-year");
  const next = $("#next-year");
  const perspective = $(".history-perspective");
  const status = $("#history-load");
  const message = status.querySelector("span");
  const dialog = $("#history-dialog");
  const zoom = $("#history-zoom");
  const zoomYears = $("#history-zoom-years");
  const zoomStatus = $("#history-zoom-status");
  const zoomRetry = zoomStatus.querySelector("button");
  const retry = $("#retry-data");
  const yearTravel = 76;
  const animeStart = 1963;
  const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
  const svgNamespace = "http://www.w3.org/2000/svg";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const slideTiming = { duration: 440, easing: "cubic-bezier(.22, 1, .36, 1)" };
  const legacyYears = new Map([
    ["#birth", 1963], ["#expansion", 1980], ["#global", 1990],
    ["#digital", 2000], ["#streaming", 2010], ["#modern", 2020]
  ]);
  const timelines = new Map();
  const animeCovers = new Map();
  const movieCovers = new Map();
  let liveActionMovieIds;
  let activePerspective = "anime";
  let perspectiveRequest = 0;
  let pairs = [];
  let chartStart;
  let chartEnd;
  let activeIndex = -1;
  let selectedMatch = 0;
  let hoveredRank;
  let focusedRank;
  let synopsisScroll;
  let frame = 0;
  let connectionFrame = 0;
  let zoomTrack;
  let zoomSession = 0;
  let zoomAnimation;

  function safeURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function openSynopsis(work, label, sourceName, card) {
    $("#synopsis-kind").textContent = `${label} · ${work.year}`;
    $("#synopsis-title").textContent = work.title;
    $("#synopsis-text").textContent = work.description || "No synopsis available.";
    const source = $("#synopsis-source");
    const href = safeURL(work.url);
    source.hidden = !href;
    source.href = href;
    source.textContent = `View on ${sourceName} ↗`;
    synopsisScroll = { card, top: card.scrollTop };
    dialog.showModal();
  }

  function makeCard(id, sourceName, covers) {
    const card = $(id);
    card.append($("#history-card-template").content.cloneNode(true));
    const pages = card.querySelector(".history-card-pages");
    const face = card.querySelector(".history-card-face");
    const kind = card.querySelector(".history-card-kind");
    const year = card.querySelector(".history-card-year");
    const title = card.querySelector("h2");
    const meta = card.querySelector(".history-card-meta");
    const summary = card.querySelector(".history-card-summary p");
    const cover = card.querySelector(".history-cover");
    const button = card.querySelector(".synopsis-button");
    const extras = card.querySelector(".history-extra-matches");
    let entry;
    let outgoing;

    function refreshArtwork() {
      const image = safeURL(entry?.cover || covers.get(String(entry?.id)));
      cover.hidden = !image;
      cover.alt = entry ? `Poster for ${entry.title}` : "";
      if (image) {
        if (cover.getAttribute("src") !== image) cover.src = image;
      } else cover.removeAttribute("src");
    }

    button.addEventListener("click", () => openSynopsis(entry, kind.textContent, sourceName, card));
    cover.addEventListener("error", () => { cover.hidden = true; });

    const update = (work, label, emptyMessage, additional, motion, focus) => {
      face.getAnimations().forEach(animation => animation.cancel());
      outgoing?.remove();
      if (!reducedMotion.matches && motion === "turn") {
        const previousPage = face.cloneNode(true);
        previousPage.classList.add("history-card-face-outgoing");
        previousPage.inert = true;
        previousPage.setAttribute("aria-hidden", "true");
        previousPage.querySelector("h2").removeAttribute("data-match-rank");
        pages.append(previousPage);
        outgoing = previousPage;
        previousPage.animate([
          { transform: "rotateY(0)", opacity: 1 },
          { transform: "rotateY(-86deg)", opacity: 0 }
        ], { duration: 185, easing: "ease-in", fill: "forwards" }).onfinish = () => {
          previousPage.remove();
          if (outgoing === previousPage) outgoing = null;
        };
        face.animate([
          { transform: "rotateY(78deg)", opacity: 0 },
          { transform: "rotateY(0)", opacity: 1 }
        ], { duration: 250, delay: 125, easing: slideTiming.easing, fill: "backwards" });
      } else if (!reducedMotion.matches && motion) {
        face.animate([
          { transform: `translateY(${motion === "backward" ? -9 : 9}px)`, opacity: .35 },
          { transform: "translateY(0)", opacity: 1 }
        ], { duration: 200, easing: "ease-out" });
      }
      const titleChanged = work?.id !== entry?.id;
      entry = work;
      kind.textContent = label;
      year.textContent = work?.year ?? "";
      title.textContent = work?.title || emptyMessage;
      if (work?.rank != null) title.dataset.matchRank = work.rank;
      else delete title.dataset.matchRank;
      meta.textContent = work?.meta || "";
      meta.hidden = !work?.meta;
      summary.textContent = work ? work.description || "No synopsis available." : "";
      refreshArtwork();
      button.hidden = !work?.description;
      button.setAttribute("aria-label", `Read synopsis for ${work?.title ?? label}`);
      extras.hidden = additional.length === 0;
      extras.replaceChildren(...additional.map(({ work, score, rank }) => {
        const item = document.createElement("li");
        item.value = rank + 1;
        const details = document.createElement("button");
        details.type = "button";
        details.dataset.matchRank = rank;
        details.textContent = `${work.title} (${work.year})`;
        details.addEventListener("click", () => selectMatch(rank));
        const value = document.createElement("span");
        value.textContent = score.toFixed(3);
        value.setAttribute("aria-label", `Cosine similarity ${value.textContent}`);
        item.append(details, value);
        return item;
      }));
      if (titleChanged) card.scrollTop = 0;
      if (focus) title.focus({ preventScroll: true });
    };
    update.refreshArtwork = refreshArtwork;
    return update;
  }

  const updateAnime = makeCard("#history-anime", "AniList", animeCovers);
  const updateMovie = makeCard("#history-movie", "TMDB", movieCovers);

  function yFor(year) {
    return 34 + 234 * (year - chartStart) / Math.max(1, chartEnd - chartStart);
  }

  function drawAxis(track, left, start, end) {
    const axis = $(`#${track}-axis`);
    axis.querySelector(".history-axis").setAttribute("d", `M0 ${yFor(start)} V${yFor(end)}`);
    const direction = left ? -1 : 1;
    const marks = [];
    // Leave space between the start label and the next decade label.
    const years = [start];
    for (let year = Math.ceil((start + 5) / 10) * 10; year <= end; year += 10) years.push(year);
    for (const year of years) {
      const y = yFor(year);
      const mark = document.createElementNS(svgNamespace, "path");
      mark.setAttribute("class", "history-tick");
      mark.setAttribute("d", `M0 ${y} H${6 * direction}`);
      const label = document.createElementNS(svgNamespace, "text");
      label.setAttribute("class", "history-tick-label");
      label.setAttribute("x", 11 * direction);
      label.setAttribute("y", y);
      label.setAttribute("dy", ".35em");
      label.setAttribute("text-anchor", left ? "end" : "start");
      label.textContent = year;
      marks.push(mark, label);
    }
    axis.querySelector(".history-ticks").replaceChildren(...marks);
    const pointLabel = $(`#${track}-point-year`);
    pointLabel.setAttribute("x", -16 * direction);
    pointLabel.setAttribute("text-anchor", left ? "start" : "end");
  }

  function updatePoint(track, year) {
    const point = $(`#${track}-point`);
    const label = $(`#${track}-point-year`);
    $(`#${track}-axis`).setAttribute("aria-label", `Zoom into the ${track} timeline for ${year ?? pairs[activeIndex].year}`);
    point.toggleAttribute("hidden", year == null);
    label.toggleAttribute("hidden", year == null);
    if (year == null) return;
    const y = yFor(year);
    point.setAttribute("cy", y);
    label.setAttribute("y", y < 50 ? y + 16 : y - 8);
    label.textContent = year;
  }

  function selectMatch(rank) {
    if (rank === selectedMatch) return;
    selectedMatch = rank;
    render(activeIndex, "turn");
  }

  function highlightMatch() {
    const rank = hoveredRank ?? focusedRank;
    const links = $("#history-connection");
    links.classList.toggle("has-highlight", rank != null);
    for (const target of pairPanel.querySelectorAll("[data-match-rank]")) {
      target.classList.toggle("is-highlighted", target.dataset.matchRank === rank);
    }
    const line = links.querySelector(".is-highlighted .history-connection");
    highlightLine.toggleAttribute("hidden", !line);
    if (line) highlightLine.setAttribute("d", line.getAttribute("d"));
  }

  function drawMatches(anchor, matches, moviePerspective, motion) {
    const lines = [];
    const points = [];
    const groups = new Map();
    for (const { work } of matches) {
      groups.set(work.year, (groups.get(work.year) || 0) + 1);
    }
    const drawn = new Map();
    for (const [rank, { work, score }] of matches.entries()) {
      const from = yFor(anchor.year);
      const to = yFor(work.year);
      // Fan out links that share both endpoints so every match stays visible.
      const occurrence = drawn.get(work.year) || 0;
      const bend = (occurrence - (groups.get(work.year) - 1) / 2) * 16;
      drawn.set(work.year, occurrence + 1);
      const target = document.createElementNS(svgNamespace, "g");
      target.setAttribute("class", "history-connection-target");
      target.dataset.matchRank = rank;
      const line = document.createElementNS(svgNamespace, "path");
      line.setAttribute("class", rank === selectedMatch ? "history-connection is-selected" : "history-connection");
      const label = document.createElementNS(svgNamespace, "title");
      label.textContent = `${work.title} (${work.year}) · Cosine similarity ${score.toFixed(3)}`;
      const hit = document.createElementNS(svgNamespace, "path");
      hit.setAttribute("class", "history-connection-hit");
      target.append(label, line, hit);
      target.addEventListener("click", () => selectMatch(rank));
      lines.push({ target, line, hit, from, to, bend });
      if (occurrence === 0 && work.year !== matches[selectedMatch].work.year) {
        const point = document.createElementNS(svgNamespace, "circle");
        point.setAttribute("class", "history-point");
        point.setAttribute("cy", yFor(work.year));
        point.setAttribute("r", 4);
        points.push(point);
      }
    }
    const links = $("#history-connection");
    links.replaceChildren(...lines.map(({ target }) => target));
    $("#anime-match-points").replaceChildren(...(moviePerspective ? points : []));
    $("#movie-match-points").replaceChildren(...(moviePerspective ? [] : points));
    links.getAnimations().forEach(animation => animation.cancel());
    if (!reducedMotion.matches && motion && motion !== "turn" && motion !== "swap") {
      links.animate([{ opacity: 0 }, { opacity: 1 }], 180);
    }
    cancelAnimationFrame(connectionFrame);
    if (!lines.length) return;

    const [anchorAxis, matchAxis] = moviePerspective ? [movieAxis, animeAxis] : [animeAxis, movieAxis];
    function positionLinks() {
      // Read the current SVG positions, including any in-progress axis swap.
      const start = new DOMMatrixReadOnly(getComputedStyle(anchorAxis).transform).m41;
      const end = new DOMMatrixReadOnly(getComputedStyle(matchAxis).transform).m41;
      const control = (end - start) * .41;
      for (const { target, line, hit, from, to, bend } of lines) {
        const path = `M${start} ${from} C${start + control} ${from + bend} ${end - control} ${to + bend} ${end} ${to}`;
        line.setAttribute("d", path);
        hit.setAttribute("d", path);
        if (target.classList.contains("is-highlighted")) highlightLine.setAttribute("d", path);
      }
      if (anchorAxis.getAnimations().length || matchAxis.getAnimations().length) {
        connectionFrame = requestAnimationFrame(positionLinks);
      }
    }
    positionLinks();
  }

  function render(index, reason) {
    const yearChanged = index !== activeIndex;
    if (!reason && !yearChanged) return;
    const motion = reason || (activeIndex < 0 ? null : index < activeIndex ? "backward" : "forward");
    if (yearChanged) {
      selectedMatch = 0;
      hoveredRank = focusedRank = undefined;
    }
    activeIndex = index;
    const { year, anchor, matches } = pairs[index];
    const visible = matches.slice(0, Number(matchCount.value));
    if (selectedMatch >= visible.length) selectedMatch = 0;
    const selected = visible[selectedMatch];
    const additional = visible.map((match, rank) => ({ ...match, rank })).filter(match => match.rank !== selectedMatch);
    const moviePerspective = activePerspective === "movie";
    const anime = moviePerspective ? selected?.work : anchor;
    const movie = moviePerspective ? anchor : selected?.work;
    const flipping = motion === "turn";
    const cardMotion = motion === "count" || motion === "swap" ? null : motion;
    yearPicker.value = year;
    previous.disabled = index === 0;
    next.disabled = index === pairs.length - 1;
    if (!flipping || moviePerspective) updateAnime(anime && {
      ...anime,
      rank: moviePerspective ? selectedMatch : null,
      meta: [Number.isFinite(anime.popularity) ? `${number.format(anime.popularity)} AniList users` : "",
        ...(anime.genres || []).slice(0, 2)].filter(Boolean).join(" · "),
      url: anime.site_url,
      cover: anime.cover?.large || anime.cover?.medium
    }, moviePerspective ? `Anime match ${selectedMatch + 1}` : "Top anime", "No anime data for this year",
    moviePerspective ? additional : [], cardMotion, flipping);
    if (!flipping || !moviePerspective) updateMovie(movie && {
      ...movie,
      rank: moviePerspective ? null : selectedMatch,
      description: movie.synopsis,
      meta: [moviePerspective ? `TMDB popularity ${number.format(movie.popularity)}` : "",
        ...(movie.genres || []).slice(0, moviePerspective ? 2 : 3)].filter(Boolean).join(" · ")
    }, moviePerspective ? "Top live-action movie" : `Movie match ${selectedMatch + 1}`,
    anime ? "No movie match available" : "No anime to match", moviePerspective ? [] : additional, cardMotion, flipping);

    updatePoint("anime", anime?.year);
    updatePoint("movie", movie?.year);
    drawMatches(anchor, visible, moviePerspective, motion);
    if (hoveredRank != null && Number(hoveredRank) >= visible.length) hoveredRank = undefined;
    highlightMatch();
    const caption = $("#history-score");
    if (selected) {
      const value = document.createElement("strong");
      value.textContent = selected.score.toFixed(3);
      caption.replaceChildren(additional.length ? `Match ${selectedMatch + 1} · Cosine similarity ` : "Cosine similarity ", value);
      $("#timeline-title").textContent = `${anchor.title} (${anchor.year}) connected to `
        + visible.map(({ work }) => `${work.title} (${work.year})`).join(", ");
    } else {
      caption.textContent = `No match for ${year}`;
      $("#timeline-title").textContent = `Anime and movie release timelines for ${year}`;
    }
    if (yearChanged) matchSpan.update(activePerspective, pairs, index);
  }

  function syncScroll(reason) {
    frame = 0;
    if (!pairs.length || synopsisScroll != null) return;
    const index = Math.min(pairs.length - 1, Math.max(0, Math.round(journey.scrollTop / yearTravel)));
    render(index, reason);
  }

  function queueSync() {
    if (!frame) frame = requestAnimationFrame(() => syncScroll());
  }

  function goTo(index, reason) {
    if (!pairs[index]) return;
    journey.scrollTo({ top: index * yearTravel, behavior: "instant" });
    syncScroll(reason);
  }

  function goToYear(year, reason) {
    goTo(StoryData.nearestYearIndex(pairs, year), reason);
  }

  function showZoomStatus(text = "", retryAction = null) {
    zoomStatus.hidden = !text;
    zoomStatus.querySelector("span").textContent = text;
    zoomYears.inert = Boolean(text);
    zoomRetry.hidden = !retryAction;
    zoomRetry.onclick = retryAction;
  }

  async function loadMovieTimeline() {
    if (!timelines.has("movie")) {
      // Artwork is optional and must not delay or reject the annual rankings.
      AnivizData.dashboard().then(({ anime }) => {
        for (const work of anime) animeCovers.set(String(work.id), AnivizArtwork.animeThumbnail(work));
        updateAnime.refreshArtwork();
      }).catch(error => console.warn("Anime posters unavailable", error));
      const catalogue = await AnivizData.recommendations();
      const popularity = await AnivizData.moviePopularity(catalogue);
      if (!timelines.has("movie")) {
        timelines.set("movie", {
          pairs: StoryData.movieYearPairs(catalogue, popularity, liveActionMovieIds),
          matchCount: catalogue.anime.length
        });
      }
    }
    return timelines.get("movie");
  }

  function makeZoomYear({ year, top }, movie) {
    const section = document.createElement("section");
    section.className = "history-zoom-year";
    const title = document.createElement("h3");
    title.textContent = year;
    title.tabIndex = -1;
    section.append(title);
    if (!top.length) {
      const empty = document.createElement("p");
      empty.textContent = "No rankings are available for this year.";
      section.append(empty);
      return section;
    }
    const list = document.createElement("ol");
    for (const work of top) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = work.title;
      const href = safeURL(movie ? work.url : work.site_url);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = work.title;
        name.replaceChildren(link);
      }
      const popularity = document.createElement("span");
      popularity.textContent = Number.isFinite(work.popularity)
        ? (movie ? `TMDB popularity ${number.format(work.popularity)}` : `${number.format(work.popularity)} AniList users`)
        : "Popularity unavailable";
      item.append(name, popularity);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  async function showZoomYear(track, year, session) {
    if (!timelines.has(track)) {
      showZoomStatus("Loading movie rankings…");
      try {
        await loadMovieTimeline();
      } catch (error) {
        if (session !== zoomSession) return;
        showZoomStatus("Movie rankings could not be loaded.", () => showZoomYear(track, year, session));
        console.warn("Timeline rankings unavailable", error);
        return;
      }
    }
    if (session !== zoomSession) return;
    showZoomStatus();
    const rows = timelines.get(track).pairs;
    const sections = rows.map(row => makeZoomYear(row, track === "movie"));
    const selected = sections[StoryData.nearestYearIndex(rows, year)];
    zoomYears.replaceChildren(...sections);
    zoomYears.scrollTo({ top: selected.offsetTop, behavior: "instant" });
    selected.querySelector("h3").focus({ preventScroll: true });
  }

  function zoomOrigin() {
    const track = zoomTrack.id === "movie-axis" ? "movie" : "anime";
    const point = $(`#${track}-point`);
    const y = point.hasAttribute("hidden") ? 141 : point.cy.baseVal.value;
    const origin = new DOMPoint(0, y).matrixTransform(zoomTrack.getScreenCTM());
    const bounds = zoom.getBoundingClientRect();
    const x = origin.x - (bounds.left + bounds.width / 2);
    const offsetY = origin.y - (bounds.top + bounds.height / 2);
    return { transform: `translate(${x}px, ${offsetY}px) scale(.28)`, opacity: 0 };
  }

  function openZoom(track, trigger) {
    if (zoom.open || activeIndex < 0) return;
    zoomTrack = trigger;
    const point = $(`#${track}-point`);
    const year = point.hasAttribute("hidden") ? pairs[activeIndex].year : Number($(`#${track}-point-year`).textContent);
    zoom.dataset.track = track;
    $("#history-zoom-title").textContent = track === "movie" ? "Top live-action movies by year" : "Top anime by year";
    zoomYears.replaceChildren();
    showZoomStatus();
    zoom.showModal();
    showZoomYear(track, year, ++zoomSession);
    if (!reducedMotion.matches) zoomAnimation = zoom.animate([zoomOrigin(), { transform: "none", opacity: 1 }], slideTiming);
  }

  function closeZoom() {
    if (zoom.hasAttribute("data-closing")) return;
    ++zoomSession;
    const finish = () => {
      zoom.close();
      zoom.removeAttribute("data-closing");
      zoomTrack.focus({ preventScroll: true });
    };
    const current = getComputedStyle(zoom);
    const from = { transform: current.transform, opacity: current.opacity };
    zoomAnimation?.cancel();
    if (reducedMotion.matches) {
      finish();
      return;
    }
    zoom.dataset.closing = "";
    zoomAnimation = zoom.animate([from, zoomOrigin()], { duration: 220, easing: "ease-in", fill: "forwards" });
    zoomAnimation.onfinish = () => {
      finish();
      zoomAnimation.cancel();
    };
  }

  function followLegacyHash() {
    const year = legacyYears.get(location.hash);
    if (year && pairs.length) goToYear(year);
  }

  function showStatus(text = "", onRetry = null) {
    status.hidden = !text;
    message.textContent = text;
    retry.hidden = !onRetry;
    retry.onclick = onRetry;
  }

  function activateTimeline(mode, selectedYear) {
    const swapping = selectedYear != null && !reducedMotion.matches;
    const cards = [$("#history-anime"), $("#history-movie")];
    const previousPositions = swapping ? cards.map(card => card.getBoundingClientRect()) : [];
    cards.forEach(card => card.getAnimations().forEach(animation => animation.cancel()));
    const timeline = timelines.get(mode);
    pairs = timeline.pairs;
    activePerspective = mode;
    activeIndex = -1;
    const moviePerspective = mode === "movie";
    pairPanel.dataset.perspective = mode;
    const first = pairs[0].year;
    const last = pairs.at(-1).year;
    const matchYears = pairs.flatMap(({ matches }) => matches.map(({ work }) => work.year));
    const movieStart = moviePerspective ? first : Math.min(...matchYears);
    const movieEnd = moviePerspective ? last : Math.max(...matchYears);
    const animeEnd = moviePerspective ? Math.max(...matchYears) : last;
    chartStart = Math.min(animeStart, movieStart);
    chartEnd = Math.max(animeEnd, movieEnd);
    drawAxis("anime", !moviePerspective, animeStart, animeEnd);
    drawAxis("movie", moviePerspective, movieStart, movieEnd);

    yearPicker.replaceChildren(...pairs.map(({ year }) => new Option(year, year)));
    $("#history-range").textContent = `${first}–${last}`;
    $("#year-label").textContent = moviePerspective ? "Movie release year" : "Anime release year";
    $("#history-intro").textContent = moviePerspective
      ? "Scroll inside the timeline to explore each year’s most popular live-action movie and its closest anime matches."
      : "Scroll inside the timeline to explore each year’s most popular anime and its closest live-action movie matches.";
    const count = number.format(timeline.matchCount);
    $("#history-method").textContent = moviePerspective
      ? `Top movies use TMDB popularity. Anime matches use cosine similarity across ${count} AniList titles.`
      : `Popularity uses AniList list counts. Movie matches use cosine similarity across ${count} live-action TMDB titles.`;
    $("#history-travel").style.height = `${(pairs.length - 1) * yearTravel}px`;
    for (const id of ["history-controls", "history-journey", "history-pair", "history-method", "history-match-span"]) $(`#${id}`).hidden = false;
    showStatus();

    if (selectedYear == null) {
      syncScroll();
      followLegacyHash();
    } else {
      goToYear(selectedYear, "swap");
    }
    if (swapping) {
      cards.forEach((card, index) => {
        const position = card.getBoundingClientRect();
        const x = previousPositions[index].left - position.left;
        const y = previousPositions[index].top - position.top;
        card.animate([
          { transform: `translate(${x}px, ${y}px)`, opacity: .9 },
          { transform: `translate(${x * .5}px, ${y * .5 + (index ? 16 : -16)}px) scale(.88)`, opacity: .55, offset: .5 },
          { transform: "translate(0, 0)", opacity: 1 }
        ], slideTiming);
      });
    }
  }

  function setPerspectiveControls(mode) {
    perspective.querySelector(`[value="${mode}"]`).checked = true;
    matchSpan.setDirection(mode);
  }

  async function changePerspective(input, notify = showStatus) {
    const request = ++perspectiveRequest;
    const mode = input.value;
    setPerspectiveControls(mode);
    showStatus();
    matchSpan.showStatus();
    if (!timelines.has(mode)) {
      notify("Loading Movie Timeline…");
      try {
        await loadMovieTimeline();
      } catch (error) {
        if (request !== perspectiveRequest) return;
        setPerspectiveControls(activePerspective);
        notify("Movie Timeline could not be loaded. Try again.", () => {
          input.focus({ preventScroll: true });
          changePerspective(input, notify);
        });
        console.warn("Movie Timeline data unavailable", error);
        return;
      }
    }
    if (request !== perspectiveRequest) return;
    notify();
    if (mode !== activePerspective) activateTimeline(mode, pairs[activeIndex].year);
  }

  async function load() {
    showStatus("Loading annual anime and movie matches…");
    try {
      // Use the published archive so its annual winners match the offline score export.
      const [archive, bundle] = await Promise.all([
        AnivizAPI.fetchJSON(new URL("story.json", project), { timeout: 15000 }),
        AnivizAPI.fetchJSON(new URL("data/history_movie_matches.json", project), { timeout: 15000 })
      ]);
      timelines.set("anime", { pairs: StoryData.yearPairs(StoryData.validate(archive), bundle), matchCount: bundle.meta.movie_count });
      liveActionMovieIds = bundle.live_action_movie_ids;
      activateTimeline("anime");
    } catch (error) {
      showStatus("The annual archive could not be loaded. Try again to open the timelines.", load);
      console.warn("History data unavailable", error);
    }
  }

  async function loadMovieArtwork() {
    try {
      const details = await AnivizAPI.fetchJSON(new URL("data/movie_details.json", project), { timeout: 15000 });
      if (details?.schema_version !== 1 || details.source !== "TMDB" || !details.movies) {
        throw new Error("Invalid TMDB movie artwork");
      }
      for (const [id, work] of Object.entries(details.movies)) {
        movieCovers.set(id, AnivizArtwork.movieThumbnail(work));
      }
      updateMovie.refreshArtwork();
    } catch (error) {
      console.warn("Movie posters unavailable", error);
    }
  }

  journey.addEventListener("scroll", queueSync, { passive: true });
  journey.addEventListener("keydown", event => {
    if (event.target !== journey || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = { ArrowUp: activeIndex - 1, ArrowDown: activeIndex + 1, Home: 0, End: pairs.length - 1 }[event.key];
    if (!Number.isInteger(target)) return;
    event.preventDefault();
    goTo(target);
  });
  window.addEventListener("resize", queueSync);
  window.addEventListener("pageshow", queueSync);
  window.addEventListener("hashchange", followLegacyHash);
  pairPanel.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    hoveredRank = event.target.closest("[data-match-rank]")?.dataset.matchRank;
    highlightMatch();
  });
  pairPanel.addEventListener("pointerout", event => {
    if (event.pointerType === "touch") return;
    hoveredRank = pairPanel.contains(event.relatedTarget)
      ? event.relatedTarget.closest?.("[data-match-rank]")?.dataset.matchRank : undefined;
    highlightMatch();
  });
  pairPanel.addEventListener("focusin", event => {
    focusedRank = event.target.matches(":focus-visible") ? event.target.dataset.matchRank : undefined;
    highlightMatch();
  });
  pairPanel.addEventListener("focusout", () => {
    focusedRank = undefined;
    highlightMatch();
  });
  dialog.addEventListener("close", () => {
    if (synopsisScroll == null) return;
    synopsisScroll.card.scrollTop = synopsisScroll.top;
    synopsisScroll = null;
    goTo(activeIndex);
  });
  for (const [track, axis] of [["anime", animeAxis], ["movie", movieAxis]]) {
    axis.addEventListener("click", () => openZoom(track, axis));
    axis.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!event.repeat) openZoom(track, axis);
    });
  }
  let pressedBackdrop = false;
  zoom.addEventListener("pointerdown", event => { pressedBackdrop = event.target === zoom; });
  zoom.addEventListener("click", event => {
    if (pressedBackdrop && event.target === zoom) closeZoom();
  });
  zoom.addEventListener("cancel", event => {
    event.preventDefault();
    closeZoom();
  });
  $("#close-history-zoom").addEventListener("click", closeZoom);
  perspective.addEventListener("change", event => changePerspective(event.target));
  yearPicker.addEventListener("change", () => goTo(yearPicker.selectedIndex));
  matchCount.addEventListener("change", () => {
    if (activeIndex >= 0) render(activeIndex, "count");
  });
  previous.addEventListener("click", () => goTo(activeIndex - 1));
  next.addEventListener("click", () => goTo(activeIndex + 1));
  const matchSpan = HistoryMatchSpan.mount($("#history-match-span"), {
    onYearChange: goToYear,
    onDirectionChange: input => changePerspective(input, matchSpan.showStatus)
  });
  setPerspectiveControls("anime");
  loadMovieArtwork();
  load();
})();
