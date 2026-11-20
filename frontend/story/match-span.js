"use strict";

const HistoryMatchSpan = (() => {
  const formatSpan = span => `${span} ${span === 1 ? "year" : "years"}`;

  function textElement(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }

  function mount(root, { onYearChange, onDirectionChange }) {
    const $ = selector => root.querySelector(selector);
    const direction = $(".history-perspective");
    const yearPicker = $("#history-span-year");
    const previousYear = $("#history-span-previous-year");
    const nextYear = $("#history-span-next-year");
    const status = $("#history-span-status");
    const statusText = status.querySelector("span");
    const retry = status.querySelector("button");
    const results = $(".history-span-results");
    const title = $("#history-span-title");
    const value = $("#history-span-value");
    const caption = $("#history-span-caption");
    const calculation = $("#history-span-calculation");
    const steps = $(".history-span-steps");
    const equation = $(".history-span-equation");
    const comparisonHeading = $("#history-span-comparison-heading");
    const comparisonDescription = $("#history-span-comparison-description");
    const bars = $(".history-span-bars");
    const barWheel = $(".history-span-wheel");
    const genres = $(".history-span-genres");
    const genreSummary = genres.querySelector("summary");
    const genreRows = genres.querySelector("tbody");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pairs = [];
    let renderedYear = null;
    let renderedDirection = null;
    let barSnapshot = null;
    let animations = [];

    function clearMotion() {
      animations.forEach(animation => animation.cancel());
      animations = [];
      barSnapshot?.remove();
      barSnapshot = null;
    }

    function animateYearChange(snapshot, from, to) {
      const step = to > from ? 1 : -1;
      snapshot.className = "history-span-bars-previous";
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.inert = true;
      barWheel.append(snapshot);
      barSnapshot = snapshot;
      const rowHeight = bars.children.length > 1
        ? bars.children[1].offsetTop - bars.children[0].offsetTop
        : bars.offsetHeight;
      // Align shared years so the three-row chart rolls by one row, including
      // when navigation jumps across a gap in the available release years.
      let distance = step * rowHeight;
      for (const row of bars.children) {
        const previous = [...snapshot.children].find(candidate => candidate.dataset.year === row.dataset.year);
        if (previous) {
          distance = previous.offsetTop - row.offsetTop;
          break;
        }
      }
      const timing = { duration: 380, easing: "cubic-bezier(.22, 1, .36, 1)" };
      const outgoingMotion = snapshot.animate([
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${-distance}px)`, opacity: 0 }
      ], { ...timing, fill: "forwards" });
      const incomingMotion = bars.animate([
        { transform: `translateY(${distance}px)`, opacity: 0 },
        { transform: "translateY(0)", opacity: 1 }
      ], timing);
      animations = [outgoingMotion, incomingMotion];
      // Keep shared rows aligned and sharp; only rows entering or leaving
      // the chart turn around the wheel's edge.
      for (const [list, other, entering] of [[snapshot, bars, false], [bars, snapshot, true]]) {
        for (const row of list.children) {
          if ([...other.children].some(candidate => candidate.dataset.year === row.dataset.year)) continue;
          const flat = { transform: "rotateX(0deg)", opacity: 1 };
          const curved = { transform: `rotateX(${(entering ? -step : step) * 65}deg)`, opacity: 0 };
          animations.push(row.animate(entering ? [curved, flat] : [flat, curved], timing));
        }
      }
      incomingMotion.onfinish = () => {
        if (barSnapshot === snapshot) clearMotion();
      };
    }

    function showStatus(message = "", onRetry = null) {
      statusText.textContent = message;
      status.hidden = !message;
      retry.hidden = !onRetry;
      retry.onclick = onRetry;
    }

    function renderCalculation({ years, centralYears, gaps, span }, matches) {
      const centralMatches = matches.slice(0, 5).sort((a, b) => b.work.year - a.work.year).slice(1, -1);
      const yearCard = index => {
        const card = document.createElement("span");
        card.className = "history-span-match-year";
        card.append(textElement("strong", centralYears[index]),
          textElement("span", centralMatches[index].work.title));
        return card;
      };
      const nodes = [yearCard(0)];
      gaps.forEach((gap, index) => {
        const connector = document.createElement("span");
        connector.className = "history-span-gap";
        connector.append(textElement("span", gap));
        nodes.push(connector, yearCard(index + 1));
      });
      steps.replaceChildren(...nodes);
      equation.firstElementChild.textContent = `All five release years, newest first: ${years.join(", ")}. Using the middle three: ${centralYears.join(", ")}. `;
      equation.lastElementChild.textContent = `Q3 − Q1: ${centralYears[0]} − ${centralYears.at(-1)} = ${formatSpan(span)}`;
    }

    function renderComparison(year, anchorMedium) {
      const comparisons = [year - 1, year, year + 1]
        .filter(candidate => candidate >= pairs[0].year && candidate <= pairs.at(-1).year)
        .map(candidate => {
          const pair = pairs.find(pair => pair.year === candidate);
          return { year: candidate, anchor: pair?.anchor, summary: StoryData.matchYearSpan(pair?.matches ?? []) };
        });
      const max = Math.max(1, ...comparisons.map(item => item.summary?.span ?? 0));
      bars.replaceChildren(...comparisons.map(item => {
        const row = document.createElement("li");
        row.dataset.year = item.year;
        if (item.year === year) row.setAttribute("aria-current", "true");
        const label = document.createElement("span");
        label.className = "history-span-bar-title";
        label.append(textElement("span", item.year),
          textElement("strong", item.anchor?.title ?? `No top ${anchorMedium} available`));
        const range = textElement("span", item.summary ? `${item.summary.centralYears.at(-1)}–${item.summary.centralYears[0]}` : "Range unavailable");
        range.className = "history-span-bar-range";
        const length = textElement("span", item.summary ? formatSpan(item.summary.span) : "Unavailable");
        length.className = "history-span-bar-length";
        const track = document.createElement("span");
        track.className = "history-span-track";
        track.setAttribute("aria-hidden", "true");
        const bar = document.createElement("span");
        bar.style.width = `${100 * (item.summary?.span ?? 0) / max}%`;
        track.append(bar);
        track.hidden = !item.summary;
        row.append(label, range, length, track);
        return row;
      }));
    }

    function renderGenres(matches) {
      genres.hidden = !matches.length;
      genreSummary.textContent = matches.length === 5
        ? "View all 5 matches and genres" : "View available matches and genres";
      genreRows.replaceChildren(...matches.map(({ work, score }) => {
        const row = document.createElement("tr");
        const name = textElement("th", work.title);
        name.scope = "row";
        const labels = Array.isArray(work.genres) ? work.genres.join(", ") : "";
        row.append(name, textElement("td", work.year), textElement("td", labels || "Unknown"),
          textElement("td", score.toFixed(3)));
        return row;
      }));
    }

    function render(animate = false) {
      clearMotion();
      const { year, anchor, matches } = pairs[yearPicker.selectedIndex];
      const shouldAnimate = animate && !reducedMotion.matches && renderedDirection === root.dataset.direction
        && renderedYear != null && renderedYear !== year;
      const snapshot = shouldAnimate ? bars.cloneNode(true) : null;
      const summary = StoryData.matchYearSpan(matches);
      const moviePerspective = root.dataset.direction === "movie";
      const anchorMedium = moviePerspective ? "movie" : "anime";
      title.textContent = anchor?.title ?? `No ${anchorMedium} data for ${year}`;
      value.hidden = calculation.hidden = !summary;
      if (summary) {
        value.textContent = formatSpan(summary.span);
        caption.textContent = `Interquartile range (IQR) of the 5 closest ${moviePerspective ? "anime" : "movie"} matches. Uses the middle 3 release years; the earliest and latest are excluded.`;
        renderCalculation(summary, matches);
      } else {
        caption.textContent = matches.length ? "Five dated matches are needed to calculate the span."
          : "No matches are available for this year.";
      }
      renderComparison(year, anchorMedium);
      renderGenres(matches.slice(0, 5));
      if (snapshot) animateYearChange(snapshot, renderedYear, year);
      renderedYear = year;
      renderedDirection = root.dataset.direction;
    }

    function setDirection(mode) {
      direction.querySelector(`[value="${mode}"]`).checked = true;
    }

    function update(mode, rows, index) {
      if (pairs !== rows) {
        pairs = rows;
        root.dataset.direction = mode;
        const moviePerspective = mode === "movie";
        comparisonHeading.textContent = `Compare nearby ${moviePerspective ? "movie" : "anime"} release years`;
        comparisonDescription.textContent = `Each row shows that year’s top ${moviePerspective ? "movie" : "anime"} and the interquartile release-year range of its five closest ${moviePerspective ? "anime" : "movie"} matches. The span is the second-newest year (Q3) minus the second-oldest (Q1), reducing the influence of isolated early or late matches.`;
        yearPicker.replaceChildren(...pairs.map(pair => new Option(pair.year, pair.year)));
        yearPicker.disabled = false;
        results.hidden = false;
      }
      yearPicker.selectedIndex = index;
      previousYear.disabled = index <= 0;
      nextYear.disabled = index >= pairs.length - 1;
      if (root.open) render(true);
    }

    function stepYear(offset) {
      const pair = pairs[yearPicker.selectedIndex + offset];
      if (pair) onYearChange(pair.year);
    }

    root.addEventListener("toggle", () => {
      clearMotion();
      if (root.open && pairs.length) render();
    });
    reducedMotion.addEventListener("change", () => {
      if (reducedMotion.matches) clearMotion();
    });
    direction.addEventListener("change", event => onDirectionChange(event.target));
    yearPicker.addEventListener("change", () => onYearChange(Number(yearPicker.value)));
    previousYear.addEventListener("click", () => stepYear(-1));
    nextYear.addEventListener("click", () => stepYear(1));
    return { setDirection, showStatus, update };
  }

  return { mount };
})();
