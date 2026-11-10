"use strict";
// Instances own their container and latest snapshot. No page-global controls or selectors.
(function (root) {
  function create(kind, { container, d3, helpers, transforms = root.AnivizChartData }) {
    if (!container) throw new Error("A chart container is required");
    const { clearChart, renderEmpty, showTooltip, moveTooltip, hideTooltip, escapeHTML,
      formatNumber, truncate, compactFormatter } = helpers;
    let context, dataIdentity, selectionKey;
    const cached = new Map();
    function metricData(key, compute) {
      if (!cached.has(key)) cached.set(key, compute());
      return cached.get(key);
    }
    // Geometry can redraw on resize without recalculating analytical aggregates.
    const ChartData = {
      genres: (anime, selected) => metricData("genres", () => transforms.genres(anime, selected)).slice(),
      studios: (anime, selected) => metricData("studios", () => transforms.studios(anime, selected)).slice(),
      timeline: (anime, selected) => metricData("years", () => transforms.timeline(anime, selected))
    };
    function renderGenreChart() {
      clearChart(container);

      const metric = context.metric || "count";
      const data = ChartData.genres(context.anime, context.selectedIds)
        .filter((item) => (
          metric === "score" ? Number.isFinite(item.averageScore) : metric !== "popularity" || Number.isFinite(item.totalPopularity)
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
        .slice(0, context.countOnly ? Infinity : 12);

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
        .attr("stroke", item => item.selectedCount ? "white" : "none")
        .attr("stroke-width", 2)
        .attr("fill", "var(--purple)")
        .attr("fill-opacity", 0.8)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${escapeHTML(item.genre)}</strong>
            <span>
              Titles: ${item.count}${context.countOnly ? "" : `<br>
              Average score:
              ${Number.isFinite(item.averageScore)
                ? item.averageScore.toFixed(1)
                : "N/A"}<br>
              Total popularity:
              ${formatNumber(item.totalPopularity)}`}
            </span>
          `);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

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

      clearChart(container);

      const data = ChartData.timeline(context.anime, context.selectedIds);

      if (!data.length) {
        renderEmpty(container, "No release-year data match the filters.");
        return;
      }

      const width = Math.max(container.clientWidth, 480);
      const height = Math.max(container.clientHeight, 370);
      const margin = { top: 24, right: context.countOnly ? 20 : 60, bottom: 52, left: 58 };

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
        .attr("stroke", item => item.selectedCount ? "white" : "none")
        .attr("stroke-width", 2)
        .attr("fill", "rgba(157,123,255,0.42)")
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${item.year}</strong>
            <span>
              Sampled titles: ${item.count}${context.countOnly ? "" : `<br>
              Average score:
              ${Number.isFinite(item.averageScore)
                ? item.averageScore.toFixed(1)
                : "N/A"}<br>
              Total popularity:
              ${formatNumber(item.totalPopularity)}`}
            </span>
          `);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

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

      svg.append("text")
        .attr("class", "axis-label")
        .attr("x", margin.left)
        .attr("y", 13)
        .text("Title count");

      if (context.countOnly) return;

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

      svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(${width - margin.right},0)`)
        .call(d3.axisRight(yScore).ticks(5));

      svg.append("text")
        .attr("class", "axis-label")
        .attr("x", width - margin.right)
        .attr("y", 13)
        .attr("text-anchor", "end")
        .attr("fill", "#43d9e6")
        .text("Average score");
    }

    function renderStudioChart() {
      clearChart(container);

      const studios = ChartData.studios(context.anime, context.selectedIds)
        .filter((item) => item.totalPopularity > 0 && Number.isFinite(item.averageScore));

      if (!studios.length) {
        renderEmpty(container, "No studios with score and popularity data match the filters.");
        return;
      }

      // Draw smaller bubbles last so they remain reachable where circles overlap.
      studios.sort((a, b) => d3.descending(a.count, b.count));

      const { svg, x, y } = drawPopularityAxes(studios, {
        popularity: (item) => item.totalPopularity,
        score: (item) => item.averageScore,
        label: "Studio score versus popularity bubble chart",
        popularityLabel: "Total popularity (log scale)"
      });

      const radius = d3.scaleSqrt()
        .domain([0, d3.max(studios, (item) => item.count)])
        .range([0, 20]);

      svg.append("g")
        .selectAll("circle")
        .data(studios, (item) => item.studio)
        .join("circle")
        .attr("class", "studio-dot")
        .attr("cx", (item) => x(item.totalPopularity))
        .attr("cy", (item) => y(item.averageScore))
        .attr("r", (item) => radius(item.count))
        .attr("fill", "var(--purple)")
        .attr("fill-opacity", 0.8)
        .attr("stroke", "white")
        .attr("stroke-width", item => item.selectedCount ? 3 : 1)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${escapeHTML(item.studio)}</strong>
            <span>
              Total popularity: ${formatNumber(item.totalPopularity)}<br>
              Average score: ${item.averageScore.toFixed(1)}/100<br>
              Matching titles: ${formatNumber(item.count)}
            </span>
          `);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);
    }

    function renderHeatmap() {

      clearChart(container);

      const anime = context.anime;

      if (!anime.some(item => item.studio_names.length && item.genres.length)) {
        renderEmpty(container, "No studio–genre data match the filters.");
        return;
      }

      const topStudios = ChartData.studios(anime, context.selectedIds)
        .sort((a, b) => d3.descending(a.count, b.count))
        .slice(0, 15)
        .map((item) => item.studio);

      const topGenres = ChartData.genres(anime, context.selectedIds)
        .sort((a, b) => d3.descending(a.count, b.count))
        .slice(0, 10)
        .map((item) => item.genre);

      const cells = [];

      topStudios.forEach((studio) => {
        topGenres.forEach((genre) => {
          const matchingAnime = anime.filter((item) => (
            item.studio_names.includes(studio)
            && item.genres.includes(genre)
          ));

          cells.push({
            studio,
            genre,
            count: matchingAnime.length,
            titles: matchingAnime.map((item) => item.title),
            selectedCount: matchingAnime.filter(item => context.selectedIds.includes(String(item.id))).length
          });
        });
      });

      const width = Math.max(container.clientWidth, 560);
      const height = Math.max(container.clientHeight, 480);
      const margin = { top: 64, right: 25, bottom: 20, left: 130 };

      const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

      const x = d3.scaleBand()
        .domain(topGenres)
        .range([margin.left, width - margin.right])
        .padding(0.08);

      const y = d3.scaleBand()
        .domain(topStudios)
        .range([margin.top, height - margin.bottom])
        .padding(0.08);

      const color = d3.scaleSequential()
        .domain([0, d3.max(cells, (item) => item.count) || 1])
        .interpolator(d3.interpolatePurples);

      svg.append("g")
        .selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("x", (item) => x(item.genre))
        .attr("y", (item) => y(item.studio))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("rx", 5)
        .attr("fill", (item) => (
          item.count === 0
            ? "rgba(255,255,255,0.025)"
            : color(item.count)
        ))
        .attr("stroke", item => item.selectedCount ? "white" : "rgba(255,255,255,0.055)")
        .attr("stroke-width", item => item.selectedCount ? 2 : 1)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>
              ${escapeHTML(item.studio)} × ${escapeHTML(item.genre)}
            </strong>
            <span>
              ${item.count} matching title${item.count === 1 ? "" : "s"}<br>
              ${escapeHTML(item.titles.slice(0, 4).join(", ") || "No titles")}
            </span>
          `);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip);

      svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${margin.top})`)
        .call(d3.axisTop(x).tickSize(0))
        .call((group) => group.select(".domain").remove())
        .selectAll("text")
        .attr("transform", "rotate(-38)")
        .attr("text-anchor", "start")
        .attr("dx", "0.5em")
        .attr("dy", "-0.25em");

      svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(${margin.left},0)`)
        .call(
          d3.axisLeft(y)
            .tickFormat((value) => truncate(value, 22))
            .tickSize(0)
        )
        .call((group) => group.select(".domain").remove());
    }

    function drawPopularityAxes(data, { popularity, score, label, popularityLabel, rankLimit }) {
      const width = Math.max(container.clientWidth, 320);
      const height = Math.max(container.clientHeight, 473);
      const margin = { top: 28, right: 28, bottom: 58, left: 62 };

      const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", [0, 0, width, height])
        .attr("aria-label", label);

      const xExtent = d3.extent(data, popularity);
      const yExtent = d3.extent(data, score);

      const x = (rankLimit ? d3.scaleLinear().domain([rankLimit, 1]) : d3.scaleLog()
        .domain([
          Math.max(1, xExtent[0] * 0.75),
          xExtent[1] * 1.25
        ]))
        .range([margin.left, width - margin.right]);

      const y = d3.scaleLinear()
        .domain(rankLimit ? [0, 10] : [
          Math.max(0, Math.floor((yExtent[0] - 5) / 5) * 5),
          Math.min(100, Math.ceil((yExtent[1] + 4) / 5) * 5)
        ])
        .nice()
        .range([height - margin.bottom, margin.top]);

      const xAxis = d3.axisBottom(x).ticks(width < 450 ? 5 : 7, "~s");
      if (rankLimit) {
        const ticks = x.ticks(width < 450 ? 4 : 6).filter(value => Number.isInteger(value) && value > 1);
        xAxis.tickValues([...ticks, 1]).tickFormat(d3.format("d"));
      }

      svg.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(7).tickValues(xAxis.tickValues())
          .tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));

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
        .call(xAxis);

      svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(6));

      svg.append("text")
        .attr("class", "axis-label")
        .attr("x", (margin.left + width - margin.right) / 2)
        .attr("y", height - 12)
        .attr("text-anchor", "middle")
        .text(popularityLabel);

      svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -(margin.top + height - margin.bottom) / 2)
        .attr("y", 16)
        .attr("text-anchor", "middle")
        .text(rankLimit ? "TMDB score / 10" : "Average score / 100");

      if (rankLimit) return { svg, x, y, correlation: null };

      const { correlation, regression } = metricData("popularityTrend", () => {
        const points = data.map(item => [Math.log10(popularity(item)), score(item)]);
        return { correlation: transforms.correlation(points), regression: linearRegression(points) };
      });

      if (correlation !== null && regression) {
        svg.append("text")
          .attr("class", "chart-correlation")
          .attr("x", (margin.left + width - margin.right) / 2)
          .attr("y", 16)
          .attr("text-anchor", "middle")
          .attr("font-size", 12)
          .attr("fill", "var(--text-soft)")
          .text(`Pearson r = ${correlation.toFixed(3)}`);

        svg.append("path")
          .attr("class", "chart-trendline")
          .datum(x.domain())
          .attr("fill", "none")
          .attr("stroke", "rgba(255,255,255,0.42)")
          .attr("stroke-dasharray", "5 5")
          .attr("stroke-width", 1.4)
          .attr("pointer-events", "none")
          .attr("d", d3.line()
            .x(popularity => x(popularity))
            .y(popularity => y(regression.intercept + regression.slope * Math.log10(popularity))));
      }

      return { svg, x, y, correlation };
    }

    function renderScatterplot() {
      const rankLimit = context.movieRankLimit;
      const popularity = item => rankLimit ? item.popularity_rank : item.popularity;
      const score = item => rankLimit ? item.vote_average : item.average_score;
      const data = metricData("scored", () => rankLimit ? context.anime.filter(transforms.hasMovieReception)
        : context.anime.filter(item => item.popularity > 0 && Number.isFinite(item.average_score))
          .sort((a, b) => (b.favourites || 0) - (a.favourites || 0)));

      clearChart(container);

      if (!data.length) {
        context.onCorrelation?.(null, 0);
        renderEmpty(container, rankLimit ? "No displayed movies have a TMDB score and popularity rank."
          : "No scored anime match the current filters.");
        return;
      }

      const { svg, x, y, correlation } = drawPopularityAxes(data, {
        popularity, score, rankLimit,
        label: rankLimit ? "TMDB score versus popularity rank scatterplot" : "Score versus popularity scatterplot",
        popularityLabel: rankLimit ? "TMDB popularity rank" : "Popularity — AniList list users (log scale)"
      });
      context.onCorrelation?.(correlation, data.length);

      const radius = d3.scaleSqrt()
        .domain([0, d3.max(data, (item) => item.favourites || 0) || 1])
        .range([0, 20]);
      // A hollow marker keeps titles with zero or unknown favourites available for selection.
      const pointRadius = item => rankLimit ? 5 : item.favourites > 0 ? radius(item.favourites) : 4;
      const filled = item => rankLimit || item.favourites > 0;

      svg.append("g")
        .selectAll("circle")
        .data(data, (item) => item.id)
        .join("circle")
        .attr("class", "reception-dot")
        .attr("cx", item => x(popularity(item)))
        .attr("cy", item => y(score(item)))
        .attr("r", pointRadius)
        .attr("fill", item => filled(item) ? context.dustColor(String(item.id)) : "transparent")
        .attr("stroke", item => filled(item) ? "var(--surface-solid)" : context.dustColor(String(item.id)))
        .attr("stroke-width", 1.5)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${escapeHTML(item.title)}</strong>
            <span>${rankLimit ? `
              TMDB score: ${item.vote_average}/10<br>
              TMDB popularity rank: #${formatNumber(item.popularity_rank)}<br>
              Genres: ${escapeHTML(item.genres.join(", ") || "Unknown")}
            ` : `
              Score: ${item.average_score}/100<br>
              Popularity: ${formatNumber(item.popularity)}<br>
              Favourites: ${formatNumber(item.favourites)}<br>
              Genres: ${escapeHTML(item.genres.join(", ") || "Unknown")}<br>
              Studio: ${escapeHTML(item.studio_names.join(", "))}
            `}</span>
          `);
        })
        .on("mousemove", moveTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", (_, item) => {
          hideTooltip();
          context.onSelect(String(item.id));
        });

      svg.append("g").attr("aria-hidden", "true")
        .selectAll("circle")
        .data(data.filter(item => context.selectedIds.includes(String(item.id))))
        .join("circle")
        .attr("class", "reception-selection-ring")
        .attr("cx", item => x(popularity(item)))
        .attr("cy", item => y(score(item)))
        .attr("r", item => pointRadius(item) + 3);
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
    const renderers = { genres: renderGenreChart, years: renderTimeline, studios: renderStudioChart,
      heatmap: renderHeatmap, reception: renderScatterplot };
    if (!renderers[kind]) throw new Error(`Unknown chart: ${kind}`);
    function keyboardMarks() {
      const selectable = kind === "reception";
      d3.select(container).selectAll("rect, circle").filter(function () {
        return Boolean(d3.select(this).on("mouseenter"));
      }).attr("tabindex", 0).attr("role", selectable ? "button" : "img")
        .attr("aria-pressed", item => selectable ? context.selectedIds.includes(String(item.id)) : null)
        .attr("aria-label", item => item.title && (context.movieRankLimit
          ? `${item.title}: TMDB score ${item.vote_average} / 10; TMDB popularity rank #${formatNumber(item.popularity_rank)}; genres ${item.genres.join(", ") || "Unknown"}`
          : `${item.title}: score ${item.average_score} / 100; popularity ${formatNumber(item.popularity)}; favourites ${Number.isFinite(item.favourites) ? formatNumber(item.favourites) : 'Unknown'}; genres ${item.genres.join(", ") || "Unknown"}`) || item.genre && item.studio && `${item.studio} × ${item.genre}: ${item.count}`
          || item.genre && `${item.genre}: ${item.count} titles` || item.studio && `${item.studio}: total popularity ${formatNumber(item.totalPopularity)}; average score ${item.averageScore.toFixed(1)} / 100; ${item.count} matching titles`
          || `${item.year}: ${item.count} titles`)
        .on("keydown", selectable ? function (event, item) {
          if (["Enter", " "].includes(event.key)) {
            event.preventDefault(); d3.select(this).on("click").call(this, event, item);
          }
        } : null)
        .on('focus', function (event, item) {
          const rect = this.getBoundingClientRect();
          d3.select(this).on('mouseenter').call(this, { clientX: rect.x + rect.width / 2, clientY: rect.y }, item);
        })
        .on('blur', hideTooltip);
    }
    return {
      update(value) {
        const focused = container.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
        const nextSelection = JSON.stringify(value.selectedIds || []);
        if (value.anime !== dataIdentity || nextSelection !== selectionKey) cached.clear();
        dataIdentity = value.anime; selectionKey = nextSelection;
        context = { selectedIds: [], onSelect() {},
          dustColor: () => "#9d7bff", ...value };
        renderers[kind](); keyboardMarks();
        if (focused) [...container.querySelectorAll('[tabindex="0"][aria-label]')].find(node => node.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
      },
      destroy() { container.replaceChildren(); context = null; }
    };
  }
  root.AnivizCharts = Object.freeze({ create });
})(globalThis);
