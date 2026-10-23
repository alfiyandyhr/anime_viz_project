"use strict";

const StoryConnections = (() => {
  const snapshotURL = new URL("../../data/story_movie_recommendations.json", document.currentScript.src);
  const blocks = [];
  let generation = 0;
  const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function wrap(text, columns) {
    const words = text.split(/\s+/), lines = [""];
    for (const word of words) {
      const i = lines.length - 1;
      if (lines[i] && lines[i].length + word.length + 1 > columns) lines.push(word);
      else lines[i] += (lines[i] ? " " : "") + word;
    }
    if (lines.length > 2) lines.splice(1, lines.length - 1, lines[1].slice(0, columns - 1) + "…");
    return lines.map(line => line.length > columns ? line.slice(0, columns - 1) + "…" : line);
  }

  function drawMap(card, anime, movieById, onMovie) {
    const target = card.querySelector(".period-connection-map");
    const width = Math.max(200, Math.floor(target.clientWidth));
    if (card.dataset.mapWidth === String(width)) return;
    card.dataset.mapWidth = width;
    const height = 174, center = 92, end = 64;
    const svg = d3.select(target).selectAll("svg").data([null]).join("svg")
      .attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%")
      .attr("height", height).attr("role", "group")
      .attr("aria-label", `Top 3 movies by story similarity to ${anime.title}`);
    svg.selectAll("*").remove();
    svg.append("text").attr("class", "period-map-axis").attr("x", 0).attr("y", 14).text("ANIME");
    svg.append("text").attr("class", "period-map-axis").attr("x", end + 10).attr("y", 14).text("TOP 3 MOVIES");
    svg.append("rect").attr("class", "period-map-source").attr("x", 0).attr("y", center - 24)
      .attr("width", 38).attr("height", 48).attr("rx", 9);
    svg.append("text").attr("class", "period-map-rank").attr("x", 19).attr("y", center + 4)
      .attr("text-anchor", "middle").text(`#${anime.rank}`);
    const y = i => 42 + i * 50;
    const rows = svg.selectAll("g").data(anime.matches).join("g")
      .attr("class", "period-movie-row").attr("role", "button").attr("tabindex", 0)
      .attr("aria-haspopup", "dialog").attr("aria-label", (match, i) =>
        `${i + 1}. ${movieById.get(match.movie_id).title}, cosine similarity ${match.score.toFixed(3)}. Open movie details.`)
      .on("click", (event, match) => onMovie(movieById.get(match.movie_id), anime, match))
      .on("keydown", (event, match) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          onMovie(movieById.get(match.movie_id), anime, match);
        }
      });
    rows.append("title").text(match => `${movieById.get(match.movie_id).title} · cosine ${match.score.toFixed(3)}`);
    rows.append("path").attr("class", "period-map-line")
      .attr("d", (match, i) => `M38,${center} C52,${center} 48,${y(i)} ${end},${y(i)}`)
      .attr("stroke-width", match => 1 + 7 * Math.max(0, match.score));
    rows.append("rect").attr("class", "period-map-target").attr("x", end - 4)
      .attr("y", (match, i) => y(i) - 18).attr("width", width - end + 2).attr("height", 46).attr("rx", 8);
    rows.append("circle").attr("class", "period-map-dot").attr("cx", end).attr("cy", (match, i) => y(i)).attr("r", 3);
    rows.each(function(match, i) {
      const movie = movieById.get(match.movie_id);
      const text = d3.select(this).append("text").attr("class", "period-map-title").attr("x", end + 11).attr("y", y(i) - 6);
      for (const [line, title] of wrap(movie.title, Math.max(12, Math.floor((width - end - 25) / 6.3))).entries()) {
        text.append("tspan").attr("x", end + 11).attr("dy", line ? 14 : 0).text(title);
      }
      d3.select(this).append("text").attr("class", "period-map-score")
        .attr("x", end + 11).attr("y", y(i) + 22)
        .text(`${movie.year || "Year unknown"} · cosine ${match.score.toFixed(3)}`);
    });
  }

  function layout() {
    for (const block of blocks) {
      const { section, root, cards, movieById, onMovie } = block;
      // The original reading prompt remains the final in-flow narrative element.
      const sectionRect = section.getBoundingClientRect();
      const prompt = section.querySelector(".reading-prompt").getBoundingClientRect();
      const top = prompt.bottom - sectionRect.top + 44;
      const available = sectionRect.height - top - 80;
      root.style.top = `${top}px`;
      root.hidden = false;
      cards.forEach(({ element, anime }) => {
        element.hidden = false;
        drawMap(element, anime, movieById, onMovie);
      });
      const headingHeight = root.querySelector(".period-connection-cards").getBoundingClientRect().top
        - root.getBoundingClientRect().top;
      const count = StoryMovies.fitCount(available, headingHeight,
        cards.map(card => card.element.getBoundingClientRect().height));
      cards.forEach((card, i) => { card.element.hidden = i >= count; });
      root.hidden = count === 0;
      root.dataset.visibleCount = count;
    }
  }

  async function load({ archive, periods, openAnime, openMovie }) {
    const currentGeneration = ++generation;
    let data;
    try {
      data = StoryMovies.validate(await AnivizAPI.fetchJSON(snapshotURL, { timeout: 15000 }));
    } catch (error) {
      // A missing optional snapshot must not interfere with the historical story.
      console.warn("Story movie recommendations unavailable:", error.message);
      return;
    }
    if (generation !== currentGeneration) return;
    blocks.forEach(block => block.root.remove());
    blocks.length = 0;
    const movieById = new Map(data.movies.map(movie => [movie.id, movie]));
    for (const period of periods) {
      const snapshot = data.periods.find(row => row.id === period.id && row.start === period.start && row.end === period.end);
      if (!snapshot) continue;
      const current = StoryData.topAnime(archive, period);
      const selected = current.map((work, i) => {
        const matches = snapshot.anime.find(anime => anime.id === work.id)?.matches;
        return matches ? { ...work, rank: i + 1, matches } : null;
      });
      // Keep the actual popularity order; do not skip an uncomputed top title.
      const firstMissing = selected.indexOf(null);
      const eligible = selected.slice(0, firstMissing < 0 ? selected.length : firstMissing);
      if (!eligible.length) continue;
      const section = document.getElementById(period.id);
      const root = document.createElement("aside");
      root.className = "period-discovery";
      root.setAttribute("aria-labelledby", `${period.id}-movie-title`);
      root.innerHTML = `<div class="period-discovery-heading"><p class="period-detour-label">A STORY DETOUR · ${period.start}–${period.end}</p><h3 id="${period.id}-movie-title">Top anime of decade → movie</h3><p>Follow this period’s most-followed anime to their three closest movie stories.</p><small>Current popularity in the annual Top 10 sample · cosine similarity, not historical influence.</small></div><div class="period-connection-cards"></div>`;
      const list = root.querySelector(".period-connection-cards");
      const cards = eligible.map(anime => {
        const element = document.createElement("article");
        element.className = "period-connection-card";
        element.dataset.animeId = anime.id;
        element.innerHTML = `<button type="button" class="period-anime-open" aria-haspopup="dialog"><span class="period-anime-rank">#${anime.rank}</span><span><strong>${escape(anime.title)}</strong><small>${anime.year} · ${new Intl.NumberFormat("en-US", {notation:"compact", maximumFractionDigits:1}).format(anime.popularity || 0)} current list users</small></span><span aria-hidden="true">↗</span></button><div class="period-connection-map"></div>`;
        element.querySelector("button").addEventListener("click", () => openAnime(anime));
        list.append(element);
        return { element, anime };
      });
      section.append(root);
      blocks.push({ section, root, cards, movieById, onMovie: openMovie });
    }
    layout();
    document.fonts?.ready.then(layout);
  }

  return { load, layout };
})();
