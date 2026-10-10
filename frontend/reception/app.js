"use strict";

function renderKPIs() {
  const anime = state.filteredAnime;

  const scores = anime
    .map((item) => item.average_score)
    .filter(Number.isFinite);

  const studios = new Set(
    anime.flatMap((item) => item.studio_names || [])
  );

  const actors = new Set(
    anime.flatMap((item) => (
      (item.voice_actors || []).map((actor) => actor.id)
    ))
  );

  document.querySelector("#kpi-count").textContent =
    numberFormatter.format(anime.length);

  document.querySelector("#kpi-score").textContent =
    scores.length ? d3.mean(scores).toFixed(1) : "N/A";

  document.querySelector("#kpi-popularity").textContent =
    compactFormatter.format(d3.sum(anime, (item) => item.popularity || 0));

  document.querySelector("#kpi-studios").textContent =
    numberFormatter.format(studios.size);

  document.querySelector("#kpi-actors").textContent =
    numberFormatter.format(actors.size);
}

function renderScatterplot() {
  const container = document.querySelector("#scatter-chart");
  const data = state.filteredAnime.filter((item) => (
    item.popularity > 0
    && Number.isFinite(item.average_score)
  ));

  clearChart(container);

  if (!data.length) {
    renderEmpty(container, "No scored anime match the current filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 430);
  const margin = { top: 28, right: 28, bottom: 58, left: 62 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("aria-label", "Score versus popularity scatterplot");

  const xExtent = d3.extent(data, (item) => item.popularity);
  const yExtent = d3.extent(data, (item) => item.average_score);

  const x = d3.scaleLog()
    .domain([
      Math.max(1, xExtent[0] * 0.75),
      xExtent[1] * 1.25
    ])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([
      Math.max(0, Math.floor((yExtent[0] - 5) / 5) * 5),
      Math.min(100, Math.ceil((yExtent[1] + 4) / 5) * 5)
    ])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const radius = d3.scaleSqrt()
    .domain([0, d3.max(data, (item) => item.favourites || 0) || 1])
    .range([4, 20]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(7)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(y)
        .ticks(6)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(7, "~s")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .text("Popularity — AniList users, logarithmic scale");

  svg.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + height - margin.bottom) / 2)
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .text("Average score / 100");

  const regression = linearRegression(
    data.map((item) => [
      Math.log10(item.popularity),
      item.average_score
    ])
  );

  if (regression) {
    const regressionPoints = x.domain().map((popularity) => ({
      popularity,
      score:
        regression.intercept
        + regression.slope * Math.log10(popularity)
    }));

    svg.append("path")
      .datum(regressionPoints)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.42)")
      .attr("stroke-dasharray", "5 5")
      .attr("stroke-width", 1.4)
      .attr(
        "d",
        d3.line()
          .x((item) => x(item.popularity))
          .y((item) => y(item.score))
      );
  }

  const dots = svg.append("g")
    .selectAll("circle")
    .data(data, (item) => item.id)
    .join("circle")
    .attr("cx", (item) => x(item.popularity))
    .attr("cy", (item) => y(item.average_score))
    .attr("r", (item) => radius(item.favourites || 0))
    .attr("fill", (item) => state.genreColor(item.primary_genre))
    .attr("fill-opacity", 0.72)
    .attr("stroke", "rgba(255,255,255,0.72)")
    .attr("stroke-width", 0.8)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, item) {
      d3.select(this)
        .attr("fill-opacity", 1)
        .attr("stroke-width", 2);

      showTooltip(event, `
        <strong>${escapeHTML(item.title)}</strong>
        <span>
          Score: ${item.average_score}/100<br>
          Popularity: ${formatNumber(item.popularity)}<br>
          Favourites: ${formatNumber(item.favourites)}<br>
          Genre: ${escapeHTML(item.primary_genre)}<br>
          Studio: ${escapeHTML(item.studio_names.join(", "))}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", function () {
      d3.select(this)
        .attr("fill-opacity", 0.72)
        .attr("stroke-width", 0.8);

      hideTooltip();
    })
    .on("click", (_, item) => openAnimeDetail(item));

  dots.append("title")
    .text((item) => item.title);

  renderGenreLegend(svg, data, width, height, margin);
}

function renderGenreLegend(svg, data, width, height, margin) {
  const genres = d3.rollups(
    data,
    (rows) => rows.length,
    (item) => item.primary_genre
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 5)
    .map((item) => item[0]);

  const legend = svg.append("g")
    .attr(
      "transform",
      `translate(${Math.max(margin.left, width - margin.right - 145)},`
      + `${height - 160})`
    );

  genres.forEach((genre, index) => {
    const row = legend.append("g")
      .attr("transform", `translate(0,${index * 19})`);

    row.append("circle")
      .attr("r", 5)
      .attr("fill", state.genreColor(genre));

    row.append("text")
      .attr("x", 10)
      .attr("y", 4)
      .attr("fill", "#aab3cf")
      .attr("font-size", 10)
      .text(truncate(genre, 18));
  });
}

// Chapter 1 verdict: answers "are the most popular also the highest rated?"
// by comparing the two title extremes and reporting the score–popularity
// correlation across the filtered sample.
function renderReceptionCallout() {
  const container = document.querySelector("#reception-callout");

  if (!container) {
    return;
  }

  const anime = state.filteredAnime;

  if (!anime.length) {
    container.innerHTML = `
      <article class="callout-card">
        <strong>No titles match the current filters.</strong>
        <p>Broaden the filters above to continue the story.</p>
      </article>
    `;
    return;
  }

  const mostPopular = d3.greatest(anime, (item) => item.popularity || 0);

  const scored = anime.filter((item) => Number.isFinite(item.average_score));
  const highestRated = d3.greatest(scored, (item) => item.average_score);

  const correlation = calculateCorrelation(
    anime
      .filter((item) => (
        item.popularity > 0
        && Number.isFinite(item.average_score)
      ))
      .map((item) => [
        Math.log10(item.popularity),
        item.average_score
      ])
  );

  const sameTitle = mostPopular
    && highestRated
    && mostPopular.id === highestRated.id;

  let verdict;
  if (correlation === null) {
    verdict = "Not enough scored titles to judge.";
  } else if (Math.abs(correlation) < 0.2) {
    verdict = "Barely — fame and quality track each other only weakly here.";
  } else if (correlation >= 0.2) {
    verdict = "Somewhat — more popular titles do tend to score higher.";
  } else {
    verdict = "Inversely — more popular titles tend to score a little lower.";
  }

  container.innerHTML = `
    <article class="callout-card accent">
      <span>Score–popularity correlation</span>
      <strong>${correlation === null ? "N/A" : `r = ${correlation.toFixed(2)}`}</strong>
      <p>${escapeHTML(verdict)}</p>
    </article>

    <article class="callout-card">
      <span>Most popular</span>
      <strong>${escapeHTML(mostPopular?.title || "N/A")}</strong>
      <p>${formatNumber(mostPopular?.popularity)} list users${
        mostPopular && Number.isFinite(mostPopular.average_score)
          ? ` · ${mostPopular.average_score}/100`
          : ""
      }</p>
    </article>

    <article class="callout-card">
      <span>Highest rated</span>
      <strong>${escapeHTML(highestRated?.title || "N/A")}</strong>
      <p>${
        highestRated
          ? `${highestRated.average_score}/100 · ${formatNumber(highestRated.popularity)} list users`
          : "No scored titles"
      }</p>
    </article>

    <article class="callout-card">
      <span>The verdict</span>
      <strong>${sameTitle ? "Same title tops both" : "Crowd favourite ≠ top rated"}</strong>
      <p>${
        sameTitle
          ? "The most-followed title is also the highest-scored under these filters."
          : "The most-watched anime and the best-scored anime are different titles."
      }</p>
    </article>
  `;
}

function linearRegression(points) {
  if (points.length < 2) {
    return null;
  }

  const meanX = d3.mean(points, (point) => point[0]);
  const meanY = d3.mean(points, (point) => point[1]);

  const numerator = d3.sum(
    points,
    (point) => (point[0] - meanX) * (point[1] - meanY)
  );

  const denominator = d3.sum(
    points,
    (point) => (point[0] - meanX) ** 2
  );

  if (!denominator) {
    return null;
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  return { slope, intercept };
}

registerPage({
  render() {
    renderKPIs();
    renderReceptionCallout();
    renderScatterplot();
  }
});
