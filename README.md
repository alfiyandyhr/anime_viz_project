# AnIViz — Anime Industry Visualization

A visual story discovery tool built with Python/Flask, AniList GraphQL API, and D3.js. Dust & Magnet opens directly, with linked analysis below the field. One compact view dropdown connects Dust & Magnet, History, Network, and Full Catalogue.

**Live site:** https://alfiyandyhr.github.io/anime_viz_project/

---

## Four views

The root URL opens **Dust & Magnet** with an **Example** Inception magnet.
Switch Direction to **Anime → Movies** for the **Example** Cowboy Bebop magnet. Use **Title** to search by title, alias, or year. Use **Genre cohort** to add a group of titles by genre. Fill up to three slots with any mix of distinct titles and cohorts. Remove any magnet with ×.
The compact dropdown contains exactly four destinations:

| View | Data and interactions |
| --- | --- |
| Dust & Magnet | Choose either direction and a field of 30, 60, or 90 dots. Both directions include similarity connections, a field mirror, genres, release years, and a full ranking. Anime dust also shows reception and studio charts. |
| History | Scroll a pair of release timelines to see each year’s most popular anime and its closest movie match. Both titles have synopses and the connection shows cosine similarity. |
| Network | Actor/character/work collaboration graph, defaulting to Current dust when a saved anime-dust context exists, otherwise Catalogue. A local selector switches scopes without changing other views. The 35-work display cap and sampled Japanese cast credits are disclosed. |
| Full Catalogue | The loaded 1,000-title metadata sample, with its own search, filters, sorting, pagination, details and automatic shortlist comparison. Saved movies never narrow its scope. |

Direction, the magnet picker, removable magnets, dot count, and **Reset positions** sit in the left panel.
The right panel follows the latest selected title. Anime details include AniList
images, synopsis, tags, and sampled Japanese cast. Movie details use published
TMDB text, genres, keywords, and a TMDB link. Open **Filter** for dust filters.
Movie dust supports title and alias search,
genre, and release year.

Filters narrow the sampled candidates without refilling them. The field and
linked charts share the displayed set. The full similarity ranking covers every
title in the dust catalogue, marks displayed rows, and sorts by any active
magnet or their arithmetic mean. Sorting and dragging preserve membership,
scores, and selection. Removing the active sort magnet returns to average
similarity. Field distances express each title’s preference order across magnets.

Click, tap, or use Enter/Space to toggle a title. Compare up to three titles and
their exact per-magnet scores below the field. Clicking empty playground space
deselects the latest selection. Dragging and Reset positions preserve selection.
Remove or Clear selection also updates the comparison. Every ranking row opens
the title’s details independently of the selection.
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

Session storage uses `aniviz-dust-session-v2` to keep the active direction and
separate magnets, filters, dot counts, sorts, selections, positions, and scroll
for each direction. A saved session preserves an explicitly empty field. The
previous v1 session imports into Movie → Anime. Otherwise, a resolvable
`aniviz_seed_movie.tmdbId` takes priority over the Inception example. The current
matrix recomputes dust membership on restore. Anime → Movies starts with Cowboy
Bebop on first entry. Catalogue filters
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

## History

Choose **History** from the view dropdown or visit `/history` or `/story` with Flask.
Scroll to advance one anime release year at a time, or use the year selector.
The left timeline follows the most popular title from that year’s AniList sample.
The right timeline marks the actual release year of its highest-scoring movie
across the 1,000-title TMDB corpus. Open either synopsis for the full introduction.
Popularity uses AniList user-list counts from the published snapshot. Both axes
share the same release-year scale.

Switch from **Anime Timeline** to **Movie Timeline** to start with the top movie
by TMDB popularity in each represented release year. Each movie links to its
highest-scoring match in the published 1,000-title AniList similarity catalogue.
The selector keeps the current release year when available and moves to the
nearest represented year otherwise. Movie Timeline loads the existing movie
recommendation and popularity snapshots on first use.

History reads the published `story.json` and `data/history_movie_matches.json` on
Flask and GitHub Pages. Regenerate them together so the annual winners and their
scores stay in sync:

```bash
python data/refresh_story.py
python data/export_story_recommendations.py --annual --compute-missing
```

The archive samples up to ten Japanese, non-adult titles per first-release year,
excluding unreleased entries. The Flask `/api/story` endpoint also serves annual
rankings using its own cache and reports stale or unavailable years.

The exporter reuses exact float32 scores from the published matrix. For anime
missing from the matrix, it uses the same Qwen/Qwen3-Embedding-4B model revision,
metadata preprocessing, and TMDB corpus. Supplemental inference requires
`data/semantic_similarity/requirements-embeddings.txt`. Pass `--offline` when
AniList metadata and the pinned model are cached. The ignored
`data/semantic_similarity/output/story/` cache holds full supplemental score rows
and movie vectors. The export without `--annual` still generates the six-period
research snapshot.

## Dust & Magnet recommendations

Open the root URL, choose **Dust & Magnet** in the dropdown, or visit
`frontend/dust-magnet/index.html`. Start with a title search or pick **Genre cohort**.
Try **Inception** with **Science Fiction movies** (214 TMDB movies), or **Sci-Fi anime**
(165 AniList anime) in the reverse direction. Each cohort score averages the signed
cosines to its sampled titles. A cohort occupies one slot and contributes one score
to the combined average. Its membership stays fixed when you filter the dust.

Choose **High popularity** to add one popularity magnet within the same three
slots. With anime dust it uses AniList list users (997 of 1,000 anime in the
2026-09-29 snapshot). With movie dust it uses TMDB popularity (1,000 of 1,000
movies in the 2026-10-11 snapshot). Try **Inception**, **Science Fiction movies**,
and **High anime popularity** together. Each magnet's raw values become
midrank percentiles from 0 to 1 over the same titles with known popularity.
The field and combined ranking use those percentiles. Individual ranking
sorts and score evidence still expose the raw values. Titles without popularity
stay in the full ranking with an unavailable combined rank. Remove the
popularity magnet to return to cosine scores.

Choose 30, 60, or 90 dots and use **Reset positions** directly in the left panel.
Open **Filter** to narrow the displayed titles. Drag magnets, or focus
one and use arrow keys, to rearrange the field. Hover or keyboard-focus an anime
for its title and cosine scores rounded to three decimals. Click or press Enter
to show its details in the right panel. Enter/Space or another click toggles selection; two or three
selected titles compare automatically. Clear selection and individual removal
controls appear in the comparison below the field, which omits synopsis, tags
and cast. Empty-field clicks deselect the last selected anime, one at a time.
Dragging and resetting positions preserve selection. All linked charts remain
available by scrolling.

The dust field defaults to **60 dots**, with 30 and 90 options. It reserves half
the candidate budget equally for each magnet's strongest matches, then fills
remaining slots with the highest average attraction scores, deduplicating overlap.
The reference sample stays fixed when dot count or filters change. Color identifies the highest-scoring
magnet; white outlines mark selected anime. Selected dots show connections;
hover and keyboard focus show score tooltips without selecting an anime.

With two or three magnets, each dot is closer to its higher-scoring magnets.
Targets fit squared-distance differences to score differences, using signed
cosines or attraction percentiles. Each dot is constrained to the intersection of the
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
after Studio × genre, uses the complete recommendation corpus, and supports
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

To rebuild the movie popularity sidecar from the archived TMDB CSV, run
`python3 data/export_movie_popularity.py`. The exporter checks the input
SHA-256 against the completed similarity run and requires exact coverage of the
published TMDB IDs. It records the collection date, source, input hash, and
eligible count in `data/movie_popularity.json`. Flask and static hosting serve
the same file. The browser loads and validates it separately when movie popularity
is requested, with a Retry control if the fetch or validation fails.

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
