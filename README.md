# AnIViz — Anime Industry Visualization

A visual anime discovery tool that starts with a familiar movie, built with Python/Flask, AniList GraphQL API, and D3.js. The introduction leads to Movie → Anime or direct catalogue browsing. Story offers optional historical context; Content, Creators, Reception, and Explorer help inspect the anime catalogue.

**Live site:** https://alfiyandyhr.github.io/anime_viz_project/

---

## Frontend structure

Each page has its own HTML, CSS, and JavaScript. Shared styles, data loading,
filters, tooltips, and detail drawers live in `frontend/common/`.

```text
frontend/
├── common/
│   ├── app.js
│   ├── api.js
│   ├── styles.css
│   └── redirect.js
├── intro/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── reception/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── content/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── creators/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── recommendations/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── dust-magnet.js
├── dust-magnet/
│   └── index.html
├── explorer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── story/
    ├── index.html
    ├── styles.css
    ├── data.js
    ├── connections-data.js
    ├── connections.js
    └── app.js
```

The root `index.html` redirects to the introduction and preserves existing
chapter bookmarks such as `#creators`. Page navigation uses relative URLs for
Flask and GitHub Pages. Filters persist across pages for the current browser
session. The bundled dataset remains at the project root as `data.json`.

The four numbered tasks follow Movie → Anime (1) → Content (2) → Creators (3) →
Reception (4): choose a movie, explore the stories in its matches, discover their
studios and cast, then compare audience reception. Explorer is the unnumbered
final comparison step for choosing a first anime. Story and Dust & Magnet are
labelled optional explorations in every page's navigation. Reception has the
**Score vs Popularity** chart for comparing audience ratings and reach. Bubbles
open anime details and update with shared filters and window resizing. Explorer
provides the catalogue table and first-watch shortlist comparison. Dust & Magnet
is a separate playground outside the four numbered task views.

Task 1, the movie-match views in Tasks 2–4, and Explorer share a compact journey
overview. It highlights the current location without recording task completion;
Explorer appears separately as the unnumbered final comparison. Descriptive next
actions connect Content → Creators → Reception → Explorer while keeping the movie
and its filters. In Task 1, opening another task from the overview confirms the
displayed example or chosen movie using the same session-storage check as
**Explore these 20 matches →**. Catalogue views hide this movie-journey guidance.
In Explorer, use the **Shortlist** checkboxes to select 2–3 matches and compare
similarity, format, runtime, and audience scores before choosing a first anime.

Selecting a movie carries its **Top 20** into Content, Creators, Reception, and Explorer
for the browser session. The shared context strip shows the movie title and year,
original match count, and how many matches are visible or hidden by filters.
It stays visible when filters are collapsed and wraps long titles on small screens.
Filters carry between these views and narrow the original movie matches; the
strip's **Reset filters** restores available matches without clearing the movie.
Recommendations missing dashboard metadata are counted separately from titles
hidden by filters; they retain their original ranks and scores and are never
replaced. The strip links back to movie search. **Browse full catalogue** in the
navigation (or the introduction) explicitly opens catalogue mode using the same
Content, Creators, Reception, and Explorer views and `data.json` sample. Catalogue
headings and navigation describe browsing rather than numbered movie-match tasks;
the strip prominently says **Browsing the full catalogue** and offers
**Resume matches for [movie]** without discarding the movie or its original matches.

Movie-match and catalogue filters persist independently in session storage.
Switching modes restores that mode's filters; a reset affects only the current
mode. Selecting a different movie activates its matches and clears the previous
movie's filters while preserving catalogue filters. Selecting the same movie
retains its match filters. Direct page entry restores the active session mode
when a valid movie context exists; otherwise it opens an explicitly labelled
catalogue with a link to Task 1. Explicit `?mode=catalogue` and `?mode=matches`
navigation overrides the saved mode (matches require a valid saved movie).
Older shared filters migrate once to their last active scope, so an old catalogue
preference never produces movie-match headings over catalogue charts. Context and
filters last only for the browser session. If session storage is unavailable,
the context strip explains the persistence limit; Task 1 prevents continuation
until its movie context can be saved.

Explorer's **Shortlist** checkboxes compare up to three titles. Selecting two
opens a fixed comparison footer with original similarity ranks and cosine scores,
format, year, episodes, estimated runtime, AniList score, and status. Similarity
evidence is shown only when viewing movie matches; missing runtime values remain unknown.
The shortlist lasts while the Explorer page stays open, including filtering,
sorting, pagination, and resizing. Reloading Explorer, following a link to another
page, or switching between catalogue and matches starts a new shortlist; it is not
saved in session storage. Movie context and each mode's filters survive reloads
in the same tab while session storage remains available. They are not an account,
cross-device history, or durable saved collection. Creators adds credited-title counts for the
original movie match set, explicitly labelled as unaffected by filters, and lets
users select an anime to follow its sampled Japanese cast to other visible matches.
Actor profiles label their credits as spanning all available movie matches. Catalogue mode retains the full network.
Story includes a dismissible **Skip to Movie → Anime** banner.

---

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

## Story — The Evolution of Anime

Open **Story** from any page, or visit `http://localhost:5000/story` with Flask
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

The **Top anime of decade → movie** detours use only the whitespace after each
era's historical text. They measure the available height and show as many
complete connection maps as fit, without extending eras or changing the
year picker and scroll progression. Small screens may show fewer maps or none.
Anime are ordered by current AniList popularity within the period's annual
Top 10 sample. Each map shows the three most similar movies from the same
1,000-movie corpus as Movie → Anime; select an anime or movie for its details.

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

## Movie → Anime recommendations

Open **Movie → Anime** in the rail, or visit `frontend/recommendations/index.html` (the existing `#recommendations` bookmark also works). **Connection map** compares one movie and provides the full ranking below.
In a fresh session, Inception is labelled as an **example**, with no movie chosen
yet. Choose a movie through search or suggestions, or use **Explore these 20
matches →** to confirm the displayed example and open Task 2. The movie title,
year, and Top 20 count identify the set carried through Tasks 2–4 and Explorer.
Continuation activates movie matches even if the session previously showed the
full catalogue. Top/Bottom 5 or 10 changes only the map; the carried set always
uses the published Top 20 and works before the full score matrix loads. If
session storage cannot save the context, continuation stays on Task 1 and
explains how to retry.

Open **Dust & Magnet** below Explorer in the rail, or visit
`frontend/dust-magnet/index.html`, to add one, two, or three favorite movies through search or
suggestions. Remove a movie with its × button. Drag magnets (or focus one and
use arrow keys) to rearrange the field; **Reset positions** restores the layout.
Hover or keyboard-focus an anime dot for its title and exact cosine score to
each movie. Click or press Enter to update the details, storyline, genres, tags,
and AniList link. The field starts with no anime selected and invites you to
click a dot. Clicking inside the playground outside a dot or using **Reset positions**
clears the highlight, dashed connections, and anime details. Clicking outside the
playground, including expanding all story tags, preserves the selection.

The dust field defaults to **60 dots**, with 30 and 90 options. It reserves half
the candidate budget equally for each movie's strongest matches, then fills
remaining slots with the highest mean cosine scores, deduplicating overlap.
All candidates use the complete matrix. Color identifies the highest-scoring
movie; pink marks the selected anime. Only the selected dot shows connections;
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

**Connection map** compares one movie’s **Top & Bottom 5** or **Top & Bottom 10**,
including global ranks. Below the map, **Full anime ranking** lists all anime by
similarity, with 10 rows per page and Explorer-style page numbers and Previous/Next
controls. Select any ranked anime to read its details. Choosing a different movie
resets the table to page 1 and starts a fresh one-movie selection.

This task uses its own movie controls, independently of the dashboard’s
anime filters. It lazily loads `data/movie_recommendations.json` and works on
GitHub Pages and the Flask server without an embedding model or API token.
It preserves the computed ranking, including seasons and same-work overlaps;
scores are semantic proximity, not percentages or predictions of enjoyment.

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

For the connected movie journey, run the focused checks:

```bash
node --test tests/cohort.test.cjs tests/frontend-integration.test.cjs
python3 -m unittest discover -s tests -p 'test_frontend_routes.py' -v
```

The Node checks exercise example confirmation, movie changes, missing metadata,
scope changes, independent filters, direct entry, interrupted storage writes,
chart refresh dispatch, and comparison behaviour. Flask checks serve the journey
and catalogue pages and published assets without live AniList or TMDB requests.
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
and a feedback worksheet. The navigation, linked movie cohort, studio/cast
exploration, and comparison shortlist are implemented. Multi-movie weighted
ranking, saved shortlists, and franchise detection remain outside this pass.
