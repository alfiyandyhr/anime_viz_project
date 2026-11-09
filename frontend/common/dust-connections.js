"use strict";

// Compare the active magnet against the displayed dust.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AnivizDustConnections = api;
})(globalThis, function () {
  function movieConnections(snapshot, magnetIndex) {
    // Local ranks follow visible dust membership, independently of table sorting.
    return snapshot.displayedDust.slice().sort((a, b) =>
      b.scores[magnetIndex] - a.scores[magnetIndex] || a.index - b.index)
      .map((match, i) => ({ ...match, rank: i + 1, similarity: match.scores[magnetIndex] }));
  }

  function create({ container, d3, color, onSelect, onCoverage, renderEmpty }) {
    let selectedMagnetKey, offsets = [0, 0], drawLines;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawLines?.()) : null;
    observer?.observe(container);

    function update(value, resetMemberScroll = false) {
      const { snapshot } = value;
      const { magnets, magnetKeys, displayedDust, selectedKeys } = snapshot;
      const noun = snapshot.direction === 'anime-to-movies' ? 'movies' : 'anime';
      const focused = document.activeElement;
      const focusKey = ['data-dust-connection-movie', 'data-dust-connection-id', 'data-dust-connection-panel',
        'data-dust-member-movie', 'data-dust-member-id', 'data-dust-member-scroll']
        .find(attr => focused?.hasAttribute(attr));
      let magnetIndex = magnetKeys.indexOf(selectedMagnetKey);
      const memberScrollTop = resetMemberScroll || magnetIndex === -1 ? 0
        : container.querySelector('.dust-member-scroll')?.scrollTop ?? 0;
      if (magnetIndex === -1) {
        magnetIndex = 0;
        selectedMagnetKey = magnetKeys[0];
        offsets = [0, 0];
      }
      container.replaceChildren();
      drawLines = null;
      const magnet = magnets[magnetIndex];
      const cohortLabel = magnet?.kind === 'genre' ? AnivizDust.magnetScoreLabel(magnet) : '';
      onCoverage(`${displayedDust.length} displayed ${noun} · ${cohortLabel || 'Signed cosine similarity'}.`);
      if (!magnetKeys.length || !displayedDust.length) {
        offsets = [0, 0];
        renderEmpty(container, magnetKeys.length ? `No ${noun} match the current dust filters. Broaden or reset filters to see connections.`
          : `Add a magnet to compare its most and least similar ${noun}.`);
        return;
      }

      const ranking = movieConnections(snapshot, magnetIndex);
      const isSelected = match => selectedKeys.includes(match.key);
      const titleFor = index => magnets[index].title;
      const midpoint = Math.ceil(ranking.length / 2);
      const max = ranking[0].similarity, min = ranking.at(-1).similarity;
      const title = titleFor(magnetIndex);
      const comparison = d3.select(container).append('div').attr('class', 'dust-connection-comparison');
      const card = comparison.append('section').attr('class', 'dust-connection-map')
        .attr('aria-label', `Similarity connections for ${title}`);
      const svg = card.append('svg').attr('class', 'dust-connection-lines')
        .attr('aria-hidden', 'true').attr('focusable', 'false');
      function magnetButtons(parent, className, dataAttribute) {
        const buttons = parent.append('div').attr('class', className)
          .attr('role', 'group').attr('aria-label', 'Magnets')
          .selectAll('button').data(magnetKeys).join('button')
          .attr('type', 'button').attr('class', 'dust-connection-magnet')
          .attr(dataAttribute, id => id).attr('title', (_, i) => titleFor(i))
          .attr('aria-pressed', id => id === selectedMagnetKey).style('--magnet-color', color)
          .on('click', (event, id) => {
            if (id === selectedMagnetKey) return;
            selectedMagnetKey = id;
            offsets = [0, 0];
            update(value, true);
          });
        buttons.append('strong').text((_, i) => `M${i + 1}`);
        buttons.append('span').text((_, i) => titleFor(i));
        return buttons;
      }
      const active = magnetButtons(card, 'dust-connection-magnets', 'data-dust-connection-movie').nodes()[magnetIndex];

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
          .style('--dust-color', match => color(magnetKeys[match.closest]))
          .attr('data-dust-connection-id', match => `${selectedMagnetKey}:${match.key}`)
          .attr('aria-pressed', isSelected)
          .attr('aria-haspopup', match => isSelected(match) ? null : 'dialog')
          .attr('aria-controls', 'recommendation-detail detail-drawer')
          .attr('aria-label', match => `Dust rank ${match.rank} of ${ranking.length}: ${match.record.title}. ${AnivizDust.magnetScoreLabel(magnet)}: ${match.similarity}.`)
          .attr('title', match => match.record.title)
          .on('click', (event, match) => onSelect(match.key));
        rows.append('span').attr('class', 'dust-connection-dot').attr('aria-hidden', 'true');
        rows.append('span').attr('class', 'dust-connection-rank').text(match => match.rank);
        rows.append('span').attr('class', 'dust-connection-title').text(match => match.record.title);
        rows.append('span').attr('class', 'dust-connection-score').attr('title', match => cohortLabel ? `${cohortLabel}: ${match.similarity}` : `Cosine ${match.similarity}`).text(match => match.similarity.toFixed(3));
        const panel = list.node(), end = panel.scrollHeight - panel.clientHeight;
        panel.scrollTop = index === 0 ? offsets[index] : end - offsets[index];
        list.on('scroll', () => {
          if (!panel.isConnected) return;
          offsets[index] = index === 0 ? panel.scrollTop : panel.scrollHeight - panel.clientHeight - panel.scrollTop;
          drawLines?.();
        });
        return { panel, dots: rows.select('.dust-connection-dot').nodes() };
      }).filter(Boolean);

      const members = ranking.filter(match => match.closest === magnetIndex);
      const memberPanel = comparison.append('section').attr('class', 'dust-member-panel')
        .attr('aria-labelledby', 'dust-members-heading');
      memberPanel.append('h4').attr('id', 'dust-members-heading').text('Dust members');
      magnetButtons(memberPanel, 'dust-member-magnets', 'data-dust-member-movie');
      memberPanel.append('p').attr('class', 'dust-member-count').text(`${members.length} of ${displayedDust.length} displayed ${noun}`);
      if (members.length) {
        const scroll = memberPanel.append('div').attr('class', 'dust-member-scroll').attr('role', 'region')
          .attr('tabindex', 0).attr('aria-label', `Dust member ranking for ${title}`).attr('data-dust-member-scroll', '');
        const table = scroll.append('table').attr('aria-label', `Dust members for ${title}`)
          .style('--magnet-color', color(selectedMagnetKey));
        table.append('thead').append('tr').selectAll('th').data(['Rank', noun === 'movies' ? 'Movie' : 'Anime', cohortLabel || 'Similarity']).join('th')
          .attr('scope', 'col').text(label => label);
        const rows = table.append('tbody').selectAll('tr').data(members).join('tr')
          .classed('dust-member-selected', isSelected)
          .on('click', (event, match) => {
            event.currentTarget.querySelector('button').focus({ preventScroll: true });
            onSelect(match.key);
          });
        rows.append('td').text((_, index) => index + 1);
        rows.append('td').append('button').attr('type', 'button').attr('class', 'dust-member-title')
          .attr('data-dust-member-id', match => `${selectedMagnetKey}:${match.key}`)
          .attr('aria-pressed', isSelected).attr('aria-haspopup', match => isSelected(match) ? null : 'dialog')
          .attr('aria-controls', 'recommendation-detail detail-drawer').text(match => match.record.title);
        rows.append('td').attr('class', 'dust-member-score').attr('title', match => cohortLabel ? `${cohortLabel}: ${match.similarity}` : `Cosine ${match.similarity}`).text(match => match.similarity.toFixed(3));
        scroll.node().scrollTop = memberScrollTop;
      } else {
        memberPanel.append('p').attr('class', 'dust-member-empty').text(`None of the displayed ${noun} are closest to ${title}.`);
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
        svg.selectAll('path').data(visible, row => row.match.key).join('path')
          .attr('d', row => {
            const bend = x + (row.x - x) * .55;
            return `M${x},${y} C${bend},${y} ${bend},${row.y} ${row.x},${row.y}`;
          })
          .attr('stroke', row => color(magnetKeys[row.match.closest]))
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
