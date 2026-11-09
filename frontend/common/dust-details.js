"use strict";
// Inline comparison follows the selected dust. Movie inspection reuses the focus evidence.
(function (root) {
  // AniList covers for recommendation titles absent from the dashboard catalogue.
  const coverFallbacks = new Map([
    ['175872', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx175872-d55nfiC4WWHO.jpg'],
    ['195516', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx195516-MJpUZlOberqH.jpg'],
    ['195604', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx195604-tSZcfKbVqSEG.jpg']
  ]);

  function renderMovie({ record, match, magnets, color, helpers, heading = 'h3' }) {
    const { escapeHTML: escape, escapeAttribute: attr } = helpers;
    return `<${heading}>${escape(record.title)}</${heading}>
      <p class="recommendation-detail-meta">${record.year || 'Year unknown'}</p>
      ${magnetScores(match, magnets, color, helpers, { exactEvidence: false })}
      <div class="genre-list">${(record.genres || []).map(genre => `<span class="tag">${escape(genre)}</span>`).join('')}</div>
      <div class="dust-story"><h4>Storyline</h4><p>${escape(record.synopsis || 'No synopsis available for this movie.')}</p></div>
      <div class="recommendation-context"><h4>Keywords</h4><div class="genre-list">${(record.tags || []).map(tag =>
        `<span class="tag">${escape(tag)}</span>`).join('') || '<small>No keywords available.</small>'}</div></div>
      <a class="button button-secondary" href="${attr(record.url || `https://www.themoviedb.org/movie/${record.id}`)}" target="_blank" rel="noopener noreferrer">View on TMDB ↗</a>`;
  }

  function magnetScores(match, magnets, color, { escapeHTML: escape, escapeAttribute: attr },
    { exactEvidence = true } = {}) {
    if (!match) return '';
    return `<div class="dust-detail-scores">${magnets.map((magnet, index) => {
      const score = match.scores[index];
      const rounded = score.toFixed(3);
      const cohort = magnet.kind === 'genre';
      const name = cohort ? root.AnivizDust.magnetScoreLabel(magnet) : magnet.title;
      const label = attr(cohort ? `${name}: ${score}` : `Cosine ${exactEvidence ? score : rounded}`);
      return `<div style="--magnet-color:${color(magnet.key)}"><span><i></i>${escape(name)}</span><strong tabindex="0" title="${label}" aria-label="${label}">${rounded}</strong></div>`;
    }).join('')}<small>Cosine similarity · higher means closer</small></div>`;
  }

  function render({ snapshot, color, helpers }) {
    const { escapeHTML: escape, escapeAttribute: attr, humanize, formatNumber } = helpers;
    const { magnets } = snapshot;
    const reverse = snapshot.direction === 'anime-to-movies';
    const noun = reverse ? 'movies' : 'anime';
    const selected = snapshot.selectedKeys.map(key => snapshot.displayedDust.find(row => row.key === key)).filter(Boolean);
    const recordFor = match => snapshot.lookup.get(match.key)?.record || match.record;
    const number = value => Number.isFinite(value) ? formatNumber(value) : 'Unknown';
    const score = (value, min, max, label, exact = label) => Number.isFinite(value)
      ? `<span class="dust-metric-value"${exact !== label ? ` tabindex="0" title="${attr(exact)}" aria-label="${attr(exact)}"` : ''}>${escape(label)}</span><meter min="${min}" max="${max}" value="${value}" aria-label="${attr(exact)}"></meter>` : 'Unknown';
    function table(matches) {
      const records = matches.map(recordFor);
      const values = reverse ? records : records.map(root.AnivizChartData.comparisonValues);
      const runtimeMax = Math.max(1, ...values.map(row => row.runtime || 0));
      const metadataRows = reverse ? [
        ['Release year', value => value.year ?? 'Unknown'],
        ['Genres', value => escape(value.genres?.join(', ') || 'Unknown')]
      ] : [
        ['Format / year', value => `${value.format ? escape(humanize(value.format)) : 'Unknown'} / ${value.year ?? 'Unknown'}`],
        ['Episodes', value => value.episodes ? `${number(value.episodes)}${value.duration ? ` × ${number(value.duration)} min` : ''}` : 'Unknown'],
        ['Estimated runtime', value => score(value.runtime, 0, runtimeMax, `${number(value.runtime)} min`)],
        ['AniList score', value => score(value.score, 0, 100, `${number(value.score)} / 100`)],
        ['Status', value => value.status ? escape(humanize(value.status)) : 'Unknown']
      ];
      const rows = [
        ...metadataRows,
        ...magnets.map((magnet, index) => {
          const cohort = magnet.kind === 'genre';
          const label = cohort ? root.AnivizDust.magnetScoreLabel(magnet) : magnet.title;
          return [`M${index + 1} · ${label}`, (_, i) => {
            const value = matches[i].scores[index];
            return score(value, -1, 1, value.toFixed(3), cohort ? `${label}: ${value}` : `Cosine ${value}`);
          }];
        }),
        ['Average cosine similarity', (_, i) => score(matches[i].score, -1, 1, matches[i].score.toFixed(3), `Average cosine ${matches[i].score}`)]
      ];
      return `<div class="dust-comparison-scroll" role="region" tabindex="0" aria-label="Selected ${noun} comparison, scroll horizontally">
        <table class="dust-comparison-table"><caption class="sr-only">Selected ${noun} comparison</caption>
        <thead><tr><th scope="col">Compare ${noun}</th>${records.map((item, i) => {
          const cover = !reverse && (item.cover?.medium || item.cover?.large || item.cover?.extra_large || coverFallbacks.get(String(item.id)));
          return `<th scope="col">
            ${cover ? `<img class="dust-comparison-cover" src="${attr(cover)}" alt="" width="40" height="56">` : ''}
            ${escape(item.title)}
            <button type="button" class="small-button ghost" data-dust-remove="${attr(matches[i].key)}" aria-label="Remove ${attr(item.title)} from comparison">Remove</button>
          </th>`;
        }).join('')}</tr></thead>
        <tbody>${rows.map(([label, cell], index) => `<tr${index >= metadataRows.length && index < metadataRows.length + magnets.length ? ` style="--magnet-color:${color(magnets[index - metadataRows.length].key)}" class="dust-movie-metric"` : ''}><th scope="row">${escape(label)}</th>${values.map((value, i) => `<td>${cell(value, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="table-note">${reverse ? '' : 'Estimated runtime multiplies episodes by minutes per episode. '}Cosine scores range from −1 to 1.</p>`;
    }
    const focused = selected.at(-1);
    const record = focused && recordFor(focused);
    const cover = record?.cover?.extra_large || record?.cover?.large || '';
    const banner = record?.banner_image || cover;
    const tags = record?.tags || [];
    const focusLabel = reverse ? 'Movie in focus' : 'Anime in focus';
    const placeholder = `<div class="dust-detail-placeholder"><p class="chart-kicker">${focusLabel}</p><h3>Every dot has a story.</h3><p>Select a dot to explore its storyline, genres, and similarity to your magnets.</p></div>`;
    const animeHtml = !reverse && record ? `<p class="chart-kicker">${focusLabel}</p>
      <div class="dust-focus-hero">
        ${banner ? `<img class="detail-banner" src="${attr(banner)}" alt="">` : ''}
        ${cover ? `<img class="detail-cover" src="${attr(cover)}" alt="Cover for ${attr(record.title)}">` : ''}
      </div>
      <h3 aria-live="polite">${escape(record.title)}</h3>
      <p class="recommendation-detail-meta">${escape(humanize(record.format || 'Unknown'))} · ${record.year || 'Year unknown'}</p>
      ${magnetScores(focused, magnets, color, helpers)}
      <div class="genre-list">${(record.genres || []).map(genre => `<span class="tag">${escape(genre)}</span>`).join('')}</div>
      <div class="dust-story"><h4>Storyline</h4><p>${escape(record.synopsis || record.description || 'No synopsis available for this anime.')}</p></div>
      <div class="recommendation-context"><h4>Story tags</h4><div class="genre-list">${tags.slice(0, 8).map(tag => `<span class="tag">${escape(tag)}</span>`).join('') || '<small>No tags available.</small>'}</div>
        ${tags.length > 8 ? `<details class="dust-more-tags"><summary>All ${tags.length} tags</summary><div class="genre-list">${tags.slice(8).map(tag => `<span class="tag">${escape(tag)}</span>`).join('')}</div></details>` : ''}</div>
      <div class="recommendation-context"><h4>Japanese sampled voice credits</h4><ul>${(record.voice_actors || []).map(actor => `<li>${escape(actor.name)}${actor.characters?.length ? ` — ${escape(actor.characters.join(', '))}` : ''}</li>`).join('') || '<li>Cast metadata unavailable.</li>'}</ul></div>
      <a class="button button-secondary" href="${attr(record.url || record.site_url || `https://anilist.co/anime/${record.id}`)}" target="_blank" rel="noopener noreferrer">Explore on AniList ↗</a>`
      : '';
    const movieHtml = reverse && record ? `<p class="chart-kicker">${focusLabel}</p>${renderMovie({
      record, match: focused, magnets, color, helpers
    })}` : '';
    return {
      count: selected.length,
      focusHtml: movieHtml || animeHtml || placeholder,
      html: selected.length ? `<section aria-label="Selected dust ${noun}"><div class="dust-details-heading"><h3>${selected.length > 1 ? `Comparing ${selected.length} ${noun}` : escape(recordFor(selected[0]).title)}</h3><button type="button" class="small-button ghost" data-dust-clear>Clear selection</button></div>${table(selected)}</section>` : ''
    };
  }
  root.AnivizDustDetails = { render, renderMovie, magnetScores };
})(globalThis);
