"use strict";

Object.assign(elements, {
  genreMetric: document.querySelector("#genre-metric")
});

function renderGenreChart() {
  const container = document.querySelector("#genre-chart");

  if (!state.data) {
    return;
  }

  clearChart(container);

  const metric = elements.genreMetric.value;
  const data = computeGenreStats(state.filteredAnime)
    .filter((item) => (
      metric !== "score" || Number.isFinite(item.averageScore)
    ))
    .sort((a, b) => {
      if (metric === "score") {
        return d3.descending(a.averageScore, b.averageScore);
      }

      if (metric === "popularity") {
        return d3.descending(a.totalPopularity, b.totalPopularity);
      }

      return d3.descending(a.count, b.count);
    })
    .slice(0, 12);

  if (!data.length) {
    renderEmpty(container, "No genre data match the current filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 300);
  const height = Math.max(container.clientHeight, 370);
  const margin = { top: 12, right: 35, bottom: 35, left: 105 };

  const metricValue = (item) => {
    if (metric === "score") {
      return item.averageScore;
    }

    if (metric === "popularity") {
      return item.totalPopularity;
    }

    return item.count;
  };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data, metricValue) || 1])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(data.map((item) => item.genre))
    .range([margin.top, height - margin.bottom])
    .padding(0.23);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(4)
        .tickSize(-(height - margin.top - margin.bottom))
        .tickFormat("")
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(4)
        .tickFormat((value) => (
          metric === "popularity"
            ? compactFormatter.format(value)
            : value
        ))
    );

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).tickSize(0))
    .call((group) => group.select(".domain").remove());

  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", margin.left)
    .attr("y", (item) => y(item.genre))
    .attr("height", y.bandwidth())
    .attr("width", (item) => x(metricValue(item)) - margin.left)
    .attr("rx", 5)
    .attr("fill", (item) => state.genreColor(item.genre))
    .attr("fill-opacity", 0.8)
    .style("cursor", "pointer")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${escapeHTML(item.genre)}</strong>
        <span>
          Titles: ${item.count}<br>
          Average score:
          ${Number.isFinite(item.averageScore)
            ? item.averageScore.toFixed(1)
            : "N/A"}<br>
          Total popularity:
          ${formatNumber(item.totalPopularity)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip)
    .on("click", (_, item) => {
      elements.genreFilter.value = item.genre;
      applyFilters();
    });

  svg.append("g")
    .selectAll("text.value")
    .data(data)
    .join("text")
    .attr("class", "value")
    .attr("x", (item) => x(metricValue(item)) + 5)
    .attr("y", (item) => y(item.genre) + y.bandwidth() / 2 + 4)
    .attr("fill", "#d9def0")
    .attr("font-size", 10)
    .text((item) => {
      const value = metricValue(item);

      if (metric === "score") {
        return value.toFixed(1);
      }

      if (metric === "popularity") {
        return compactFormatter.format(value);
      }

      return value;
    });
}

function renderTimeline() {
  const container = document.querySelector("#timeline-chart");
  clearChart(container);

  const data = computeTimeline(state.filteredAnime);

  if (!data.length) {
    renderEmpty(container, "No release-year data match the filters.");
    return;
  }

  const width = Math.max(container.clientWidth, 480);
  const height = Math.max(container.clientHeight, 370);
  const margin = { top: 24, right: 60, bottom: 52, left: 58 };

  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height]);

  const x = d3.scaleBand()
    .domain(data.map((item) => item.year))
    .range([margin.left, width - margin.right])
    .padding(0.18);

  const yCount = d3.scaleLinear()
    .domain([0, d3.max(data, (item) => item.count) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const scoreExtent = d3.extent(
    data.filter((item) => Number.isFinite(item.averageScore)),
    (item) => item.averageScore
  );

  const yScore = d3.scaleLinear()
    .domain(
      scoreExtent[0] === undefined
        ? [0, 100]
        : [
          Math.max(0, scoreExtent[0] - 5),
          Math.min(100, scoreExtent[1] + 5)
        ]
    )
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(${margin.left},0)`)
    .call(
      d3.axisLeft(yCount)
        .ticks(5)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat("")
    );

  svg.append("g")
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (item) => x(item.year))
    .attr("y", (item) => yCount(item.count))
    .attr("width", x.bandwidth())
    .attr("height", (item) => (
      height - margin.bottom - yCount(item.count)
    ))
    .attr("rx", 3)
    .attr("fill", "rgba(157,123,255,0.42)")
    .on("mouseenter", (event, item) => {
      showTooltip(event, `
        <strong>${item.year}</strong>
        <span>
          Sampled titles: ${item.count}<br>
          Average score:
          ${Number.isFinite(item.averageScore)
            ? item.averageScore.toFixed(1)
            : "N/A"}<br>
          Total popularity:
          ${formatNumber(item.totalPopularity)}
        </span>
      `);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", hideTooltip);

  const lineData = data.filter((item) => Number.isFinite(item.averageScore));

  svg.append("path")
    .datum(lineData)
    .attr("fill", "none")
    .attr("stroke", "#43d9e6")
    .attr("stroke-width", 2.5)
    .attr(
      "d",
      d3.line()
        .x((item) => x(item.year) + x.bandwidth() / 2)
        .y((item) => yScore(item.averageScore))
    );

  svg.append("g")
    .selectAll("circle")
    .data(lineData)
    .join("circle")
    .attr("cx", (item) => x(item.year) + x.bandwidth() / 2)
    .attr("cy", (item) => yScore(item.averageScore))
    .attr("r", 3.5)
    .attr("fill", "#43d9e6")
    .attr("stroke", "#08101c")
    .attr("stroke-width", 1.5);

  const tickStep = Math.max(1, Math.ceil(data.length / 12));
  const visibleYears = data
    .map((item) => item.year)
    .filter((_, index) => index % tickStep === 0);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(
      d3.axisBottom(x)
        .tickValues(visibleYears)
        .tickSizeOuter(0)
    )
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .attr("text-anchor", "end");

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(yCount).ticks(5));

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${width - margin.right},0)`)
    .call(d3.axisRight(yScore).ticks(5));

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", margin.left)
    .attr("y", 13)
    .text("Title count");

  svg.append("text")
    .attr("class", "axis-label")
    .attr("x", width - margin.right)
    .attr("y", 13)
    .attr("text-anchor", "end")
    .attr("fill", "#43d9e6")
    .text("Average score");
}

function computeTimeline(anime) {
  return d3.rollups(
    anime.filter((item) => Number.isFinite(item.year)),
    (rows) => {
      const scores = rows
        .map((item) => item.average_score)
        .filter(Number.isFinite);

      return {
        count: rows.length,
        averageScore: scores.length ? d3.mean(scores) : null,
        totalPopularity: d3.sum(rows, (item) => item.popularity || 0)
      };
    },
    (item) => item.year
  )
    .map(([year, values]) => ({ year, ...values }))
    .sort((a, b) => d3.ascending(a.year, b.year));
}

registerPage({
  bindControls() {
    elements.genreMetric.addEventListener("change", renderGenreChart);
  },
  render() {
    renderGenreChart();
    renderTimeline();
  }
});
