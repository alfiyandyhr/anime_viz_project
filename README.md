# AnIViz — Anime Industry Visualization

A visual anime discovery tool that starts with familiar movies, built with Python/Flask, AniList GraphQL API, and D3.js. Dust & Magnet opens directly, with linked anime analysis below the field. One compact view dropdown connects Dust & Magnet, History, Network, and Full Catalogue.

**Live site:** https://alfiyandyhr.github.io/anime_viz_project/

---

## Four views

The root URL opens **Dust & Magnet** with an **Example** Inception magnet.
Search for movies to add up to three magnets; remove any movie directly with ×.
The compact dropdown contains exactly four destinations:

| View | Data and interactions |
| --- | --- |
| Dust & Magnet | Movie magnets and 30/60/90 anime dots. Scroll through Similarity connections → Genres / Release years → Studios / Studio × genre → Score vs. popularity → Full anime ranking. All charts are available without selecting a title. |
| History | Six eras, annual Top 10 posters, sticky timeline and period rankings from an independent historical dataset. Popularity is current AniList list popularity, not historical audience figures. |
| Network | Actor/character/work collaboration graph, defaulting to Current dust when a saved dust context exists, otherwise Catalogue. A local selector switches scopes without changing other views. The 35-work display cap and sampled Japanese cast credits are disclosed. |
| Full Catalogue | The loaded 1,000-title metadata sample, with its own search, filters, sorting, pagination, details and automatic shortlist comparison. Saved movies never narrow its scope. |

Movie search, removable magnet chips and **Field options** sit in the left panel.
The right panel shows the latest selected anime with its banner, cover, synopsis,
tags and sampled Japanese cast. Both panels scroll away above the analysis charts.
Options contain suggestions, dot count, Reset positions and main-view filters.
Genre, studio, year and heatmap marks filter the **same displayed dusts** across
the field and supporting charts. Filters narrow the original
candidates without refilling them; removable chips and Reset filters undo them.
The full similarity ranking covers every recommendation record, marks displayed
rows, and sorts by any active movie or their arithmetic mean. Sorting and magnet
dragging preserve membership, scores and selection. Removing the sorted movie
returns the ranking to average similarity. Cosine scores are not percentages;
field distances encode each anime's preference order across movies.

Click/tap or Enter/Space toggles a dust title. The latest selection appears in the right focus panel;
two or three automatically compare metadata, runtime, ratings and every active
movie's similarity on shared scales, directly below the field. A fourth is declined
with a brief notice. Each click on empty playground space deselects the most
recently selected dust. Dragging and Reset positions preserve selection.
Explicit Remove / Clear controls also clear it. Overview charts keep their
full displayed scope and highlight selected contributions. Every ranking title
opens the Full Catalogue detail drawer without joining or changing the comparison.
Catalogue shortlists are independent and remain in memory for that page visit.

## Routes and session state

Native links and the keyboard-accessible dropdown support browser Back/Forward.
All assets and redirects are relative to the deployment root, including GitHub
Pages' `/anime_viz_project/` prefix. Root and legacy redirect pages include a
relative no-JavaScript fallback link and refresh (the charts themselves need JS).

| Legacy URL or root bookmark | Destination |
| --- | --- |
| Introduction, Movie → Anime, `#recommendations`, `#dust-magnet` | Dust & Magnet |
| Content, `#content` | Main view's Genres section |
| Creators, `#creators` | Main view's Studios section |
| Creators `#network`, `#network-chart`, `#tab-network`, `#collaboration`, `#collaboration-structure` | Network |
| Reception, `#reception` | Main view's Score vs. popularity section |
| Story, `#story`, `#history` | History |
| Explorer, `#explorer`, `#catalogue` | Full Catalogue |

Old `?mode=matches` and `?mode=catalogue` URLs resolve to the destination's new
scope. Full Catalogue always uses catalogue scope. Graph links translate those
modes to local `scope=dust` / `scope=catalogue`; unavailable dust falls back to
Catalogue. Other query parameters are preserved. Flask also serves `/history`
and `/catalogue`, plus the legacy clean paths with or without trailing slashes.

Versioned `aniviz-dust-session-v1` session storage preserves ordered movies,
filters, dot count, ranking sort, selection, magnet/particle positions and scroll.
A supported saved session takes priority, including an explicitly empty movie
set. Without one, a resolvable legacy `aniviz_seed_movie.tmdbId` becomes one
magnet; the current algorithm recomputes 60 candidates from the complete matrix.
Old Top-20 IDs, ranks, filters and selection are never imported as dust membership.
Unresolvable seeds fall back to the labelled example. Legacy keys are left intact;
new main-view actions write only the versioned dust session. Catalogue filters
use `aniviz-catalogue-filters`; History's annual data and Network's local controls
stay independent. Storage failure permits in-memory use with one concise notice.
Explicit section links take priority over saved scroll on entry; reload and
Back/Forward restore the saved location, including anchored URLs.

## Frontend structure

`frontend/dust-magnet/index.html`, `frontend/story/`, `frontend/network/` and
`frontend/explorer/` are the four view entry points. Introduction, Recommendations,
Content, Creators and Reception HTML files are compatibility redirects. The
recommendation engine and dust geometry remain in `frontend/recommendations/`.
Shared modules in `frontend/common/` own navigation, independent data loading,
the ID join and dust context, reusable chart instances, lazy composition,
inline details/comparison and the extracted collaboration graph.

Recommendation IDs are strings and metadata IDs are normalized before joining.
The published datasets each contain 1,000 records, with 997 IDs in common; all
recommendation records remain available even when richer metadata is missing.
Unknown values stay unknown, with metric-specific coverage. Metadata failure
leaves dust and similarity evidence usable; matrix failure offers Retry without
invented scores. Detailed methods, data freshness and credits sit in About / Data.

See [the shared interfaces](frontend/common/README.md) and
[the verification guide](tests/journey-verification.md) for contracts, checks,
observed outcomes and limitations.

## Configuration

Sampling and runtime behaviour is controlled by `.env` at the project root (already tracked in the repo — copy and edit as needed):

| Variable | Default | Description |
|---|---|---|
| `ANILIST_PAGES` | `20` | Number of pages fetched from AniList (max 50 per page → `20 × 50 = 1 000` anime) |
| `ANILIST_PER_PAGE` | `50` | Results per page (AniList cap: 50) |
| `CACHE_TTL_HOURS` | `6` | How long the backend caches a response before re-fetching |
| `NETWORK_NODE_LIMIT` | `90` | Max voice-actor nodes shown in the network graph |
| `NETWORK_LINK_LIMIT` | `750` | Max edges shown in the network graph |
| `PORT` | `5000` | Flask server port |
| `FLASK_DEBUG` | `true` | Enable Flask debug mode |

---

## Run the backend locally

```bash
# Install dependencies (Python 3.10+)
pip install -r backend/requirements.txt

# Start the Flask server
python backend/app.py
```

Open http://localhost:5000. The backend fetches live data from AniList on the first request and caches it for `CACHE_TTL_HOURS` hours.

---

## Refresh data for GitHub Pages

The live site is static — it serves `data.json` from this repo. To update it with fresh data from AniList:

```bash
python data/refresh_data.py
git add data.json
git commit -m "Refresh anime data"
git push
```

GitHub Pages picks up the new data automatically after the push.

## History — The Evolution of Anime

Choose **History** from the view dropdown, or visit `http://localhost:5000/story` with Flask
running. The page tells six connected eras from 1963 to the current year.
Scrolling in either direction updates one sticky archive: an annual timeline,
the year's Top 10 posters, and a period-level genre or main-studio ranking.
The year selector jumps to a particular release year. Posters open accessible
detail dialogs. Mobile layouts and reduced-motion preferences are supported.

`GET /api/story` serves its own cached dataset. `backend/story_service.py`
reuses the existing AniList request/retry and normalization code, querying four
independent annual Top 10 rankings per request. Results include Japanese,
non-adult anime by `startDate.year`, excluding unreleased entries. The service
uses `CACHE_TTL_HOURS`, writes `data/anilist_story_cache.json` locally, and falls
back to cached years with explicit stale or unavailable states on failure.

For static hosting, the page falls back to the published `story.json` snapshot.
Refresh that snapshot separately from the global dashboard sample:

```bash
python data/refresh_story.py
```

Commit `story.json` to update GitHub Pages. An incomplete refresh preserves the
previous static snapshot. The local backend cache is ignored by Git.

**Interpretation:** popularity is current AniList user-list popularity, not
historical viewing figures. The current year is provisional. Genre/studio
shares describe only the annual Top 10 sample and may overlap because a title
can have multiple genres or credited main studios. Historical milestones link
to primary sources in the narrative; the rankings are not evidence of those
events' causes or effects.

To add a historical era, add a `.story-step` section to
`frontend/story/index.html` with its start/end years, theme, and accent color,
then add its link to `.era-nav`. Scroll and chart logic derive periods from
these attributes. `data.js` contains independently testable sample and scroll
transformations; `app.js` owns the D3 joins, controls, and data loading.

History no longer loads movie detours. The optional historical similarity export
and its independent data checks remain available for research; they do not scope
the historical archive or restart a numbered task workflow.

Regenerate the separate published snapshot after updating `story.json`:

```bash
python data/export_story_recommendations.py --compute-missing
```

This requires the environment in `data/semantic_similarity/requirements-embeddings.txt`
only when supplemental scores are needed. Existing anime rows are read directly
from the verified published `movie_anime_scores.bin`, retaining their exact
float32 values. Missing anime metadata uses the original collector's non-spoiler
tag rules and the original embedding preprocessing. Inference uses
**Qwen/Qwen3-Embedding-4B**, revision
`5cf2132abc99cad020ac570b19d031efec650f2b`, float16 eager attention, an empty prompt,
a 2,048-token budget with no silent truncation, and normalized 2,560-dimensional
vectors. This is the model in the existing computation script and published
scores; older 0.6B references in the embedding documentation describe an earlier
configuration.

The first supplemental run downloads the fixed model revision. If the original
completed run is available, pass `--similarity-dir /path/to/similarity` to reuse its
validated movie vectors. Otherwise the unchanged movie texts are encoded once;
only missing anime-to-movie score rows are calculated. Metadata, movie vectors,
model weights, and supplemental full score rows are cached under the ignored
`data/semantic_similarity/output/` directory, with model/input hashes to prevent
reuse across incompatible runs. Reruns reuse completed supplemental rows.
`--offline` requires cached metadata and weights. Commit
`data/story_movie_recommendations.json` for Flask and GitHub Pages; the site does
not load a model or calculate embeddings in the browser. A failed computation
preserves the previous published snapshot. Missing optional recommendations do
not interrupt the historical narrative or annual archive.

Run the relevant checks with:

```bash
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
```

## Dust & Magnet recommendations

Open the root URL, choose **Dust & Magnet** in the dropdown, or visit
`frontend/dust-magnet/index.html`. Search for up to three favorite movies and
remove a magnet with its × button. **Field options** contains suggestions, the
30/60/90 dot choices, filters, and **Reset positions**. Drag magnets, or focus
one and use arrow keys, to rearrange the field. Hover or keyboard-focus an anime
for its title and cosine scores rounded to three decimals. Click or press Enter
to show its details in the right panel. Enter/Space or another click toggles selection; two or three
selected titles compare automatically. Clear selection and individual removal
controls appear in the comparison below the field, which omits synopsis, tags
and cast. Empty-field clicks deselect the last selected anime, one at a time.
Dragging and resetting positions preserve selection. All linked charts remain
available by scrolling.

The dust field defaults to **60 dots**, with 30 and 90 options. It reserves half
the candidate budget equally for each movie's strongest matches, then fills
remaining slots with the highest mean cosine scores, deduplicating overlap.
All candidates use the complete matrix. Color identifies the highest-scoring
movie; white outlines mark selected anime. Selected dots show connections;
hover and keyboard focus show score tooltips without selecting an anime.

With two or three magnets, each dot is closer to its higher-scoring movies.
Targets fit squared-distance differences to cosine-score differences, including
zero and negative scores. Each dot is constrained to the intersection of the
appropriate sides of the magnets' perpendicular bisectors. Collision separation
also respects these constraints, so crowding cannot reverse the score order.
Tied scores impose no ordering. A single magnet gathers a compact cloud at its
surface using positive-score attraction.

Damping and fixed time substeps animate movement while retaining particle
identities and momentum. Dragging or resizing projects dots into their valid
score regions immediately, then they settle around their new targets. Motion
settles when idle; reduced-motion preferences use settled positions. Switching
pages stops the animation. Magnets stay separated and inside the chart.

Distances encode each dot's **preference order across movies**, rather than an
exact cosine scale or a ranking of different anime. Some nearly collinear
magnet arrangements cannot express all three preferences inside the chart.
In that case the highest-scoring movie stays nearest and an inline message
suggests spreading the magnets or resetting their positions. Anime-to-anime
distances carry no meaning. Exact scores remain in tooltips and details. Moving
magnets does not change the candidate set, scores, or rank.

Each of up to three active movies has a compact curved-link map of its top 5 and
bottom 5 anime within the displayed dust, with local ranks and cosine scores.
With 60 visible dots the maps show ranks 1–5 and 56–60. Dot-count changes and
filters update their membership and ranks; table sorting does not. Curves,
endpoint dots and scores use each anime's dust color for its highest-scoring
magnet, including stable movie colors after removal or reordering. The linked
content, creator, and reception charts summarize the displayed dusts. **Full anime ranking** appears
after Score vs. popularity, uses the complete recommendation corpus, and supports
sorting by each active movie or average similarity. Its titles open the same right
detail drawer as Full Catalogue without changing the selected dust comparison.
Neither ranking sorts nor magnet movement alter the displayed anime membership. The view lazily loads the published similarity JSON and binary
matrix, without an embedding model or API token. Similarity measures semantic
proximity, not a percentage or a prediction of enjoyment.

After computing a new completed similarity run, regenerate the web bundle:

```bash
python3 data/export_recommendations.py
```

The exporter checks source hashes, record IDs, score ranges, and ranked matches.
It exports movie/anime context, 20 top plus 20 bottom matches per movie, and a
4 MB `data/movie_anime_scores.bin` file containing every score, from the existing
`data/semantic_similarity/output/` files; bottom scores are read from all one
million pairs in `all_pairs.csv.gz`. The global ranking sorts scores descending,
breaking ties by anime record order; bottom records are stored in reverse rank
order for selecting either cutoff. No model inference is rerun. The binary is movie-major, little-endian float32;
its dimensions and SHA-256 hash are stored in the JSON metadata. The browser
lazily loads and validates it for the magnet view and the full ranking. Commit both
`data/movie_recommendations.json` and `data/movie_anime_scores.bin` along with
frontend changes to deploy. The analysis outputs and model weights are not
needed by the site.

Run recommendation, story, network, and collector checks:

```bash
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m unittest discover -s data/semantic_similarity/tests -p 'test_*.py' -v
```

For shared context, navigation, and route checks:

```bash
node --test tests/cohort.test.cjs tests/frontend-integration.test.cjs
python3 -m unittest discover -s tests -p 'test_frontend_routes.py' -v
```

The Node checks cover navigation, movie changes, missing metadata, independent
filters, storage failures, chart updates, and comparison behaviour. Flask checks
serve the views and published assets without live AniList or TMDB requests.
Install `backend/requirements.txt` in your Python environment before running them.
See [the journey verification walkthrough](tests/journey-verification.md) for
desktop, mobile, keyboard, and session scenarios and the observed usability checks.

Movie metadata comes from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. The bundled approved TMDB logo by Travis Bell
is preserved from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg)
under its [CC BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/).

## Supervisor design proposal

`assets/aniviz_supervisor_proposal.pdf` contains a meeting
proposal for a connected journey from a familiar movie to a first anime. The
10-page proposal includes an audited dataset inventory, user tasks, three design
directions with mock-ups, a storyboard, real ranking examples, evaluation plans,
and a feedback worksheet. The four-view navigation, shared displayed-dust analysis, studio/cast
exploration, and automatic inline comparisons are implemented. Multi-movie weighted
ranking, saved shortlists, and franchise detection remain outside this pass.
