"use strict";
// Inline comparison follows the selected dust. Movie inspection reuses the focus evidence.
(function (root) {
  function renderMovie({ record, match, magnets, color, helpers, heading = 'h3' }) {
    const { escapeHTML: escape, escapeAttribute: attr } = helpers;
    return `<${heading}${heading === 'h3' ? ' aria-live="polite"' : ''}>${escape(record.title)}</${heading}>
      <p class="recommendation-detail-meta">${record.year || 'Year unknown'}</p>
      ${magnetScores(match, magnets, color, helpers, { exactEvidence: false })}
      <div class="genre-list">${(record.genres || []).map(genre => `<span class="tag">${escape(genre)}</span>`).join('')}</div>
      <div class="dust-story"><h4>Storyline</h4><p>${escape(record.synopsis || 'No synopsis available for this movie.')}</p></div>
      ${root.AnivizMovieCredits.render(record, escape, heading === 'h3' ? 'h4' : 'h3')}
      <div class="recommendation-context"><h4>Keywords</h4><div class="genre-list">${(record.tags || []).map(tag =>
        `<span class="tag">${escape(tag)}</span>`).join('') || '<small>No keywords available.</small>'}</div></div>
      <a class="button button-secondary" href="${attr(record.url || `https://www.themoviedb.org/movie/${record.id}`)}" target="_blank" rel="noopener noreferrer">View on TMDB ↗</a>`;
  }

  function magnetScores(match, magnets, color, { escapeHTML: escape, escapeAttribute: attr },
    { exactEvidence = true } = {}) {
    if (!match) return '';
    const mixed = magnets.some(root.AnivizDust.isMetricMagnet);
    return `<div class="dust-detail-scores">${magnets.map((magnet, index) => {
      const score = match.scores[index];
      if (mixed) {
        const label = attr(root.AnivizDust.mixedEvidence(match, magnet, index));
        const name = root.AnivizDust.magnetScoreLabel(magnet);
        return `<div style="--magnet-color:${color(magnet.key)}"><span><i></i>${escape(name)} <b>${root.AnivizDust.formatRawScore(match.rawScores[index], magnet)}</b></span><strong tabindex="0" title="${label}" aria-label="${label}">${root.AnivizDust.formatPercentile(score)}</strong></div>`;
      }
      const rounded = root.AnivizDust.formatPercentile(score);
      const cohort = magnet.kind === 'genre';
      const name = cohort ? root.AnivizDust.magnetScoreLabel(magnet) : magnet.title;
      const label = attr(!Number.isFinite(score) ? rounded
        : cohort ? `${name}: ${score}` : `Cosine ${exactEvidence ? score : rounded}`);
      return `<div style="--magnet-color:${color(magnet.key)}"><span><i></i>${escape(name)}</span><strong tabindex="0" title="${label}" aria-label="${label}">${rounded}</strong></div>`;
    }).join('')}<small>${mixed ? `Right column: attraction percentile (0–1)<br>${root.AnivizDust.averageLabel(true)}: ${root.AnivizDust.formatPercentile(match.score)}` : match.record.memberIds ? 'Mean signed cosine similarity' : 'Cosine similarity · higher means closer'}</small></div>`;
  }

  function groupCoverage(match, direction, index, magnet) {
    const count = match.record.memberIds.length;
    const titles = `${count} catalogue ${root.AnivizDust.titleNoun(direction, count)}`;
    if (index === undefined || magnet?.kind === 'title-count') return titles;
    return `${match.contributingCounts[index]} of ${titles} ${magnet?.kind === 'anime-genre' ? 'in this genre' : 'scored'}`;
  }

  function renderGroup({ snapshot, match, color, helpers, heading = 'h3' }) {
    const { escapeHTML: escape, escapeAttribute: attr } = helpers;
    const { record } = match;
    const { direction, magnets } = snapshot;
    const movie = root.AnivizDust.isMovieDust(direction);
    const studio = direction === root.AnivizDust.STUDIOS;
    const writer = direction === root.AnivizDust.MOVIE_WRITERS;
    const provider = root.AnivizDust.DIRECTIONS[direction].dust;
    const noun = root.AnivizDust.titleNoun(direction);
    const credit = writer ? 'TMDB Writing department credits'
      : movie ? 'Sampled TMDB cast credits' : studio ? 'AniList main-studio credits' : 'AniList Japanese main-role credits';
    const workAttribute = studio ? 'data-studio-work' : writer ? 'data-writer-work' : 'data-actor-work';
    const image = movie ? root.AnivizArtwork.moviePortrait(record) : record.image;
    const portrait = root.AnivizArtwork.detailHero('', image, `Portrait of ${record.title}`, attr);
    const link = movie ? `https://www.themoviedb.org/person/${attr(record.id)}`
      : `https://anilist.co/${studio ? 'studio' : 'staff'}/${attr(record.id)}`;
    const supporting = match.supportingWorks.slice(0, 5).map(work => ({
      ...work, title: snapshot.titleLookup.get(`${provider}:${work.id}`).record.title
    }));
    const evidenceTitle = snapshot.magnets.some(magnet => !root.AnivizDust.isMetricMagnet(magnet))
      ? `Strongest supporting ${noun} by mean story similarity` : `${movie ? 'Movies' : 'Anime'} with metric data (up to five)`;
    return `${portrait}<${heading}>${escape(record.title)}</${heading}>
      <p class="recommendation-detail-meta">${groupCoverage(match, direction, magnets.length === 1 ? 0 : undefined, magnets[0])} · ${credit}</p>
      ${magnetScores(match, snapshot.magnets, color, helpers)}
      <div class="recommendation-context"><h4>${evidenceTitle}</h4>
        ${supporting.length ? `<ul>${supporting.map(work => `<li><button type="button" class="recommendation-title-button" ${workAttribute}="${provider}:${attr(work.id)}" aria-haspopup="dialog" aria-controls="detail-drawer">${escape(work.title)}</button>${Number.isFinite(work.similarity) ? ` · ${work.similarity.toFixed(3)}` : ''}</li>`).join('')}</ul>` : '<p>No title scores are available for this view.</p>'}</div>
      <a class="button button-secondary" href="${link}" target="_blank" rel="noopener noreferrer">Explore on ${movie ? 'TMDB' : 'AniList'} ↗</a>`;
  }

  function render({ snapshot, focusedMagnet, color, helpers }) {
    const { escapeHTML: escape, escapeAttribute: attr, humanize, formatNumber } = helpers;
    const { dustThumbnail, detailHero, movieHero } = root.AnivizArtwork;
    const { magnets, mixed } = snapshot;
    const reverse = root.AnivizDust.isMovieDust(snapshot.direction);
    const titleNoun = root.AnivizDust.titleNoun(snapshot.direction);
    const group = root.AnivizDust.groupFor(snapshot.direction);
    const noun = group?.noun || titleNoun;
    const selected = snapshot.selectedKeys.map(key => snapshot.displayedDust.find(row => row.key === key)).filter(Boolean);
    const recordFor = match => snapshot.lookup.get(match.key)?.record || match.record;
    const number = value => Number.isFinite(value) ? formatNumber(value) : 'Unknown';
    const score = (value, min, max, label, exact = label) => Number.isFinite(value)
      ? `<span class="dust-metric-value"${exact !== label ? ` tabindex="0" title="${attr(exact)}" aria-label="${attr(exact)}"` : ''}>${escape(label)}</span><meter min="${min}" max="${max}" value="${value}" aria-label="${attr(exact)}"></meter>` : 'Unknown';
    function table(matches) {
      const records = matches.map(recordFor);
      const values = reverse || group ? records : records.map(root.AnivizChartData.comparisonValues);
      const runtimeMax = Math.max(1, ...values.map(row => Number.isFinite(row.runtime) ? row.runtime : 0));
      const metadataRows = group ? [
        [`Catalogue ${titleNoun}`, value => number(value.memberIds.length)],
        ['Average score', value => Number.isFinite(value.averageScore) ? `${value.averageScore.toFixed(1)} / ${reverse ? 10 : 100}` : 'Unknown'],
        ['Total popularity', value => number(value.totalPopularity)]
      ] : reverse ? [
        ['Release year', value => value.year ?? 'Unknown'],
        ['Genres', value => escape(value.genres?.join(', ') || 'Unknown')],
        ['Runtime', value => score(value.runtime, 0, runtimeMax, `${number(value.runtime)} min`)],
        ['TMDB score', value => score(value.vote_average, 0, 10, `${number(value.vote_average)} / 10`)]
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
          const label = mixed || cohort ? root.AnivizDust.magnetScoreLabel(magnet) : magnet.title;
          return [`M${index + 1} · ${label}`, (_, i) => {
            const match = matches[i], value = match.scores[index];
            if (mixed) return `<small>Raw ${root.AnivizDust.formatRawScore(match.rawScores[index], magnet)}</small><br>${
              score(value, 0, 1, root.AnivizDust.formatPercentile(value), root.AnivizDust.mixedEvidence(match, magnet, index))}`;
            return score(value, -1, 1, value.toFixed(3), cohort ? `${label}: ${value}` : `Cosine ${value}`);
          }];
        }),
        [mixed ? root.AnivizDust.averageLabel(true) : group ? 'Mean story similarity across magnets' : 'Average cosine similarity', (_, i) =>
          score(matches[i].score, mixed ? 0 : -1, 1, matches[i].score.toFixed(3),
            `${mixed ? root.AnivizDust.averageLabel(true) : 'Average cosine'} ${matches[i].score}`)]
      ];
      return `<div class="dust-comparison-scroll" role="region" tabindex="0" aria-label="Selected ${noun} comparison, scroll horizontally">
        <table class="dust-comparison-table"><caption class="sr-only">Selected ${noun} comparison</caption>
        <thead><tr><th scope="col">Compare ${noun}</th>${records.map((item, i) => {
          const cover = dustThumbnail(item, matches[i].key);
          return `<th scope="col">
            ${cover ? `<img class="dust-comparison-cover" src="${attr(cover)}" alt="" width="40" height="56">` : ''}
            ${escape(item.title)}
            <button type="button" class="small-button ghost" data-dust-remove="${attr(matches[i].key)}" aria-label="Remove ${attr(item.title)} from comparison">Remove</button>
          </th>`;
        }).join('')}</tr></thead>
        <tbody>${rows.map(([label, cell], index) => `<tr${index >= metadataRows.length && index < metadataRows.length + magnets.length ? ` style="--magnet-color:${color(magnets[index - metadataRows.length].key)}" class="dust-movie-metric"` : ''}><th scope="row">${escape(label)}</th>${values.map((value, i) => `<td>${cell(value, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="table-note">${group ? `Each magnet uses all catalogue ${titleNoun} with data for that magnet. ` : reverse ? '' : 'Estimated runtime multiplies episodes by minutes per episode. '}${mixed ? 'Meters show attraction percentiles from 0 to 1.' : 'Cosine scores range from −1 to 1.'}</p>`;
    }
    const focused = focusedMagnet ? null : selected.at(-1);
    const record = focusedMagnet || (focused && recordFor(focused));
    const movie = focusedMagnet ? !reverse : reverse;
    const cover = record?.cover?.extra_large || record?.cover?.large || '';
    const banner = record?.banner_image || cover;
    const tags = record?.tags || [];
    const focusLabel = `${(!focusedMagnet && group?.label) || (movie ? 'Movie' : 'Anime')} in focus`;
    const placeholder = group
      ? `<div class="dust-detail-placeholder"><p class="chart-kicker">${focusLabel}</p><p>Select a ${group.label.toLowerCase()} to see magnet scores and explore credited ${titleNoun} below.</p></div>`
      : `<div class="dust-detail-placeholder"><p class="chart-kicker">${focusLabel}</p><h3>Every dot has a story.</h3><p>Select a dot or a title magnet to explore its storyline and genres.</p></div>`;
    const groupHtml = group && focused ? `<p class="chart-kicker">${focusLabel}</p>${renderGroup({ snapshot, match: focused, color, helpers })}` : '';
    const animeHtml = !movie && (!group || focusedMagnet) && record ? `<p class="chart-kicker">${focusLabel}</p>
      ${detailHero(banner, cover, `Cover for ${record.title}`, attr)}
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
    const movieHtml = movie && record ? `<p class="chart-kicker">${focusLabel}</p>
      ${movieHero(record, attr)}
      ${renderMovie({ record, match: focused, magnets, color, helpers })}` : '';
    return {
      count: selected.length,
      focusLabel,
      focusHtml: groupHtml || movieHtml || animeHtml || placeholder,
      html: selected.length ? `<section aria-label="Selected dust ${noun}"><div class="dust-details-heading"><h3>${selected.length > 1 ? `Comparing ${selected.length} ${noun}` : escape(recordFor(selected[0]).title)}</h3><button type="button" class="small-button ghost" data-dust-clear>Clear selection</button></div>${table(selected)}</section>` : ''
    };
  }
  root.AnivizDustDetails = { render, renderMovie, renderGroup, groupCoverage, magnetScores };
})(globalThis);
