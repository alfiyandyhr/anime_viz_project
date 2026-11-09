# Dust context and chart interfaces

Open `frontend/dust-magnet/index.html` to exercise both directions. The shared
four-view disclosure in `navigation.js` supports keyboard shortcuts and
dismissal. Legacy URLs redirect through `redirect.js`.

## Ownership

`dust-context.js` owns analytical state. `createContext({storage, onNotice})`
returns a store with `snapshot()` and `subscribe(callback)`. Treat snapshots as
read-only. The snapshot includes the active `direction`, ordered `magnets`,
`candidateDust` and `displayedDust`, and `selectedKeys`. State keys are qualified
by catalogue, for example `tmdb:27205` and `anilist:1`.

- `setSources(recommendationJSON, matrix)` indexes the validated matrix by TMDB
  movie ID and AniList anime ID. `setDirection(direction)` chooses which
  catalogue supplies magnets. `setMagnets(keys)` scores each dust title once
  against those magnets. Balanced sampling and ranking share the score vectors.
- `setDustLimit(30 | 60 | 90)` resamples the same corpus. `setFilters(patch)`
  narrows candidates without replacement. `resetFilters()` restores the
  candidate set. The lookup joins optional dashboard metadata only for anime
  dust. Unknown numeric metadata stays null.
- `setSelection(keys)` and `toggleSelection(key)` keep up to three displayed
  titles. Selection highlights contributions without changing chart scope.
  Membership changes remove selections outside the field. Restored anime
  selection waits for optional metadata to settle before pruning.
- `setRankingSort('average' | magnetKey)` and `setRankingOrder(order)` sort the
  full corpus. Each row has an exact score vector, arithmetic mean, and a
  displayed flag. Ties use source order. Removing the active sort magnet
  resets the basis to average.
- `saveLayout(patch)`, `getLayout()`, and `resetPositions()` manage magnet and
  particle positions, colors, and scroll without advancing the analytical
  revision or notifying chart subscribers.

The v2 session stores separate state and layout for both directions and remembers
which is active. A compatible v1 session imports into Movie → Anime. If no saved
session exists, a resolvable legacy seed takes priority over the Inception
example. Only the legacy title ID is imported. Cowboy Bebop seeds the reverse
direction on first entry. Restoring any direction revalidates magnet and
selection IDs and recomputes the dust membership. Storage failure leaves the
context usable in memory and emits a notice.

## Charts

`chart-data.js` provides pure genre, studio, year, correlation, and comparison
transforms. Aggregates retain count/metric coverage and selected contributions.
Missing values are excluded only from the relevant metric.

`AnivizCharts.create(kind, {container, d3, helpers})` creates an instance for
`genres`, `years`, `studios`, `heatmap` or `reception`. Call
`update({anime, selectedIds, dustColor, metric, onSelect,
onCorrelation})`; `destroy()` removes its content. In the reception chart,
`onSelect` returns a string anime ID. The renderer never reads a page's body, global state, or filter
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

`dust-main.js` connects the active context to the field, connections, charts,
ranking, and details. Movie dust uses count-only genre and release-year charts.
The shared chart composition clears inactive marks when the direction changes.
The `#reception`, `#content`, and `#creators` anchors work with either catalogue.

`dust-details.js` renders the latest selection and a comparison below the field.
Anime comparison shares Explorer’s metadata transforms. Movie comparison shows
year and genres. Cosine meters span −1 to 1, with exact values available on
hover or focus. Field tooltips, Movie in focus, and the movie details drawer show
scores to three decimals. Any ranking row can open the appropriate details drawer
independently of the comparison.
Explorer uses the same extracted chart transforms and table instance. `collaboration-network.js` owns the extracted actor/character/work graph and
inspection functions for Network. `network/app.js`
is the dedicated Network adapter: `network/scope.js` reads the versioned dust
snapshot without writing it, normalizes displayed IDs, and joins metadata.
Current dust is the default for active anime dust, including an empty filtered
set. With movie dust or on direct entry without a session, Network uses Catalogue. Search, type toggles, and
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
