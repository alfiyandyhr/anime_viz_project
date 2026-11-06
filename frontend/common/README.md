# Dust context and chart interfaces

The reorganization's Tasks 1–10 are implemented. `navigation.js` adds keyboard
shortcuts and dismissal to the shared native four-view disclosure. Legacy page URLs now redirect to the composed views through `redirect.js`.
Open `frontend/dust-magnet/index.html` to exercise the new composition.

## Ownership

`dust-context.js` owns analytical state. `createContext({getDustMatches, storage,
onNotice})` returns a store with `snapshot()` and `subscribe(callback)`. Treat
snapshots as read-only. All IDs are strings, including joins to numeric dashboard
IDs. Its versioned snapshot includes ordered `movieIds`, `dustLimit`,
`candidateDustIds`, `displayedDustIds`, `perMovieScores`, `rankingSortKey`,
`filters`, `selectedAnimeIds`, and `revision`.

- `setSources(recommendationJSON, matrix)`, `setMovies(ids)`, and
  `setDustLimit(30 | 60 | 90)` derive candidates using the existing balanced
  `getDustMatches` algorithm. Unchanged source/movie/count inputs reuse candidates.
- `setFilters(patch)` narrows candidates without replacement. `resetFilters()`
  restores the candidate set. Available recommendation text supports genre,
  title, format and year filtering when richer dashboard metadata is missing.
- `setSelection(ids)` keeps up to three displayed IDs for linked highlights.
  Selection never scopes aggregate charts. Completed membership changes drop
  selections outside the displayed set; metadata still loading does not discard
  a restored selection prematurely. `toggleSelection(id)` adds/removes a title;
  attempting a fourth preserves the existing three and emits an accessible notice.
- `setRankingSort('average' | movieId)` ranks the complete recommendation corpus,
  with exact per-movie scores, arithmetic mean and stable source-order ties.
  Each row's `displayed` flag identifies membership in the field. Sorting never
  changes candidates or field positions. Removed movie sorts fall back to average.
- `saveLayout(patch)`, `getLayout()` and `resetPositions()` manage a separate
  session envelope for normalized magnet positions, particle positions and
  velocities, movie colors, and scroll position. They do not advance the
  analytical revision or notify chart subscribers.

The store's `lookup` preserves every recommendation record alongside nullable
`metadata` and a normalized `anime` object. Missing numeric metadata stays null.
`missingMetadataIds` counts candidates lacking a dashboard record;
`filteredOutIds` counts candidates excluded by filters. These can overlap and
must not be conflated. Version 1 uses only `aniviz-dust-session-v1`; catalogue
filters and historical samples are independent. Storage errors and discarded
writes produce a brief persistence notice while in-memory operation continues.
`restore()` reads only supported versioned sessions. If it returns false,
`migrateLegacy(recommendations)` resolves the old `aniviz_seed_movie.tmdbId`
against published movies before source derivation. It imports only that seed,
never legacy Top-20 IDs, ranking evidence, filters or selection. This also works
when dashboard metadata arrives first. A restored versioned session, including
an empty movie set, always wins. Unresolvable legacy seeds leave the default
example available. Legacy keys are retained; only the versioned session is written.

## Charts

`chart-data.js` provides pure genre, studio, year, correlation, and comparison
transforms. Aggregates retain count/metric coverage and selected contributions.
Missing values are excluded only from the relevant metric.

`AnivizCharts.create(kind, {container, d3, helpers})` creates an instance for
`genres`, `years`, `studios`, `heatmap` or `reception`. Call
`update({anime, selectedIds, genreColor, metric, onFilter, onSelect,
onCorrelation})`; `destroy()` removes its content. `onFilter` returns a semantic
filter patch, such as `{genre, studio}` or `{yearFrom, yearTo}`. `onSelect` returns
a string anime ID. The renderer never reads a page's body, global state, or filter
controls. `chartHelpers()` supplies shared formatting, empty states and tooltips.

`AnivizExplorer.create({body, pagination, note, d3, helpers})` owns an independent
sortable/paginated metadata table. `update({anime, sortMode, page, pageSize,
cohort, selectedIds, onSelect, onRendered})` supplies its data and callbacks explicitly. Its
legacy adapter retains ownership of the catalogue shortlist. The pure
`comparisonValues` transform is shared with Explorer's comparison fields.

`AnivizComposition.create()` mounts `{update, pause?, destroy?}` renderers by
container. It renders within 400px of the viewport, keeps only the latest context
for deferred charts, clears obsolete marks, and pauses inactive renderers.
`setActive(false)` and `destroy()` provide view lifecycle boundaries. Fixed chart
extents prevent deferred rendering from displacing restored scroll positions.

`dust-main.js` is the composition adapter. The field, displayed-set connection
map, genre/year/studio/heatmap/scatter charts, filters and linked selection read
one context. Full ranking deliberately uses the complete corpus and has separate
pagination/sort controls. `dust-details.js` renders one-title metadata or automatic
comparison for two/three selections, reusing the Explorer comparison transform.
Runtime uses a common selected-title maximum, AniList scores use 0–100, and
cosine scores use −1–1 across all columns; exact scores remain available on
focus/hover. Synopsis/tags and sampled Japanese cast are disclosed on demand.
Ranking inspection outside the displayed set has separate inline evidence and
never adds to the comparison. Background clicks, dragging and position reset
preserve selection; toggles, individual removal and Clear selection are explicit.
Explorer uses the same extracted chart transforms and table instance. `collaboration-network.js` owns the extracted actor/character/work graph and
inspection functions for Network. `network/app.js`
is the dedicated Network adapter: `network/scope.js` reads the versioned dust
snapshot without writing it, normalizes displayed IDs, and joins metadata.
Current dust is the default when a main context exists (including an empty
filtered set); direct entry falls back to Catalogue. Search, type toggles, and
scope changes are local. Missing metadata is reported separately from the
35-most-popular-work rendering limit. Actor profiles cover the entire active
scope, including works beyond that limit. Edge and node evidence supports
keyboard inspection. Reduced motion settles the simulation before displaying
it; drag/zoom remain available.

Full Catalogue always uses catalogue mode, including legacy `?mode=matches`
entries. Its saved filters and page-local shortlist stay independent of dust;
comparison is automatic and inline. History keeps its separate annual data,
six-era scroll mapping, posters and rankings, without movie detour loading.
Detailed methods and freshness live in each view's About / Data disclosure.

## Loading and failure

`AnivizData.dashboard()`, `.recommendations()`, `.matrix(data)` and `.history()`
cache independent promises for each resource. Matrix loading validates dimensions,
byte count, little-endian float32 values and SHA-256 when available. Failed
requests are evicted for retry. The dust view loads similarity and dashboard
metadata independently. Metadata failure leaves dust, connection evidence and
full ranking usable, with coverage/unavailable notes on affected metrics. The
historical page retains its independent API/static fallback and never enters the
dust context.

## Compatibility routes

`redirect.js` exports a pure `resolve(entry, search, hash)` for tests and runs a
single `location.replace` in compatibility pages. Root hashes map explicitly to
the four views; Content, Creators and Reception target stable main-view IDs.
Creators graph anchors target Network. Legacy query modes are removed for dust
and History, forced to catalogue for Explorer, and translated to local scope for
graph links. Unrelated parameters survive. The script URL supplies the deployment
prefix, without root-relative assets or a redirect chain through obsolete pages.
No-JavaScript refreshes live inside `noscript`, avoiding a competing redirect.
The main adapter scrolls to explicit sections after data/layout are ready;
reload and Back/Forward instead restore saved scroll.
