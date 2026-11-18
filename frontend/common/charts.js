"use strict";
// Instances own their container and latest snapshot. No page-global controls or selectors.
(function (root) {
  let nextClipId = 0;
  function create(kind, { container, d3, helpers, transforms = root.AnivizChartData }) {
    if (!container) throw new Error("A chart container is required");
    const { clearChart, renderEmpty, showTooltip, moveTooltip, hideTooltip, escapeHTML,
      formatNumber, truncate, compactFormatter } = helpers;
    let context, dataIdentity, selectionKey, receptionCamera;
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
    const scoreMax = () => context.movieRankLimit ? 10 : 100;
    const averageScore = item => Number.isFinite(item.averageScore)
      ? `${item.averageScore.toFixed(1)} / ${scoreMax()}` : "N/A";
    const popularityLabel = () => context.movieRankLimit ? "Total TMDB popularity score" : "Total popularity";

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
        .slice(0, context.movieRankLimit ? Infinity : 12);

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
        .attr("stroke", item => item.selectedCount ? "var(--text)" : "none")
        .attr("stroke-width", 2)
        .attr("fill", "var(--purple)")
        .attr("fill-opacity", 0.8)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${escapeHTML(item.genre)}</strong>
            <span>
              Titles: ${item.count}<br>
              Average score: ${averageScore(item)}<br>
              ${popularityLabel()}: ${formatNumber(item.totalPopularity)}
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
        .attr("fill", "var(--chart-label)")
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
        .attr("stroke", item => item.selectedCount ? "var(--text)" : "none")
        .attr("stroke-width", 2)
        .attr("fill", "color-mix(in srgb, var(--color-primary-strong) 42%, transparent)")
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${item.year}</strong>
            <span>
              Titles: ${item.count}<br>
              Average score: ${averageScore(item)}<br>
              ${popularityLabel()}: ${formatNumber(item.totalPopularity)}
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

      const lineData = data.filter((item) => Number.isFinite(item.averageScore));
      if (!lineData.length) return;
      const scoreExtent = d3.extent(lineData, (item) => item.averageScore);
      const scorePadding = scoreMax() * 0.05;

      const yScore = d3.scaleLinear()
        .domain([
          Math.max(0, scoreExtent[0] - scorePadding),
          Math.min(scoreMax(), scoreExtent[1] + scorePadding)
        ])
        .nice()
        .range([height - margin.bottom, margin.top]);

      svg.append("path")
        .datum(lineData)
        .attr("fill", "none")
        .attr("stroke", "var(--color-secondary-strong)")
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
        .attr("fill", "var(--color-secondary-strong)")
        .attr("stroke", "var(--surface-solid)")
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
        .attr("fill", "var(--color-secondary-strong)")
        .text(context.movieRankLimit ? "TMDB score / 10" : "Average score");
    }

    function renderStudioChart() {
      clearChart(container);

      const groupMode = Boolean(context.studioGroups);
      const summaries = groupMode ? context.studioGroups.map(({ title, ...group }) => ({
        ...group, studio: title
      })) : ChartData.studios(context.anime, context.selectedIds);
      const studios = summaries.map(item => ({
        ...item, popularity: item.totalPopularity, score: item.averageScore
      })).filter(item => item.popularity > 0 && Number.isFinite(item.score));

      if (!studios.length) {
        renderEmpty(container, "No studios with score and popularity data match the filters.");
        return;
      }

      // Draw smaller bubbles last so they remain reachable where circles overlap.
      studios.sort((a, b) => d3.descending(a.count, b.count));

      const { svg, x, y, draw } = drawPopularityAxes(studios, {
        popularity: (item) => item.popularity,
        score: (item) => item.score,
        label: "Studio score versus popularity bubble chart",
        popularityLabel: "Total popularity (log scale)",
        scoreLabel: "Average score / 100"
      });
      draw();

      const radius = d3.scaleSqrt()
        .domain([0, d3.max(studios, (item) => item.count)])
        .range([0, 20]);

      svg.append("g")
        .selectAll("circle")
        .data(studios, (item) => item.key)
        .join("circle")
        .attr("class", "studio-dot")
        .attr("cx", (item) => x(item.popularity))
        .attr("cy", (item) => y(item.score))
        .attr("r", (item) => radius(item.count))
        .attr("fill", "var(--purple)")
        .attr("fill-opacity", 0.8)
        .attr("stroke", "var(--text)")
        .attr("stroke-width", item => item.selectedCount ? 3 : 1)
        .on("mouseenter", (event, item) => {
          showTooltip(event, `
            <strong>${escapeHTML(item.studio)}</strong>
            <span>
              Total popularity: ${formatNumber(item.popularity)}<br>
              Average score: ${item.score.toFixed(1)}/100<br>
              ${groupMode ? "Catalogue anime" : "Matching titles"}: ${formatNumber(item.count)}
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

      const studios = context.studioGroups ? context.studioGroups.map(group => ({
        key: group.key, title: group.title, members: new Set(group.memberIds), count: group.memberIds.length
      })) : ChartData.studios(anime, context.selectedIds).map(item => ({
        key: item.key, title: item.studio, members: new Set(item.ids), count: item.count
      }));
      const topStudios = studios
        .sort((a, b) => d3.descending(a.count, b.count))
        .slice(0, 15);

      const topGenres = ChartData.genres(anime, context.selectedIds)
        .sort((a, b) => d3.descending(a.count, b.count))
        .slice(0, 10)
        .map((item) => item.genre);

      const cells = [];

      topStudios.forEach(({ key, title, members }) => {
        const works = anime.filter(item => members.has(String(item.id)));
        topGenres.forEach((genre) => {
          const matchingAnime = works.filter(item => item.genres.includes(genre));

          cells.push({
            studio: title,
            studioKey: key,
            genre,
            count: matchingAnime.length,
            titles: matchingAnime.map((item) => item.title),
            selectedCount: matchingAnime.filter(item => context.selectedIds.includes(String(item.id))).length
          });
        });
      });

      const width = Math.max(container.clientWidth, 560);
      const height = context.studioGroups ? Math.max(128, 84 + 34 * topStudios.length) : Math.max(container.clientHeight, 480);
      const margin = { top: 64, right: 25, bottom: 20, left: 130 };

      const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

      const x = d3.scaleBand()
        .domain(topGenres)
        .range([margin.left, width - margin.right])
        .padding(0.08);

      const y = d3.scaleBand()
        .domain(topStudios.map(studio => studio.key))
        .range([margin.top, height - margin.bottom])
        .padding(0.08);

      const intensity = d3.scaleLinear()
        .domain([0, d3.max(cells, (item) => item.count) || 1])
        .range([15, 100]);

      svg.append("g")
        .selectAll("rect")
        .data(cells)
        .join("rect")
        .attr("x", (item) => x(item.genre))
        .attr("y", (item) => y(item.studioKey))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("rx", 5)
        .attr("fill", (item) => (
          item.count === 0
            ? "var(--bg-soft)"
            : `color-mix(in srgb, var(--color-primary-strong) ${intensity(item.count)}%, var(--surface-solid))`
        ))
        .attr("stroke", item => item.selectedCount ? "var(--text)" : "var(--border)")
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
            .tickFormat((key) => truncate(topStudios.find(studio => studio.key === key).title, 22))
            .tickSize(0)
        )
        .call((group) => group.select(".domain").remove());
    }

    function drawPopularityAxes(data, { popularity, score, label, popularityLabel, rankLimit,
      scoreLabel = rankLimit ? "TMDB score / 10" : "Average score / 100" }) {
      const zoomable = kind === "reception";
      const width = Math.max(container.clientWidth, 320);
      const height = Math.max(container.clientHeight, 473);
      const margin = { top: zoomable ? 52 : 28, right: 28, bottom: 58, left: 62 };
      const extent = [[margin.left, margin.top], [width - margin.right, height - margin.bottom]];
      const plotCenter = (margin.left + width - margin.right) / 2;

      const svg = d3.select(container)
        .append("svg")
        .classed("reception-plot", zoomable)
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

      const xGrid = svg.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0,${height - margin.bottom})`);
      const yGrid = svg.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(${margin.left},0)`);
      const xTicks = svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${height - margin.bottom})`);
      const yTicks = svg.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(${margin.left},0)`);

      function updateAxes(viewX, viewY) {
        const xAxis = d3.axisBottom(viewX).ticks(width < 450 ? 5 : 7, "~s");
        if (rankLimit) {
          const ticks = viewX.ticks(width < 450 ? 4 : 6).filter(value => Number.isInteger(value) && value > 1);
          if (viewX.domain()[1] <= 1 + 1e-9) ticks.push(1);
          xAxis.tickValues(ticks).tickFormat(d3.format("d"));
        }
        xGrid.call(d3.axisBottom(viewX).ticks(7).tickValues(xAxis.tickValues())
          .tickSize(-(height - margin.top - margin.bottom)).tickFormat(""));
        yGrid.call(d3.axisLeft(viewY).ticks(6)
          .tickSize(-(width - margin.left - margin.right)).tickFormat(""));
        xTicks.call(xAxis);
        yTicks.call(d3.axisLeft(viewY).ticks(6));
      }

      svg.append("text")
        .attr("class", "axis-label")
        .attr("x", plotCenter)
        .attr("y", height - 12)
        .attr("text-anchor", "middle")
        .text(popularityLabel);

      svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -(margin.top + height - margin.bottom) / 2)
        .attr("y", 16)
        .attr("text-anchor", "middle")
        .text(scoreLabel);

      const clipId = `reception-plot-clip-${++nextClipId}`;
      svg.append("clipPath").attr("id", clipId).append("rect")
        .attr("x", margin.left).attr("y", margin.top)
        .attr("width", width - margin.left - margin.right)
        .attr("height", height - margin.top - margin.bottom);
      const clip = `url(#${clipId})`;

      const { correlation, regression } = rankLimit ? { correlation: null } : metricData("popularityTrend", () => {
        const points = data.map(item => [Math.log10(popularity(item)), score(item)]);
        return { correlation: transforms.correlation(points), regression: linearRegression(points) };
      });

      let trendline;
      if (correlation !== null && regression) {
        svg.append("text")
          .attr("class", "chart-correlation")
          .attr("x", zoomable ? margin.left : plotCenter)
          .attr("y", zoomable ? 28 : 16)
          .attr("text-anchor", zoomable ? null : "middle")
          .attr("font-size", 12)
          .attr("fill", "var(--text-soft)")
          .text(`Pearson r = ${correlation.toFixed(3)}`);

        trendline = svg.append("path")
          .attr("class", "chart-trendline")
          .attr("fill", "none")
          .attr("stroke", "var(--chart-label)")
          .attr("stroke-dasharray", "5 5")
          .attr("stroke-width", 1.4)
          .attr("pointer-events", "none")
          .attr("clip-path", clip);
      }

      return { svg, x, y, correlation, clip, extent, draw(transform) {
        const viewX = transform ? transform.rescaleX(x) : x;
        const viewY = transform ? transform.rescaleY(y) : y;
        updateAxes(viewX, viewY);
        trendline?.attr("d", d3.line()
          .x(value => viewX(value))
          .y(value => viewY(regression.intercept + regression.slope * Math.log10(value)))(viewX.domain()));
      } };
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
        receptionCamera = null;
        context.onCorrelation?.(null, 0);
        renderEmpty(container, rankLimit ? "No displayed movies have a TMDB score and popularity rank."
          : "No scored anime match the current filters.");
        return;
      }

      const chart = drawPopularityAxes(data, {
        popularity, score, rankLimit,
        label: rankLimit ? "TMDB score versus popularity rank scatterplot" : "Score versus popularity scatterplot",
        popularityLabel: rankLimit ? "TMDB popularity rank" : "Popularity — AniList list users (log scale)"
      });
      const { svg, x, y, correlation, clip, extent } = chart;
      context.onCorrelation?.(correlation, data.length);

      const radius = d3.scaleSqrt()
        .domain([0, d3.max(data, (item) => item.favourites || 0) || 1])
        .range([0, 20]);
      // A hollow marker keeps titles with zero or unknown favourites available for selection.
      const pointRadius = item => rankLimit ? 5 : item.favourites > 0 ? radius(item.favourites) : 4;
      const filled = item => rankLimit || item.favourites > 0;
      const { filmography } = context;
      const selectedIds = new Set(context.selectedIds);
      const isSelected = item => selectedIds.has(String(item.id));
      const color = filmography ? () => "var(--purple)" : item => context.dustColor(String(item.id));

      const marks = svg.append("g");
      const dots = marks.append("g")
        .selectAll("circle")
        .data(data, (item) => item.id)
        .join("circle")
        .attr("class", "reception-dot")
        .classed("filmography-dot", Boolean(filmography))
        .attr("r", pointRadius)
        .attr("fill", item => filled(item) ? color(item) : "transparent");

      if (filmography) {
        dots.attr("fill-opacity", 0.8)
          .attr("stroke", item => filled(item) ? "var(--text)" : color(item))
          .attr("stroke-width", 1);
      } else {
        dots.attr("fill-opacity", 0.65)
          .attr("stroke", item => filled(item) ? "var(--surface-solid)" : color(item))
          .attr("stroke-width", 1.5);
      }

      function bindMarks(selection) {
        // Closing the details overlay can fire mouseenter under a stationary pointer.
        selection.on("mousemove", (event, item) => {
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
        .on("mouseleave", hideTooltip)
        .on("click", (_, item) => {
          hideTooltip();
          context.onSelect(String(item.id));
        });
        keyboardMarks(selection);
      }
      bindMarks(dots);

      const rings = marks.append("g").attr("aria-hidden", "true")
        .selectAll("circle")
        .data(data.filter(isSelected))
        .join("circle")
        .attr("class", "reception-selection-ring")
        .attr("r", item => pointRadius(item) + 3);

      const posterLayer = marks.append("g");
      const thumbnail = rankLimit ? root.AnivizArtwork.movieThumbnail : root.AnivizArtwork.animeThumbnail;
      const [[left, top], [right, bottom]] = extent;
      const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
      const inView = (px, py) =>
        px >= left - 1e-6 && px <= right + 1e-6 && py >= top - 1e-6 && py <= bottom + 1e-6;
      const zoomInPoint = transform => {
        // Keep a title in view when the plotted scores are clustered away from the center.
        let closest, distance = Infinity;
        for (const item of data) {
          const px = transform.applyX(x(popularity(item))), py = transform.applyY(y(score(item)));
          if (!inView(px, py)) continue;
          const candidateDistance = Math.hypot(px - centerX, py - centerY);
          if (candidateDistance >= distance) continue;
          closest = [px, py];
          distance = candidateDistance;
        }
        return closest;
      };
      function draw(transform, showPosters) {
        chart.draw(transform);
        const zoomed = transform.k > 1;
        marks.attr("clip-path", zoomed ? clip : null);
        const pointX = item => transform.applyX(x(popularity(item)));
        const pointY = item => transform.applyY(y(score(item)));
        const visible = item => inView(pointX(item), pointY(item));
        if (!showPosters) {
          dots.attr("tabindex", item => !zoomed || visible(item) ? 0 : -1)
            .attr("aria-hidden", item => !zoomed || visible(item) ? null : "true");
          dots.attr("cx", pointX).attr("cy", pointY);
          rings.attr("cx", pointX).attr("cy", pointY);
        }
        posterLayer.selectAll("foreignObject")
          .data(showPosters ? data.filter(visible) : [], item => item.id)
          .join(enter => {
            const posters = enter.append("foreignObject").attr("class", "reception-poster")
              .classed("is-selected", isSelected);
            const { images } = root.AnivizPosterZoom.addCards(posters, {
              title: item => item.title, color
            });
            root.AnivizPosterZoom.drawArtwork(images, thumbnail);
            bindMarks(posters);
            return posters;
          })
          .attr("x", item => pointX(item) - 34).attr("y", item => pointY(item) - 62);
        receptionCamera = { rankLimit, extent, transform };
      }

      const previous = receptionCamera;
      const camera = root.AnivizPosterZoom.attach({
        container, svg, d3, extent, label: "Score vs. popularity", onStart: hideTooltip, onZoom: draw, zoomInPoint
      });
      if (previous && previous.rankLimit === rankLimit && previous.transform.k > 1) {
        const { k, x: tx, y: ty } = previous.transform;
        const [[oldLeft, oldTop], [oldRight, oldBottom]] = previous.extent;
        camera.setTransform(d3.zoomIdentity.translate(
          left * (1 - k) + (tx - oldLeft * (1 - k)) * (right - left) / (oldRight - oldLeft),
          top * (1 - k) + (ty - oldTop * (1 - k)) * (bottom - top) / (oldBottom - oldTop)
        ).scale(k));
      } else {
        draw(d3.zoomIdentity, false);
      }
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
    function keyboardMarks(marks) {
      const selectable = kind === "reception";
      const tooltipEvent = selectable ? "mousemove" : "mouseenter";
      marks.attr("tabindex", 0).attr("role", selectable ? "button" : "img")
        .attr("aria-pressed", item => selectable && context.hasSelection ? context.selectedIds.includes(String(item.id)) : null)
        .attr("aria-label", item => item.title && (context.movieRankLimit
          ? `${item.title}: TMDB score ${item.vote_average} / 10; TMDB popularity rank #${formatNumber(item.popularity_rank)}; genres ${item.genres.join(", ") || "Unknown"}`
          : `${item.title}: score ${item.average_score} / 100; popularity ${formatNumber(item.popularity)}; favourites ${Number.isFinite(item.favourites) ? formatNumber(item.favourites) : 'Unknown'}; genres ${item.genres.join(", ") || "Unknown"}`) || item.genre && item.studio && `${item.studio} × ${item.genre}: ${item.count}`
          || item.studio && `${item.studio}. Total popularity ${formatNumber(item.popularity)}. Average score ${item.score.toFixed(1)} / 100. ${item.count} ${context.studioGroups ? "catalogue anime" : "matching titles"}.`
          || `${item.genre ?? item.year}: ${item.count} titles; average score ${averageScore(item)}; ${popularityLabel()} ${formatNumber(item.totalPopularity)}`)
        .on("keydown", selectable ? function (event, item) {
          if (["Enter", " "].includes(event.key)) {
            event.preventDefault(); d3.select(this).on("click").call(this, event, item);
          }
        } : null)
        .on('focus', function (event, item) {
          const rect = this.getBoundingClientRect();
          d3.select(this).on(tooltipEvent).call(this, { clientX: rect.x + rect.width / 2, clientY: rect.y }, item);
        })
        .on('blur', hideTooltip);
    }
    return {
      update(value) {
        const focused = container.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
        const filmography = kind === "reception" ? value.filmography : null;
        const anime = filmography ?? value.anime;
        const selectedIds = filmography ? [] : value.selectedIds || [];
        const nextSelection = JSON.stringify(selectedIds);
        if (anime !== dataIdentity || nextSelection !== selectionKey) cached.clear();
        dataIdentity = anime; selectionKey = nextSelection;
        context = { onSelect() {}, dustColor: () => "var(--color-primary-strong)", hasSelection: Boolean(value.selectedIds),
          ...value, anime, filmography, selectedIds };
        renderers[kind]();
        if (kind !== "reception") {
          keyboardMarks(d3.select(container).selectAll("rect, circle").filter(function () {
            return Boolean(d3.select(this).on("mouseenter"));
          }));
        }
        if (focused) [...container.querySelectorAll('[aria-label]')].find(node =>
          node.tabIndex === 0 && !node.disabled && node.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
      },
      destroy() { container.replaceChildren(); context = receptionCamera = null; }
    };
  }
  root.AnivizCharts = Object.freeze({ create });
})(globalThis);
