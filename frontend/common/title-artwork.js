"use strict";
(function (root) {
  // AniList covers for recommendation titles absent from the dashboard catalogue.
  const coverFallbacks = new Map([
    ['175872', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx175872-d55nfiC4WWHO.jpg'],
    ['195516', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx195516-MJpUZlOberqH.jpg'],
    ['195604', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx195604-tSZcfKbVqSEG.jpg']
  ]);

  function animeThumbnail(record) {
    return record.cover?.medium || record.cover?.large || record.cover?.extra_large || coverFallbacks.get(String(record.id));
  }

  function tmdbImage(path, size) {
    return typeof path === 'string' && /^\/[\w-]+\.jpg$/.test(path)
      ? `https://image.tmdb.org/t/p/${size}${path}` : '';
  }

  function movieThumbnail(record) {
    return tmdbImage(record.poster_path, 'w92');
  }

  function detailHero(banner, cover, description, attr) {
    if (!banner && !cover) return '';
    return `<div class="title-artwork">
      ${banner ? `<img class="detail-banner" src="${attr(banner)}" alt="">` : ''}
      ${cover ? `<img class="detail-cover" src="${attr(cover)}" alt="${attr(description)}">` : ''}
    </div>`;
  }

  function movieHero(record, attr) {
    return detailHero(tmdbImage(record.backdrop_path, 'w780'), tmdbImage(record.poster_path, 'w185'),
      `Poster for ${record.title}`, attr);
  }

  root.AnivizArtwork = Object.freeze({ animeThumbnail, movieThumbnail, detailHero, movieHero });
})(globalThis);
