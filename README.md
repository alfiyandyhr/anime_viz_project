# AniMoViz: Anime and Movie Visualization

Explore story similarities between anime and live-action movies in a visualization built with Python/Flask and D3.js, using data from AniList and TMDB. Dust & Magnet opens directly, with linked analysis below the field. The view dropdown connects Dust & Magnet, History, and Full Catalogue.

**Live site:** https://alfiyandyhr.github.io/animoviz/

---

## Three views

The root URL opens **Dust & Magnet** with **Anime titles** as dust and Inception as the example magnet.
Set **Dust type** to **Movie titles** for movie dots and Attack on Titan as the first-use example. Choose the **Movie** magnet type with anime dust or **Anime** with movie dust to search by title, alias, or year. **Movie genre** with anime dust and **Anime genre** with movie dust compare against a genre from the other catalogue. Use **Popularity** or **Score** to attract dust by audience size or rating. Fill up to three slots and remove any magnet with ×.

| View | Data and interactions |
| --- | --- |
| Dust & Magnet | Choose Anime titles, Anime studios, Anime voice actors, Movie titles, Movie actors, or Movie writers, with a field of up to 30, 60, or 90 dots. Each type includes similarity connections, a field mirror, reception, genres, release years, and a full ranking. Select a dust dot or a title magnet to see it in the In Focus panel. Anime dust types also show studio charts. |
| History | Scroll a pair of release timelines to see each year’s most popular anime and its closest movie match. Both titles have synopses and the connection shows cosine similarity. |
| Full Catalogue | The loaded 1,000-title metadata sample, with its own search, filters, sorting, pagination, details and automatic shortlist comparison. Saved movies never narrow its scope. |

The dust type, magnet picker, removable magnets, dot count, and **Reset positions** sit in the left panel.
The right panel follows the latest selected title. Anime details include AniList
images, synopsis, tags, and sampled Japanese cast. Movie details include TMDB
artwork, the archived synopsis, sampled cast, and writing credits. The movie
comparison includes release years, genres, runtimes, and archived TMDB scores
out of 10. Movie reception plots the archived user scores against popularity
ranks across the movie sample. Posters and runtimes come from a separate TMDB
details snapshot for the same movies.
Open **Filter** for dust filters.
Movie dust supports title and alias search,
genre, and release year.

In title modes, filters narrow the sampled candidates without refilling them. The field and
linked charts share the displayed set. The full similarity ranking covers every
title in the dust catalogue, marks displayed rows, and sorts by any active
magnet or their arithmetic mean. Sorting and dragging preserve membership,
scores, and selection. Removing the active sort magnet returns to average
similarity. Dot positions show the balance of attraction across magnets.

Click, tap, or use Enter/Space to toggle a title. Compare up to three titles and
their exact per-magnet scores below the field. Clicking empty playground space
deselects the latest selection. Dragging and Reset positions preserve selection.
Remove or Clear selection also updates the comparison. Every ranking row opens
the title’s details independently of the selection.
Catalogue shortlists are independent and remain in memory for that page visit.

**Anime studios** groups catalogue anime by AniList main-studio credit. Select
up to three studios to compare their filmography metrics and magnet scores.
Reception, genres, and release years show their combined catalogue anime
and count each co-production once. Genres by studio keeps each studio’s own
credits, so co-productions appear in each credited studio’s row. Clear the
selection to analyse all studios in the field. The field, mirror, similarity
connections, and full ranking continue to compare studios against the magnets.

**Anime voice actors** groups the Full Catalogue by AniList Japanese main-role
credits. Each title contributes once to an actor’s filmography. Movie magnets
average those titles’ signed cosine similarity to that movie. Movie genre magnets
average across the cohort’s movies. Popularity sums AniList list users, and Score
averages available anime scores. Zoom in on an actor for their AniList portrait.
The linked charts show distinct anime credited to actors in the field. Select up
to three actors to filter Score vs. popularity to their anime and highlight their
contributions in the genre, release year, and studio charts.

**Movie actors** groups movies by TMDB person ID using up to five sampled cast
members per movie. Anime titles and anime genre cohorts act as story magnets.
Popularity sums archived TMDB popularity scores across credited movies, and
Score averages the available ratings out of 10. Zoom in on the field or its
mirror for available TMDB portraits. Select up to three actors to filter Score
vs. popularity rank to their distinct credited movies and highlight the same
movies in the genre and release-year charts.

**Movie writers** uses the same magnets and linked chart behavior as Movie actors,
with movies grouped by their TMDB Writing department credits. Zoom in on either
field for available writer portraits. The Movie catalogue counts distinct actors
and writers across the current filters.

## Routes and session state

Native links and the keyboard-accessible dropdown support browser Back/Forward.
All assets and redirects are relative to the deployment root, including GitHub
Pages' `/animoviz/` prefix. Root and legacy redirect pages include a
relative no-JavaScript fallback link and refresh (the charts themselves need JS).

| Legacy URL or root bookmark | Destination |
| --- | --- |
| Introduction, Movie → Anime, `#recommendations`, `#dust-magnet` | Dust & Magnet |
| Content, `#content` | Main view's Genres section |
| Creators, `#creators` | Main view's Studios section |
| Reception, `#reception` | Main view's Score vs. popularity section |
| Story, `#story`, `#history` | History |
| Explorer, `#explorer`, `#catalogue` | Full Catalogue |

Legacy `?mode=matches` and `?mode=catalogue` URLs use the destination's current
scope. Full Catalogue always uses catalogue scope. Other query parameters are
preserved. Flask also serves `/history` and `/catalogue`, plus the legacy clean
paths with or without trailing slashes.

Session storage uses `aniviz-dust-session-v2` to keep the active dust type and
separate magnets, filters, dot counts, sorts, selections, positions, and scroll
for each type, using the existing direction keys. A saved session preserves an
explicitly empty field. The previous v1 session imports into **Anime titles**.
Otherwise, a resolvable `aniviz_seed_movie.tmdbId` takes priority over the
Inception example. The current matrix recomputes dust membership on restore.
**Movie titles** uses Attack on Titan on first entry. Catalogue filters use
`aniviz-catalogue-filters`. History loads annual data independently. Storage
failure permits in-memory use with one notice.
Explicit section links take priority over saved scroll on entry; reload and
Back/Forward restore the saved location, including anchored URLs.

## Frontend structure

`frontend/dust-magnet/index.html`, `frontend/story/`, and `frontend/explorer/`
are the three view entry points. Introduction, Recommendations,
Content, Creators and Reception HTML files are compatibility redirects. The
recommendation engine and dust geometry remain in `frontend/recommendations/`.
Shared modules in `frontend/common/` own navigation, independent data loading,
the ID join and dust context, reusable chart instances, lazy composition,
and inline details and comparisons.

Recommendation IDs are strings and metadata IDs are normalized before joining.
The refresh workflow builds Full Catalogue and Dust & Magnet from the same
1,000 AniList and 1,000 TMDB records. Recommendation records remain available
when the browser cannot load richer metadata.
Unknown values stay unknown, with metric-specific coverage. Metadata failure
leaves dust and similarity evidence usable; matrix failure offers Retry without
invented scores. Detailed methods, data freshness and credits sit in About / Data.

See [the shared interfaces](frontend/common/README.md) and
[the verification guide](tests/journey-verification.md) for contracts, checks,
observed outcomes and limitations.

## Configuration

The root `.env` configures the Flask API. The published catalogue refresh
always collects 1,000 unique titles from each source.

| Variable | Default | Description |
|---|---|---|
| `ANILIST_PAGES` | `20` | Number of pages fetched from AniList (max 50 per page → `20 × 50 = 1 000` anime) |
| `ANILIST_PER_PAGE` | `50` | Results per page (AniList cap: 50) |
| `CACHE_TTL_HOURS` | `6` | How long the backend caches a response before re-fetching |
| `NETWORK_NODE_LIMIT` | `90` | Maximum voice-actor nodes in the dashboard API payload |
| `NETWORK_LINK_LIMIT` | `750` | Maximum voice-actor links in the dashboard API payload |
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

Open http://localhost:5000. The website uses the same published JSON and binary
files as GitHub Pages. The Flask `/api/dashboard` and `/api/story` endpoints
also support their own cached AniList requests.

---

## Refresh Full Catalogue and Dust & Magnet

Run from the repository root with Python 3.10+ on macOS or Linux.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt -r data/semantic_similarity/requirements-embeddings.txt
```

Set `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY` in the Git-ignored
`data/.env.local`. For a new setup, copy `data/.env.example` to that path. If
your credential is still in `data/semantic_similarity/.env.local`, move it
to `data/.env.local`. Credentials supplied through environment variables
also work. AniList uses its public GraphQL API.

1. **Collect and stage the catalogue.**

   ```bash
   python data/refresh_data.py --update-dataset
   ```

   The command uses the current popularity rankings with all release years and
   non-adult titles. It keeps the first 1,000 unique AniList IDs across formats
   and scans TMDB's popular list until 1,000 unique movies remain after matching.
   Each same-version film found in both sources keeps its AniList entry, and the
   next eligible movie fills its TMDB slot. The CSV records both candidate and
   final sample ranks.

   Cast and writing credits arrive with each movie's TMDB detail request.
   The staged `movie_details.json` stores up to five distinct cast members per
   movie in TMDB billing order, with their person IDs, names, and available
   character names. A person with multiple roles still occupies one slot.
   Use the first three entries for a smaller cast sample.
   [TMDB append to response](https://developer.themoviedb.org/docs/append-to-response) · [TMDB movie credits](https://developer.themoviedb.org/reference/movie-credits)

   The matcher uses reviewed ID pairs and compares normalized titles and
   aliases, format, release dates, runtime, and synopsis evidence for new
   matches. Alternate cuts and adaptations have their own entries. The command
   prints the path to `duplicate_report.json`, which lists excluded pairs and
   ambiguous candidates retained in the sample. Missing or conflicting source
   metadata can hide duplicates. If you confirm a new pair, add it to
   `SAME_VERSION` or `DISTINCT_VERSIONS` in `data/refresh_data.py` and
   rerun collection. [AniList media fields](https://docs.anilist.co/reference/object/media) · [TMDB alternative titles](https://developer.themoviedb.org/reference/movie-alternative-titles)

   If an API request interrupts collection, repeat the command with `--resume`
   to continue from its saved page. The collected files and reports are stored
   under `data/semantic_similarity/output/catalogue/`.

2. **Score the staged catalogue and write the web files.**

   ```bash
   python data/refresh_data.py --recompute-scores
   ```

   The existing Qwen/Qwen3-Embedding-4B model downloads weights on first use
   and runs locally. You can pass `--batch-size 2` if memory is tight, or
   `--device cpu` to select the CPU. The command checks that the staged
   rosters and the complete 1,000 × 1,000 matrix agree before updating the
   website files. It also refreshes History's annual movie matches against
   the new movie sample, reusing the movie embeddings and scoring any annual
   anime winners outside the matrix. Rerunning this step after an export
   failure reuses the completed matrix for the staged catalogue.

   Genre cohorts rebuild their membership from the refreshed genres in each
   direction and average the new cosine scores. Popularity and Score use
   the refreshed AniList and TMDB metadata and recalculate midrank percentiles
   when selected.

The frontend reads the displayed dates from the published files. The Anime tab
shows the AniList collection time, the Movie tab shows its source
snapshot date, and Dust & Magnet's **About / Data**
shows when the similarity scores finished. Reload after the updated files are
available to see the new dates.

After both steps finish, open the two Catalogue tabs and try both Dust & Magnet
directions with a title, a genre from the other catalogue, Popularity, and Score. Commit the web
files together and push or merge into the branch configured for GitHub Pages.

```bash
git add data.json data/movie_recommendations.json data/movie_anime_scores.bin \
  data/movie_popularity.json data/movie_details.json data/history_movie_matches.json
git commit -m "Refresh shared anime and movie catalogue"
```

### Collect cast and writers for the published catalogue

```bash
python data/refresh_data.py --update-dataset --cast-and-writer-only
```

This collects credits for the TMDB IDs in the published recommendations and
adds them to `data/movie_details.json`. Each movie's `cast` is an ordered list
of `{id, name, order, characters}` records. Its `writers` list stores
`{id, name, jobs}` for each distinct person credited in TMDB's Writing
department, including screenplay, story, and source-material credits.
Both lists include `profile_path` when TMDB provides a portrait.
Movies without either kind of credit have an empty list for that field.
The existing similarity scores can be reused with both fields.

### Collect original creators for the published anime catalogue

```bash
python data/refresh_data.py --update-dataset --anime-creator-only
```

This looks up the existing AniList IDs in `data.json` and verifies that they
match the anime IDs in the published recommendations. It writes
`data/anime_credits.json`, keyed by AniList anime ID. The command requires no
TMDB credentials or embedding dependencies.

`original_creators` includes each person's ID, name, and roles credited by
AniList as Original Creator, Original Story, or Original Work. Records include
portrait and AniList links when available. The published `data.json` already
holds sampled Japanese voice actors and their character names in `voice_actors`.
Dust & Magnet can use the existing title scores for future creator groups, so
`--recompute-scores` is unnecessary.

### Local output files

`data/refresh_data.py` is the entry point for both steps. It calls the scorer
and exporters for you. The standalone commands in `data/semantic_similarity/`
are available for separate research runs.

`data/semantic_similarity/output/` is Git-ignored working storage. The old
`collect_anime.py` and `collect_movies.py` commands produced the CSVs and
metadata in its root, and `compute_similarity.py` produced the embeddings,
scores, and run metadata in `similarity/`. The current refresh uses
`catalogue/` for checkpoints, staged inputs, duplicate reports, and completed
score runs. The History exporter caches supplemental scores under `story/`.

You can delete `output/` before starting a fresh collection. The site reads
the published files listed above. Deleting the working directory discards the
local archives and any staged run, so keep it between the two commands and
while either command is running. The next `--update-dataset` recreates it.
The refresh stores model weights in the Hugging Face cache.

## History

Choose **History** from the view dropdown or visit `/history` or `/story` with Flask.
Scroll to advance one anime release year at a time, or use the year selector.
The left timeline follows the most popular title from that year’s AniList sample.
The right timeline marks the release years of the highest-scoring live-action
movie matches. Use **Connections** to show one to five matches, ordered by cosine
similarity. Hover over a connection or a match title to highlight both.
Select either to turn the card to that match. Open **Read synopsis** to see the
full text. Popularity uses AniList user-list counts from the published snapshot.
Both axes share a release-year scale. The anime axis starts at 1963 and the
movie axis includes earlier release years from the movie sample.

Switch from **Anime Timeline** to **Movie Timeline** to start with the top movie
by TMDB popularity in each represented release year. Each movie links to its
highest-scoring matches in the published 1,000-title AniList similarity catalogue.
The selector keeps the current release year when available and moves to the
nearest represented year otherwise. The active timeline moves to the left
when switching perspectives. Movie Timeline loads the existing movie
recommendation and popularity snapshots on first use. Both perspectives use
the same History movie sample, which requires a release year and genre metadata
and excludes TMDB Animation titles and records tagged with cartoon characters.

History reads the published `story.json` and `data/history_movie_matches.json` on
Flask and GitHub Pages. Regenerate them together so the annual winners and their
scores stay in sync:

```bash
python data/refresh_story.py
python data/export_story_recommendations.py --annual --compute-missing
```

If all supplemental scores are already cached, use `--annual --offline` to
regenerate the matches without loading the model.

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
`frontend/dust-magnet/index.html`. With **Anime titles**, try **Inception** with
**Movie genre → Science Fiction movies**. With **Movie titles**, try
**Attack on Titan** with **Anime genre → Sci-Fi anime**. Each cohort
score averages the signed cosines to its sampled titles. A cohort occupies one
slot and contributes one score to the combined average. Its membership stays
fixed when you filter the dust.

**Anime studios** keeps the movie magnets from **Anime titles** when you switch
between them. **Popularity** sums AniList list-user counts and **Score** averages
available ratings across each studio’s catalogue filmography, matching Full
Catalogue. A movie magnet averages signed cosine similarities to that movie
across the studio’s anime in the similarity matrix. A **Movie genre** magnet averages the
cosines from every pair of a studio anime and a movie in the cohort. Each magnet
uses all works with data for that magnet. Search studio names under **Filter**.
Filters change the field while studio scores and filmographies stay fixed.

With **Anime studios** or **Anime voice actors**, choose **Anime genre** to
count distinct credited catalogue anime in a genre. With **Movie actors** or
**Movie writers**, choose **Movie genre** to count distinct credited catalogue
movies in a genre. For any of these four dust types, **Title count** counts every
distinct title in the creator’s catalogue filmography. Count magnets use attraction
percentiles and keep their counts fixed when you filter the field.

Choose **Popularity** to use AniList list-user counts for anime or TMDB
popularity for movies. Choose **Score** to use AniList ratings out of 100 or
TMDB ratings out of 10. You can combine both with a title or genre cohort
within the same three slots.

With a count, Popularity, or Score magnet active, each magnet's raw values become midrank percentiles
from 0 to 1 over dust with values for every active magnet. The field and
combined ranking use those percentiles. Individual ranking sorts and score
evidence expose the raw values. Titles with missing values stay in the full
ranking with an unavailable combined rank.

Choose 30, 60, or 90 dots and use **Reset positions** directly in the left panel.
Under **Magnet strength**, each active magnet has a slider from 0× to 2×.
Higher strengths increase the magnet’s pull, and 0× turns it off.
**Reset strengths** restores each strength for the selected dust type to 1×.
The browser session saves strengths separately for each dust type. Dust coloring
is shared across types.
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
The reference sample stays fixed when dot count or filters change. Dots share
one color by default. **Color dust by strongest attraction** colors each
title by its highest-scoring magnet in the field, mirror, and linked charts.
With Popularity or Score active, the control uses the highest attraction
percentile. White outlines mark selected anime. Hover, keyboard-focus,
or select a dot to see its links. Thicker links show a stronger pull for that
dot. Hover or focus a dot to see its scores.

With two or three magnets, each dot moves toward a weighted center of the
magnets, with separate tuning for cosines and attraction percentiles. Close
scores keep a dot in the space between the corresponding magnets. A clear lead
shifts a dot toward its strongest magnet, and the title's percentile for that
magnet adjusts its preferred distance. The layout leaves space around magnets
and between dots. With one magnet, every title uses that magnet's percentile.

Dots repel each other and the magnet cores so they remain selectable. As
magnets move, dots keep their momentum and follow the new targets. The main
field and mirror show the same positions. Reduced-motion mode shows the
settled positions immediately. Use the tooltip and full ranking to compare
scores. Moving magnets and changing motion settings preserve the displayed
titles, scores, ranks, filters, and selection.

Each of up to three active movies has a compact curved-link map of its top 5 and
bottom 5 anime within the displayed dust, with local ranks and cosine scores.
With 60 visible dots the maps show ranks 1–5 and 56–60. Dot-count changes and
filters update their membership and ranks; table sorting does not. Curves,
endpoint dots and scores use the same dust colors as the field. When magnet
coloring is enabled, magnet colors stay stable after removal or reordering. The linked
content, creator, and reception charts summarize the displayed dusts. **Full anime ranking** appears
after Studio × genre, uses the complete recommendation corpus, and supports
sorting by each active movie or average similarity. Its titles open the same right
detail drawer as Full Catalogue without changing the selected dust comparison.
Neither ranking sorts nor magnet movement alter the displayed anime membership. The view lazily loads the published similarity JSON and binary
matrix, without an embedding model or API token. Similarity measures semantic
proximity, not a percentage or a prediction of enjoyment.

The web bundle contains 20 top and 20 bottom matches per movie and a 4 MB
movie-major, little-endian float32 matrix with every score. The browser
validates the matrix dimensions and hash before using it for magnets and
rankings. The Movie catalogue, reception chart, and Popularity and Score magnets share
the TMDB ratings and popularity snapshot. Popularity ranks break ties by the
retained movie order. See [the refresh workflow](#refresh-full-catalogue-and-dust--magnet)
to regenerate the bundle and its metadata together.

Run the recommendation, story, and collector checks.

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
