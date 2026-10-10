"use strict";

(() => {
  const projectUrl = new URL("../../", document.currentScript.src);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = matchMedia("(max-width: 760px)");
  const $ = selector => document.querySelector(selector);
  const steps = [...document.querySelectorAll(".story-step")];
  const periods = steps.map(step => ({
    id: step.id, start: Number(step.dataset.start),
    end: step.dataset.end === "present" ? new Date().getFullYear() : Number(step.dataset.end),
    present: step.dataset.end === "present",
    theme: step.dataset.theme, color: step.dataset.color
  }));
  const store = { data: null, index: 0, year: 1963, metric: "genres", summaries: [], frame: 0 };
  const format = new Intl.NumberFormat("en-US");
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const color = d3.scaleOrdinal(d3.schemeTableau10);
  const duration = () => motion.matches ? 0 : 420;
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const humanize = value => String(value || "Unknown").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const imageUrl = work => safeURL(work.cover?.large || work.cover?.medium || work.cover?.extra_large);
  function safeURL(value) {
    try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; }
    catch { return ""; }
  }

  function status(text, mode) {
    $("#data-status").textContent = text;
    $("#status-dot").className = `status-dot ${mode}`;
  }

  async function loadData() {
    $("#retry-data").hidden = true;
    $("#story-load").hidden = false;
    $("#story-load span").textContent = "Opening the archive… You can start reading while the data loads.";
    status("Loading annual AniList rankings…", "loading");
    let payload;
    let source;
    try {
      try {
        payload = StoryData.validate(await AnivizAPI.fetchJSON(new URL("api/story", projectUrl)));
        source = "Backend cache";
      } catch (error) {
        payload = StoryData.validate(await AnivizAPI.fetchJSON(new URL("story.json", projectUrl), { timeout: 15000 }));
        source = "Published snapshot";
      }
      store.data = payload;
      periods.forEach(period => {
        if (period.present) period.end = Math.max(period.start, payload.meta.end_year);
      });
      store.summaries = periods.map(period => StoryData.summarizePeriod(payload, period));
      const picker = $("#year-picker");
      picker.innerHTML = d3.range(1963, payload.meta.end_year + 1)
        .map(year => `<option value="${year}">${year}</option>`).join("");
      picker.disabled = false;
      color.domain([...new Set(payload.years.flatMap(row => row.anime.flatMap(work => work.genres || [])))].sort());
      document.querySelectorAll("[data-present-year]").forEach(element => {
        element.textContent = payload.meta.end_year;
      });
      const date = payload.meta.generated_at ? new Date(payload.meta.generated_at).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric"
      }) : "Unknown date";
      status(`${format.format(payload.meta.sample_size)} titles · ${payload.years.length} years`, payload.meta.complete ? "success" : "loading");
      $("#footer-generated").textContent = `Retrieved ${date}`;
      $("#footer-cache").textContent = source;
      $("#snapshot-description").textContent = `${source}. Retrieved ${date}. First-release years ${payload.meta.start_year}–${payload.meta.end_year}. ${payload.meta.end_year} is provisional. ${payload.meta.warning || ""}`;
      const archiveBehind = payload.meta.end_year < new Date().getFullYear();
      const warning = payload.meta.warning || (archiveBehind ? `This snapshot ends in ${payload.meta.end_year}; newer years are not yet available.` : "");
      $("#story-load span").textContent = warning || `${source} · retrieved ${date} · current-year rankings are provisional.`;
      buildTimeline();
      buildHero();
      syncScroll(true);
    } catch (error) {
      status("Archive temporarily unavailable", "error");
      $("#story-load span").textContent = "The annual archive could not be loaded. The historical story is still available. Try again to load its visualizations.";
      $("#retry-data").hidden = false;
      renderUnavailable("The annual archive is unavailable.");
    }
  }

  function buildHero() {
    const targetYears = [1963, 1988, 1995, 2001, 2013, 2020];
    const works = targetYears.map(year => store.data.years.find(row => row.year === year)?.anime[0]).filter(Boolean);
    d3.select("#hero-covers").selectAll("img").data(works, work => work.id).join("img")
      .attr("src", imageUrl).attr("alt", "").attr("loading", "lazy")
      .on("error", function() { this.hidden = true; });
  }

  function buildTimeline() {
    const svg = d3.select("#story-timeline").selectAll("svg").data([null]).join("svg")
      .attr("viewBox", "0 0 600 60").attr("role", "img")
      .attr("aria-label", "Annual sample coverage from 1963 onward; each bar shows up to ten selected titles");
    svg.selectAll("title").data([null]).join("title").text("Annual Top 10 sample coverage, not anime industry output");
    const years = d3.range(1963, store.data.meta.end_year + 1);
    const x = d3.scaleBand().domain(years).range([2, 598]).padding(.25);
    const rows = new Map(store.data.years.map(row => [row.year, row]));
    svg.selectAll("rect.year-bar").data(years, year => year).join("rect")
      .attr("class", "year-bar").attr("x", year => x(year)).attr("width", x.bandwidth())
      .attr("y", year => 37 - Math.max(2, (rows.get(year)?.anime.length || 0) * 2.6))
      .attr("height", year => Math.max(2, (rows.get(year)?.anime.length || 0) * 2.6))
      .attr("rx", 1).attr("fill", "#303a56")
      .append("title").text(year => `${year}: ${rows.has(year) && rows.get(year).status !== "unavailable" ? `${rows.get(year).anime.length} selected titles` : "data unavailable"}`);
    svg.selectAll("text.timeline-edge").data([1963, store.data.meta.end_year]).join("text")
      .attr("class", "timeline-edge").attr("x", (year, i) => i ? 598 : 2).attr("y", 56)
      .attr("text-anchor", (year, i) => i ? "end" : "start").attr("fill", "#79839f")
      .attr("font-size", 10).text(year => year);
    svg.selectAll("line.year-cursor").data([null]).join("line")
      .attr("class", "year-cursor").attr("y1", 4).attr("y2", 43).attr("stroke-width", 2);
    // Keep the timeline's scale so scroll updates only positions and colors.
    store.timelineX = x;
  }

  function updateTimeline() {
    if (!store.data) return;
    const period = periods[store.index];
    const svg = d3.select("#story-timeline svg");
    svg.selectAll("rect.year-bar").interrupt().transition().duration(duration())
      .attr("fill", year => year >= period.start && year <= period.end ? period.color : "#303a56")
      .attr("opacity", year => year <= store.year ? 1 : .4);
    svg.select("line.year-cursor").interrupt().transition().duration(motion.matches ? 0 : 180)
      .attr("x1", store.timelineX(store.year) + store.timelineX.bandwidth() / 2)
      .attr("x2", store.timelineX(store.year) + store.timelineX.bandwidth() / 2)
      .attr("stroke", period.color);
  }

  function renderPosters() {
    const row = store.data?.years.find(row => row.year === store.year);
    const works = row?.status !== "unavailable" ? (row?.anime || []) : [];
    $("#showcase-year").textContent = store.year;
    $("#year-picker").value = store.year;
    $("#year-count").textContent = `${works.length} titles${row?.provisional ? " · provisional" : ""}${row?.status === "stale" ? " · cached" : ""}`;
    const shelf = d3.select("#poster-shelf");
    shelf.selectAll(".archive-empty").remove();
    const cards = shelf.selectAll("button.poster-card:not([data-exiting])").data(works, work => work.id);
    // Fade outgoing posters in place without keeping them in the tab order or
    // pushing the new year's posters to the end of the horizontal shelf.
    cards.exit().each(function() {
      const width = this.getBoundingClientRect().width;
      const left = this.offsetLeft;
      this.style.width = `${width}px`;
      this.style.left = `${left}px`;
    }).attr("data-exiting", "true").attr("aria-hidden", "true")
      .attr("tabindex", -1).property("disabled", true)
      .style("position", "absolute").style("pointer-events", "none")
      .interrupt().transition().duration(duration() / 2).style("opacity", 0).remove();
    const added = cards.enter().append("button").attr("type", "button").attr("class", "poster-card")
      .style("opacity", 0).style("transform", "translateY(8px)");
    added.html(work => `<span class="poster-art">${imageUrl(work) ? `<img src="${escapeHTML(imageUrl(work))}" alt="" loading="lazy">` : ""}<span class="art-missing">Cover unavailable</span><span class="poster-rank"></span></span><strong></strong><small></small>`);
    added.selectAll("img").on("error", function() { this.hidden = true; });
    const merged = added.merge(cards).order();
    merged.attr("aria-label", (work, i) => `Rank ${i + 1}: ${work.title}, ${store.year}. Open details.`)
      .on("mouseenter focus", (event, work) => showTooltip(event, work))
      .on("mouseleave blur", hideTooltip)
      .on("click", (event, work) => { hideTooltip(); openDetail(work); });
    merged.select(".poster-rank").text((work, i) => `#${i + 1}`);
    merged.select("strong").text(work => work.title);
    merged.select("small").text(work => `${humanize(work.format)} · ${compact.format(work.popularity || 0)} users`);
    added.interrupt().transition().duration(duration()).style("opacity", 1).style("transform", "translateY(0px)");
    $("#poster-shelf").scrollLeft = 0;
    if (!works.length) {
      shelf.append("p").attr("class", "archive-empty").text(!row || row.status === "unavailable"
        ? `Annual data for ${store.year} is unavailable.`
        : `AniList returned no eligible titles for ${store.year}.`);
    }
  }

  function renderRanking() {
    const summary = store.summaries[store.index];
    const isGenre = store.metric === "genres";
    $("#ranking-title").textContent = `${isGenre ? "Genres" : "Studios"} in this period`;
    $("#ranking-caption").textContent = isGenre
      ? `Share of ${summary?.anime.length || 0} selected titles. Multiple genres per title; shares can overlap.`
      : `Share of ${summary?.anime.length || 0} selected titles. Co-productions can overlap; unknown main-studio credits excluded.`;
    const data = summary?.[store.metric].slice(0, mobile.matches ? 4 : 6) || [];
    const container = d3.select("#story-ranking");
    container.selectAll(".archive-empty").remove();
    const height = mobile.matches ? 150 : 210;
    const svg = container.selectAll("svg").data([null]).join("svg")
      .attr("viewBox", `0 0 600 ${height}`).attr("role", "img")
      .attr("aria-label", `${isGenre ? "Genre" : "Studio"} shares of selected titles in ${periods[store.index].start} to ${periods[store.index].end}`);
    svg.selectAll("title").data([null]).join("title").text(`${$("#ranking-title").textContent}: ${data.map(row => `${row.name} ${row.percent.toFixed(1)}%`).join(", ")}`);
    const x = d3.scaleLinear().domain([0, 100]).range([180, 548]);
    const y = d3.scaleBand().domain(data.map(row => row.name)).range([8, height - 8]).padding(.3);
    const groups = svg.selectAll("g.rank-row").data(data, row => `${store.metric}:${row.name}`);
    groups.exit().interrupt().transition().duration(duration() / 2).style("opacity", 0).remove();
    const added = groups.enter().append("g").attr("class", "rank-row").style("opacity", 0)
      .attr("transform", `translate(0,${height})`);
    added.append("rect").attr("class", "rank-track").attr("x", 180).attr("width", 368).attr("fill", "#1b243c").attr("rx", 3);
    added.append("rect").attr("class", "rank-bar").attr("x", 180).attr("width", 0).attr("rx", 3);
    added.append("text").attr("class", "rank-name").attr("x", 0).attr("fill", "#bbc3db").attr("font-size", 12);
    added.append("text").attr("class", "rank-value").attr("x", 600).attr("text-anchor", "end").attr("fill", "#bbc3db").attr("font-size", 12);
    const merged = added.merge(groups);
    merged.interrupt().transition().duration(duration()).style("opacity", 1)
      .attr("transform", row => `translate(0,${y(row.name)})`);
    merged.select(".rank-name").attr("y", y.bandwidth() / 2 + 4)
      .text(row => row.name.length > 23 ? row.name.slice(0, 22) + "…" : row.name);
    merged.select(".rank-value").attr("y", y.bandwidth() / 2 + 4).text(row => `${row.percent.toFixed(0)}%`);
    merged.select(".rank-track").attr("height", y.bandwidth());
    merged.select(".rank-bar").interrupt().transition().duration(duration())
      .attr("height", y.bandwidth()).attr("width", row => x(row.percent) - 180)
      .attr("fill", row => isGenre ? color(row.name) : periods[store.index].color);
    merged.selectAll("title").data(row => [row]).join("title")
      .text(row => `${row.name}: ${row.count} of ${summary.anime.length} selected titles (${row.percent.toFixed(1)}%)`);
    if (!data.length) {
      container.append("p").attr("class", "archive-empty").text(`No ${isGenre ? "genre" : "main-studio"} metadata is available for this period’s selected titles.`);
      svg.style("display", "none");
    } else { svg.style("display", null); }
    const info = `${summary?.anime.length || 0} titles · ${summary?.availableYears || 0} first-release years`;
    const gaps = summary?.missing.length ? ` · ${summary.missing.length} years unavailable` : "";
    const stale = summary?.stale.length ? ` · ${summary.stale.length} cached years not refreshed` : "";
    $("#period-sample").textContent = info + gaps + stale;
  }

  function renderUnavailable(message) {
    for (const selector of ["#poster-shelf", "#story-ranking"]) {
      $(selector).innerHTML = `<p class="archive-empty">${escapeHTML(message)}</p>`;
    }
  }

  function syncScroll(force = false) {
    store.frame = 0;
    const panel = $("#visual-stage");
    const rail = $(".rail");
    document.body.style.setProperty("--story-sticky-top", `${rail.getBoundingClientRect().height + 10}px`);
    document.body.style.setProperty("--story-scroll-offset", `${panel.offsetHeight + rail.getBoundingClientRect().height + 24}px`);
    // On narrow screens the archive sits above the reading area. Keep the
    // activation line below it, so reverse scrolling selects the same chapter.
    const probe = mobile.matches
      ? Math.min(innerHeight - 40, Math.max(innerHeight * .5, panel.getBoundingClientRect().bottom + 30))
      : innerHeight * .5;
    const located = StoryData.locatePeriod(steps.map((step, i) => ({
      ...periods[i], top: step.getBoundingClientRect().top, height: step.getBoundingClientRect().height
    })), probe, mobile.matches ? probe : 65);
    const changed = located.index !== store.index;
    const yearChanged = located.year !== store.year;
    store.index = located.index;
    store.year = located.year;
    const period = periods[store.index];
    document.body.style.setProperty("--era-color", period.color);
    $("#active-theme").textContent = period.theme;
    $("#active-period").textContent = `${period.start}–${period.end}`;
    $("#active-year").textContent = store.year;
    $("#chapter-progress").style.width = `${100 * located.progress}%`;
    $("#act-indicator").textContent = `ACT ${String(store.index).padStart(2, "0")} / ${String(periods.length - 1).padStart(2, "0")}`;
    steps.forEach((step, i) => {
      step.classList.toggle("is-active", i === store.index);
      step.style.setProperty("--era-color", periods[i].color);
    });
    document.querySelectorAll(".era-nav a").forEach(link => {
      if (link.hash === `#${period.id}`) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
    if (force || changed || yearChanged) {
      hideTooltip();
      updateTimeline();
      if (store.data) renderPosters();
    }
    if ((force || changed) && store.data) renderRanking();
  }

  function requestSync() {
    if (!store.frame) store.frame = requestAnimationFrame(() => syncScroll());
  }

  function showTooltip(event, work) {
    const tooltip = $("#story-tooltip");
    tooltip.innerHTML = `<strong>${escapeHTML(work.title)}</strong><span>${work.year} · ${escapeHTML(humanize(work.format))}<br>${format.format(work.popularity || 0)} current AniList list users<br>Score: ${Number.isFinite(work.average_score) ? work.average_score + "/100" : "unavailable"}<br>${escapeHTML((work.studio_names || ["Unknown studio"]).join(", "))}</span>`;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    const box = event.currentTarget.getBoundingClientRect();
    const rect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, box.left))}px`;
    tooltip.style.top = `${Math.max(8, box.top - rect.height - 10)}px`;
  }

  function hideTooltip() {
    $("#story-tooltip").classList.remove("visible");
    $("#story-tooltip").setAttribute("aria-hidden", "true");
  }

  function openDetail(work) {
    const url = safeURL(work.site_url);
    $("#dialog-content").innerHTML = `<div class="dialog-head">${imageUrl(work) ? `<img src="${escapeHTML(imageUrl(work))}" alt="Cover for ${escapeHTML(work.title)}">` : `<div class="archive-empty">Cover unavailable</div>`}<div><p class="chart-kicker">From the annual Top 10</p><h2 id="dialog-title">${escapeHTML(work.title)}</h2><p>${escapeHTML(work.titles?.romaji || "")}<br>${work.year} · ${escapeHTML(humanize(work.format))}</p><p>${escapeHTML((work.genres || []).join(" · ") || "Genres unavailable")}</p></div></div><div class="detail-stats"><div class="detail-stat"><span>Current list users</span><strong>${format.format(work.popularity || 0)}</strong></div><div class="detail-stat"><span>Average score</span><strong>${Number.isFinite(work.average_score) ? work.average_score + "/100" : "Unknown"}</strong></div></div><p class="dialog-description">${escapeHTML(work.description || "No synopsis is available for this title.")}</p><p class="dialog-description"><strong>Main studio:</strong> ${escapeHTML((work.studio_names || ["Unknown studio"]).join(", "))}</p><p class="dialog-caveat">These are current AniList metrics. They do not measure the audience or reception at the time of release.</p>${url ? `<a class="button button-primary" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">View on AniList ↗</a>` : ""}`;
    $("#dialog-content img")?.addEventListener("error", event => { event.currentTarget.hidden = true; });
    $("#anime-dialog").showModal();
  }

  document.querySelectorAll("[data-metric]").forEach(button => {
    button.addEventListener("click", () => {
      store.metric = button.dataset.metric;
      document.querySelectorAll("[data-metric]").forEach(item => item.setAttribute("aria-pressed", item === button));
      if (store.data) renderRanking();
    });
  });
  $("#close-dialog").addEventListener("click", () => $("#anime-dialog").close());
  $("#anime-dialog").addEventListener("click", event => {
    if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }
  });
  $("#retry-data").addEventListener("click", loadData);
  $("#year-picker").addEventListener("change", event => {
    const year = Number(event.target.value);
    const index = periods.findIndex(period => year >= period.start && year <= period.end);
    if (index < 0) return;
    const period = periods[index];
    const section = steps[index];
    const probe = mobile.matches
      ? Math.min(innerHeight - 40, $("#visual-stage").getBoundingClientRect().bottom + 30)
      : 65;
    const progress = (year - period.start + .25) / (period.end - period.start + 1);
    window.scrollTo({
      top: scrollY + section.getBoundingClientRect().top - probe + progress * section.offsetHeight,
      behavior: motion.matches ? "instant" : "smooth"
    });
  });
  window.addEventListener("scroll", requestSync, { passive: true });
  window.addEventListener("resize", () => { hideTooltip(); syncScroll(true); });
  motion.addEventListener("change", () => syncScroll(true));
  syncScroll();
  loadData();
})();
