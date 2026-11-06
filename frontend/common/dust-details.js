"use strict";
// Inline evidence for the dust selection; outside-corpus-row inspection stays separate.
(function (root) {
  function render({ snapshot, movies, externalId, color, helpers }) {
    const { escapeHTML: escape, escapeAttribute: attr, humanize, formatNumber } = helpers;
    const selected = snapshot.selectedAnimeIds.map(id => snapshot.ranking.find(row => String(row.anime.id) === id)).filter(Boolean);
    const outside = externalId && snapshot.ranking.find(row => String(row.anime.id) === externalId);
    const animeFor = match => snapshot.lookup.get(String(match.anime.id))?.anime || match.anime;
    const number = value => Number.isFinite(value) ? formatNumber(value) : 'Unknown';
    const score = (value, min, max, label, exact = label) => Number.isFinite(value)
      ? `<span class="dust-metric-value"${exact !== label ? ` tabindex="0" title="${attr(exact)}" aria-label="${attr(exact)}"` : ''}>${escape(label)}</span><meter min="${min}" max="${max}" value="${value}" aria-label="${attr(exact)}"></meter>` : 'Unknown';
    const evidence = anime => `<details class="dust-title-evidence"><summary>Synopsis, tags &amp; sampled cast</summary>
      <p>${escape(anime.synopsis || anime.description || 'Synopsis unavailable.')}</p>
      <div class="genre-list">${(anime.tags || []).map(tag => `<span class="tag">${escape(tag)}</span>`).join('') || 'No tags available.'}</div>
      <h4>Japanese sampled voice credits</h4><ul>${(anime.voice_actors || []).map(actor => `<li>${escape(actor.name)}${actor.characters?.length ? ` — ${escape(actor.characters.join(', '))}` : ''}</li>`).join('') || '<li>Cast metadata unavailable.</li>'}</ul>
      <a href="${attr(anime.url || anime.site_url || `https://anilist.co/anime/${anime.id}`)}" target="_blank" rel="noopener noreferrer">Explore on AniList ↗</a></details>`;
    function table(matches, comparison) {
      const anime = matches.map(animeFor), values = anime.map(root.AnivizChartData.comparisonValues);
      const runtimeMax = Math.max(1, ...values.map(row => row.runtime || 0));
      const rows = [
        ['Format / year', value => `${value.format ? escape(humanize(value.format)) : 'Unknown'} / ${value.year ?? 'Unknown'}`],
        ['Episodes', value => value.episodes ? `${number(value.episodes)}${value.duration ? ` × ${number(value.duration)} min` : ''}` : 'Unknown'],
        ['Estimated runtime', value => score(value.runtime, 0, runtimeMax, `${number(value.runtime)} min`)],
        ['AniList score', value => score(value.score, 0, 100, `${number(value.score)} / 100`)],
        ['Status', value => value.status ? escape(humanize(value.status)) : 'Unknown'],
        ...movies.map((movie, index) => [`M${index + 1} · ${movie.title}`, (_, i) => score(matches[i].scores[index], -1, 1, matches[i].scores[index].toFixed(3), `Cosine ${matches[i].scores[index]}`)]),
        ['Average cosine similarity', (_, i) => score(matches[i].score, -1, 1, matches[i].score.toFixed(3), `Average cosine ${matches[i].score}`)]
      ];
      return `<div class="dust-comparison-scroll" role="region" tabindex="0" aria-label="${comparison ? 'Selected anime comparison' : 'Anime details'}, scroll horizontally">
        <table class="dust-comparison-table"><caption class="sr-only">${comparison ? 'Selected anime comparison' : 'Anime details and similarities'}</caption>
        <thead><tr><th scope="col">${comparison ? 'Compare anime' : 'Anime details'}</th>${anime.map(item => `<th scope="col">${escape(item.title)}${comparison ? `<button type="button" class="small-button ghost" data-dust-remove="${attr(item.id)}" aria-label="Remove ${attr(item.title)} from comparison">Remove</button>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, cell], index) => `<tr${index >= 5 && index < 5 + movies.length ? ` style="--magnet-color:${color(movies[index - 5].id)}" class="dust-movie-metric"` : ''}><th scope="row">${escape(label)}</th>${values.map((value, i) => `<td>${cell(value, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="table-note">Runtime = episodes × minutes per episode. Unknown values are omitted from bars. Cosine scale: 0 to 1; scores are not percentages.</p>
        ${comparison ? '' : anime.map(item => `<div class="dust-selected-story"><p>${escape((item.genres || []).join(' · '))}</p>${evidence(item)}</div>`).join('')}`;
    }
    // Keep the focus on the latest selected dust, independently of ranking inspection.
    const focused = selected.at(-1), anime = focused && animeFor(focused);
    const cover = anime?.cover?.extra_large || anime?.cover?.large || '';
    const banner = anime?.banner_image || cover;
    const tags = anime?.tags || [];
    const focusHtml = anime ? `<p class="chart-kicker">Anime in focus</p>
      <div class="dust-focus-hero">
        ${banner ? `<img class="detail-banner" src="${attr(banner)}" alt="">` : ''}
        ${cover ? `<img class="detail-cover" src="${attr(cover)}" alt="Cover for ${attr(anime.title)}">` : ''}
      </div>
      <h3 aria-live="polite">${escape(anime.title)}</h3>
      <p class="recommendation-detail-meta">${escape(humanize(anime.format || 'Unknown'))} · ${anime.year || 'Year unknown'}</p>
      <div class="dust-detail-scores">${movies.map((movie, index) => `<div style="--magnet-color:${color(movie.id)}"><span><i></i>${escape(movie.title)}</span><strong>${focused.scores[index].toFixed(3)}</strong></div>`).join('')}<small>Cosine similarity · higher means closer</small></div>
      <div class="genre-list">${(anime.genres || []).map(genre => `<span class="tag">${escape(genre)}</span>`).join('')}</div>
      <div class="dust-story"><h4>Storyline</h4><p>${escape(anime.synopsis || anime.description || 'No synopsis available for this anime.')}</p></div>
      <div class="recommendation-context"><h4>Story tags</h4><div class="genre-list">${tags.slice(0, 8).map(tag => `<span class="tag">${escape(tag)}</span>`).join('') || '<small>No tags available.</small>'}</div>
        ${tags.length > 8 ? `<details class="dust-more-tags"><summary>All ${tags.length} tags</summary><div class="genre-list">${tags.slice(8).map(tag => `<span class="tag">${escape(tag)}</span>`).join('')}</div></details>` : ''}</div>
      <div class="recommendation-context"><h4>Japanese sampled voice credits</h4><ul>${(anime.voice_actors || []).map(actor => `<li>${escape(actor.name)}${actor.characters?.length ? ` — ${escape(actor.characters.join(', '))}` : ''}</li>`).join('') || '<li>Cast metadata unavailable.</li>'}</ul></div>
      <a class="button button-secondary" href="${attr(anime.url || anime.site_url || `https://anilist.co/anime/${anime.id}`)}" target="_blank" rel="noopener noreferrer">Explore on AniList ↗</a>`
      : '<div class="dust-detail-placeholder"><p class="chart-kicker">Anime in focus</p><h3>Every dot has a story.</h3><p>Click any anime dot to discover its storyline, genres, tags, and similarity to your movies.</p></div>';
    return {
      count: selected.length,
      focusHtml,
      html: (selected.length ? `<section aria-label="Selected dust anime"><div class="dust-details-heading"><h3>${selected.length > 1 ? `Comparing ${selected.length} anime` : escape(animeFor(selected[0]).title)}</h3><button type="button" class="small-button ghost" data-dust-clear>Clear selection</button></div>${table(selected, true)}</section>` : '')
        + (outside ? `<section class="dust-outside-detail" aria-label="Ranking anime details"><div class="dust-details-heading"><h3>${escape(animeFor(outside).title)}</h3><button type="button" class="small-button ghost" data-dust-close>Close details</button></div><p>Ranking inspection · outside the displayed dust set. This title is not in your dust comparison.</p>${table([outside], false)}</section>` : '')
    };
  }
  root.AnivizDustDetails = { render };
})(globalThis);
