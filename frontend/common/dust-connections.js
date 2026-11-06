"use strict";

// Compare each active movie against the same anime shown in the dust field.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizDustConnections = api;
})(globalThis, function () {
  function movieConnections(snapshot) {
    return snapshot.movieIds.map((movieId, movieIndex) => {
      // Local ranks follow visible dust membership, independently of table sorting.
      const ranking = snapshot.displayedDust.slice().sort((a, b) =>
        b.scores[movieIndex] - a.scores[movieIndex] || a.index - b.index);
      const topCount = Math.min(5, ranking.length);
      const bottomStart = Math.max(topCount, ranking.length - 5);
      const row = (match, index, group) => ({ ...match, rank: index + 1,
        similarity: match.scores[movieIndex], group });
      return { movieId, total: ranking.length, topCount, omitted: bottomStart - topCount,
        matches: [...ranking.slice(0, topCount).map((match, i) => row(match, i, "top")),
          ...ranking.slice(bottomStart).map((match, i) => row(match, bottomStart + i, "bottom"))] };
    });
  }

  function lines(title, columns, limit = 2) {
    const words = String(title).split(/\s+/), result = [""];
    for (const word of words) {
      const last = result.length - 1;
      if (result[last] && result[last].length + word.length + 1 > columns) result.push(word);
      else result[last] += (result[last] ? " " : "") + word;
    }
    return result.slice(0, limit).map((line, i) => line.length > columns || i === limit - 1 && result.length > limit
      ? line.slice(0, columns - 1) + "…" : line);
  }

  function create({ container, d3, color, onInspect, onCoverage, renderEmpty, helpers }) {
    const { escapeHTML } = helpers;
    let latest, renderedWidth;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (latest && container.clientWidth !== renderedWidth) update(latest);
    }) : null;
    observer?.observe(container);
    function update(value) {
      latest = value;
      renderedWidth = container.clientWidth;
      const { snapshot, movies } = value;
      const focused = container.contains(document.activeElement) ? document.activeElement.dataset.dustConnectionId : null;
      container.replaceChildren();
      const groups = movieConnections(snapshot);
      onCoverage(`${snapshot.displayedDust.length} displayed anime · each movie ranked within the displayed dust · similarity scores are not percentages.`);
      if (!groups.length || !snapshot.displayedDust.length) {
        renderEmpty(container, groups.length ? 'No anime match the current dust filters. Broaden or reset filters to see connections.'
          : 'Add a movie to compare its most and least similar anime.'); return;
      }
      const cards = groups.map((group, movieIndex) => {
        const movie = movies[movieIndex];
        // Movies are passed in with the same ordered IDs as the score columns.
        const title = movie?.title || `Movie ${movieIndex + 1}`;
        const card = document.createElement('section');
        card.className = 'dust-connection-map';
        card.setAttribute('aria-label', `Similarity connections for ${title}`);
        card.innerHTML = `<h4><span style="color:${color(group.movieId)}">M${movieIndex + 1}</span> ${escapeHTML(title)}${movie?.year ? ` <small>(${escapeHTML(movie.year)})</small>` : ''}</h4>`;
        container.append(card);
        return { card, title };
      });
      // Measure only after all columns exist, so the first map has the final width.
      groups.forEach((group, movieIndex) => {
        const { card, title } = cards[movieIndex];
        const width = card.clientWidth, sourceWidth = Math.min(170, Math.max(90, width * .26));
        const end = sourceWidth + Math.min(80, width * .12), spacing = 42, gap = group.matches.length > group.topCount ? 66 : 0;
        const height = 84 + group.matches.length * spacing + gap, center = height / 2;
        const y = i => 78 + i * spacing + (i >= group.topCount ? gap : 0);
        const svg = d3.select(card).append('svg').attr('viewBox', `0 0 ${width} ${height}`)
          .attr('role', 'group').attr('aria-label', `Top 5 and bottom 5 anime for ${title}`);
        svg.append('text').attr('x', 0).attr('y', 20).attr('class', 'connection-axis-label').text('YOUR MOVIE');
        svg.append('text').attr('x', end + 12).attr('y', 20).attr('class', 'connection-axis-label').text('ANIME · DUST RANK');
        svg.append('rect').attr('x', 0).attr('y', center - 45).attr('width', sourceWidth).attr('height', 90)
          .attr('rx', 10).attr('class', 'connection-movie-node').style('stroke', color(group.movieId));
        const source = svg.append('text').attr('x', 10).attr('y', center - 12).attr('class', 'connection-movie-title');
        lines(title, Math.max(8, Math.floor((sourceWidth - 20) / 7)), 3).forEach((line, i) =>
          source.append('tspan').attr('x', 10).attr('dy', i ? 16 : 0).text(line));
        source.append('title').text(title);
        svg.append('text').attr('x', end + 12).attr('y', 47).attr('class', 'recommendation-group-label')
          .text(`TOP ${group.topCount} · MOST SIMILAR`);
        if (gap) svg.append('text').attr('x', end + 12).attr('y', y(group.topCount) - 31)
          .attr('class', 'recommendation-group-label is-bottom').text(`BOTTOM ${group.matches.length - group.topCount} · LEAST SIMILAR`);
        if (group.omitted) svg.append('text').attr('x', end + 12).attr('y', y(group.topCount - 1) + 52)
          .attr('class', 'recommendation-gap-label').text(`⋮ Ranks ${group.topCount + 1}–${group.total - 5} omitted`);
        const rows = svg.selectAll('.recommendation-chart-row').data(group.matches).join('g')
          .attr('class', match => `recommendation-chart-row${match.group === 'bottom' ? ' is-bottom' : ''}`)
          .style('--dust-color', match => color(snapshot.movieIds[match.closest]))
          .attr('role', 'button').attr('tabindex', 0).attr('aria-haspopup', 'dialog').attr('aria-controls', 'detail-drawer')
          .attr('data-dust-connection-id', match => `${group.movieId}:${match.anime.id}`)
          .attr('aria-label', match => `${match.group === 'top' ? 'Top' : 'Bottom'} match, dust rank ${match.rank} of ${group.total}: ${match.anime.title}. ${title}: similarity ${match.similarity.toFixed(3)}. Open anime details.`)
          .on('click', (event, match) => onInspect(match.anime.id))
          .on('keydown', (event, match) => {
            if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onInspect(match.anime.id); }
          })
          .on('mouseenter focus', function () { d3.select(this).classed('is-preview', true); })
          .on('mouseleave blur', function () { d3.select(this).classed('is-preview', false); });
        rows.append('title').text(match => `${match.anime.title} · ${match.similarity.toFixed(3)}`);
        rows.append('path').attr('class', 'recommendation-mark connection-line')
          .attr('d', (match, i) => `M${sourceWidth},${center} C${sourceWidth + 40},${center} ${end - 40},${y(i)} ${end},${y(i)}`)
          .attr('stroke-width', match => 1 + 10 * Math.max(0, match.similarity));
        rows.append('rect').attr('x', end - 6).attr('y', (match, i) => y(i) - 18).attr('width', width - end + 6)
          .attr('height', 38).attr('rx', 7).attr('class', 'recommendation-row-background');
        rows.append('circle').attr('cx', end).attr('cy', (match, i) => y(i)).attr('r', 3).attr('class', 'recommendation-dot');
        rows.each(function (match, i) {
          const row = d3.select(this), x = end + 12;
          // Reserve a fixed score column so long titles cannot overlap the numbers.
          const titleLines = lines(`${match.rank} · ${match.anime.title}`, Math.max(1, Math.floor((width - x - 64) / 6.5)));
          const label = row.append('text').attr('x', x).attr('y', y(i) + 4 - (titleLines.length - 1) * 7)
            .attr('class', 'recommendation-chart-label');
          titleLines.forEach((line, index) =>
            label.append('tspan').attr('x', x).attr('dy', index ? 14 : 0).text(line));
          row.append('text').attr('x', width - 8).attr('y', y(i) + 4).attr('text-anchor', 'end')
            .attr('class', 'recommendation-chart-score').text(match.similarity.toFixed(3));
        });
      });
      if (focused) container.querySelector(`[data-dust-connection-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }
    return { update, pause() { latest = null; }, destroy() {
      observer?.disconnect(); latest = null; container.replaceChildren();
    } };
  }
  return { movieConnections, create };
});
