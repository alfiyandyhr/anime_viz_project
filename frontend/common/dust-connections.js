"use strict";

// Compare the selected movie against the same anime shown in the dust field.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizDustConnections = api;
})(globalThis, function () {
  function movieConnections(snapshot, movieIndex) {
    // Local ranks follow visible dust membership, independently of table sorting.
    return snapshot.displayedDust.slice().sort((a, b) =>
      b.scores[movieIndex] - a.scores[movieIndex] || a.index - b.index)
      .map((match, i) => ({ ...match, rank: i + 1, similarity: match.scores[movieIndex] }));
  }

  function create({ container, d3, color, onSelect, onCoverage, renderEmpty }) {
    let selectedMovieId, offsets = [0, 0], drawLines;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawLines?.()) : null;
    observer?.observe(container);

    function update(value, resetMemberScroll = false) {
      const { snapshot, movies } = value;
      const { movieIds, displayedDust, selectedAnimeIds } = snapshot;
      const focused = document.activeElement;
      const focusKey = ['data-dust-connection-movie', 'data-dust-connection-id', 'data-dust-connection-panel',
        'data-dust-member-movie', 'data-dust-member-id', 'data-dust-member-scroll']
        .find(attr => focused?.hasAttribute(attr));
      let movieIndex = movieIds.indexOf(selectedMovieId);
      const memberScrollTop = resetMemberScroll || movieIndex === -1 ? 0
        : container.querySelector('.dust-member-scroll')?.scrollTop ?? 0;
      if (movieIndex === -1) {
        movieIndex = 0;
        selectedMovieId = movieIds[0];
        offsets = [0, 0];
      }
      container.replaceChildren();
      drawLines = null;
      onCoverage(`${displayedDust.length} displayed anime · Similarity scores are not percentages.`);
      if (!movieIds.length || !displayedDust.length) {
        offsets = [0, 0];
        renderEmpty(container, movieIds.length ? 'No anime match the current dust filters. Broaden or reset filters to see connections.'
          : 'Add a movie to compare its most and least similar anime.');
        return;
      }

      const ranking = movieConnections(snapshot, movieIndex);
      const isSelected = match => selectedAnimeIds.includes(String(match.anime.id));
      const titleFor = index => movies[index]?.title || `Movie ${index + 1}`;
      const midpoint = Math.ceil(ranking.length / 2);
      const max = ranking[0].similarity, min = ranking.at(-1).similarity;
      const title = titleFor(movieIndex);
      const comparison = d3.select(container).append('div').attr('class', 'dust-connection-comparison');
      const card = comparison.append('section').attr('class', 'dust-connection-map')
        .attr('aria-label', `Similarity connections for ${title}`);
      const svg = card.append('svg').attr('class', 'dust-connection-lines')
        .attr('aria-hidden', 'true').attr('focusable', 'false');
      function magnetButtons(parent, className, dataAttribute) {
        const buttons = parent.append('div').attr('class', className)
          .attr('role', 'group').attr('aria-label', 'Movie magnets')
          .selectAll('button').data(movieIds).join('button')
          .attr('type', 'button').attr('class', 'dust-connection-magnet')
          .attr(dataAttribute, id => id).attr('title', (_, i) => titleFor(i))
          .attr('aria-pressed', id => id === selectedMovieId).style('--magnet-color', color)
          .on('click', (event, id) => {
            if (id === selectedMovieId) return;
            selectedMovieId = id;
            offsets = [0, 0];
            update(value, true);
          });
        buttons.append('strong').text((_, i) => `M${i + 1}`);
        buttons.append('span').text((_, i) => titleFor(i));
        return buttons;
      }
      const active = magnetButtons(card, 'dust-connection-magnets', 'data-dust-connection-movie').nodes()[movieIndex];

      const panels = card.append('div').attr('class', 'dust-connection-panels');
      const lists = [ranking.slice(0, midpoint), ranking.slice(midpoint)].map((matches, index) => {
        if (!matches.length) return null;
        const label = index === 0 ? 'Most similar' : 'Least similar';
        const ranks = matches.length === 1 ? `Rank ${matches[0].rank}` : `Ranks ${matches[0].rank}–${matches.at(-1).rank}`;
        const section = panels.append('div').attr('class', 'dust-connection-panel');
        const heading = section.append('h4');
        heading.append('strong').text(label);
        heading.append('span').text(ranks);
        const list = section.append('div').attr('class', 'dust-connection-list').attr('role', 'region')
          .attr('tabindex', 0).attr('aria-label', `${label}, ${ranks}`)
          .attr('data-dust-connection-panel', index);
        const rows = list.selectAll('button').data(matches).join('button')
          .attr('type', 'button').attr('class', 'dust-connection-row')
          .style('--dust-color', match => color(movieIds[match.closest]))
          .attr('data-dust-connection-id', match => `${selectedMovieId}:${match.anime.id}`)
          .attr('aria-pressed', isSelected)
          .attr('aria-haspopup', match => isSelected(match) ? null : 'dialog')
          .attr('aria-controls', 'recommendation-detail detail-drawer')
          .attr('aria-label', match => `Dust rank ${match.rank} of ${ranking.length}: ${match.anime.title}. Similarity to ${title}: ${match.similarity.toFixed(3)}.`)
          .attr('title', match => match.anime.title)
          .on('click', (event, match) => onSelect(match.anime.id));
        rows.append('span').attr('class', 'dust-connection-dot').attr('aria-hidden', 'true');
        rows.append('span').attr('class', 'dust-connection-rank').text(match => match.rank);
        rows.append('span').attr('class', 'dust-connection-title').text(match => match.anime.title);
        rows.append('span').attr('class', 'dust-connection-score').text(match => match.similarity.toFixed(3));
        const panel = list.node(), end = panel.scrollHeight - panel.clientHeight;
        panel.scrollTop = index === 0 ? offsets[index] : end - offsets[index];
        list.on('scroll', () => {
          if (!panel.isConnected) return;
          offsets[index] = index === 0 ? panel.scrollTop : panel.scrollHeight - panel.clientHeight - panel.scrollTop;
          drawLines?.();
        });
        return { panel, dots: rows.select('.dust-connection-dot').nodes() };
      }).filter(Boolean);

      const members = ranking.filter(match => match.closest === movieIndex);
      const memberPanel = comparison.append('section').attr('class', 'dust-member-panel')
        .attr('aria-labelledby', 'dust-members-heading');
      memberPanel.append('h4').attr('id', 'dust-members-heading').text('Dust members');
      magnetButtons(memberPanel, 'dust-member-magnets', 'data-dust-member-movie');
      memberPanel.append('p').attr('class', 'dust-member-count').text(`${members.length} of ${displayedDust.length} displayed anime`);
      if (members.length) {
        const scroll = memberPanel.append('div').attr('class', 'dust-member-scroll').attr('role', 'region')
          .attr('tabindex', 0).attr('aria-label', `Dust member ranking for ${title}`).attr('data-dust-member-scroll', '');
        const table = scroll.append('table').attr('aria-label', `Dust members for ${title}`)
          .style('--magnet-color', color(selectedMovieId));
        table.append('thead').append('tr').selectAll('th').data(['Rank', 'Anime', 'Similarity']).join('th')
          .attr('scope', 'col').text(label => label);
        const rows = table.append('tbody').selectAll('tr').data(members).join('tr')
          .classed('dust-member-selected', isSelected)
          .on('click', (event, match) => {
            event.currentTarget.querySelector('button').focus({ preventScroll: true });
            onSelect(match.anime.id);
          });
        rows.append('td').text((_, index) => index + 1);
        rows.append('td').append('button').attr('type', 'button').attr('class', 'dust-member-title')
          .attr('data-dust-member-id', match => `${selectedMovieId}:${match.anime.id}`)
          .attr('aria-pressed', isSelected).attr('aria-haspopup', match => isSelected(match) ? null : 'dialog')
          .attr('aria-controls', 'recommendation-detail detail-drawer').text(match => match.anime.title);
        rows.append('td').attr('class', 'dust-member-score').text(match => match.similarity.toFixed(3));
        scroll.node().scrollTop = memberScrollTop;
      } else {
        memberPanel.append('p').attr('class', 'dust-member-empty').text(`None of the displayed anime are closest to ${title}.`);
      }

      drawLines = () => {
        if (!active.isConnected) return;
        const bounds = svg.node().getBoundingClientRect(), source = active.getBoundingClientRect();
        const x = source.right - bounds.left, y = (source.top + source.bottom) / 2 - bounds.top;
        const visible = lists.flatMap(({ panel, dots }) => {
          const { top, bottom } = panel.getBoundingClientRect();
          return dots.flatMap(dot => {
            const rect = dot.getBoundingClientRect(), center = (rect.top + rect.bottom) / 2;
            return center >= top && center < bottom
              ? [{ match: dot.__data__, x: (rect.left + rect.right) / 2 - bounds.left, y: center - bounds.top }]
              : [];
          });
        });
        svg.selectAll('path').data(visible, row => row.match.anime.id).join('path')
          .attr('d', row => {
            const bend = x + (row.x - x) * .55;
            return `M${x},${y} C${bend},${y} ${bend},${row.y} ${row.x},${row.y}`;
          })
          .attr('stroke', row => color(movieIds[row.match.closest]))
          .attr('stroke-width', row => max === min ? 5 : 1 + 8 * (row.match.similarity - min) / (max - min));
      };
      drawLines();

      if (focusKey) container.querySelector(`[${focusKey}="${CSS.escape(focused.getAttribute(focusKey))}"]`)
        ?.focus({ preventScroll: true });
    }
    return { update, destroy() {
      observer?.disconnect(); drawLines = null; container.replaceChildren();
    } };
  }
  return { movieConnections, create };
});
