# Anime–movie semantic analysis: local data collection

This is an independent Python 3.10+ workflow. It adds files without changing the
existing Flask/D3 dashboard, its refresh script, or `data.json`. No packages need
to be installed: the collectors use the Python standard library.

The current project uses `backend/anilist_service.py` to fetch popular anime,
build dashboard statistics, and cache them. `data/refresh_data.py` writes the
static site's `data.json`. That workflow includes descriptions and genres but
does not request AniList tags. These collectors fetch directly from the live
APIs instead of reusing the dashboard cache.

## Scope and freshness

- **Anime:** first 1,000 unique entries in AniList `POPULARITY_DESC` order;
  `ID` breaks ties. All anime formats are included (TV, movie, OVA, etc.).
- **Movies:** first 1,000 unique entries from TMDB `/movie/popular`, across
  original languages. This endpoint orders by popularity, rather than rating,
  box-office revenue, or the weekly trending list.
- Both exclude adult entries by default, matching the current dashboard's anime
  filter. Add `--include-adult` to include adult entries in either sample;
  movies then use the equivalent discover endpoint with that filter changed.
- "Fresh" means live metadata and ranking at collection time. There is no
  release-year filter: older popular titles and unreleased entries can appear.
- AniList public metadata needs no credential. This project is educational;
  [AniList's terms](https://docs.anilist.co/guide/terms-of-use) prohibit mass
  collection and state leniency for purely educational projects. This is a
  bounded analysis sample, not a full catalogue mirror. Check eligibility again
  before using it outside educational research.
- AniList popularity counts users who have a title on their lists. TMDB uses a
  different score involving activity and other signals. Keep these values as
  source-specific selection metadata; do not compare their raw magnitudes.
  See [AniList media](https://docs.anilist.co/reference/object/media) and
  [TMDB popularity](https://developer.themoviedb.org/docs/popularity-and-trending).

Paginated APIs cannot provide a transactionally frozen top 1,000. Rankings can
change while fetching. The scripts deduplicate IDs, fetch extra pages if needed,
and preserve the first-seen ordering. `popularity_rank` is the observed sample
position. Movie selection finishes before detail enrichment begins.

## Obtain free TMDB access

TMDB provides the fields this analysis needs: translated titles, genre names,
overviews (synopses), and keywords (the movie equivalent of tags).

1. Create a free account at [TMDB](https://www.themoviedb.org/signup) and sign in.
2. Open [Settings → API](https://www.themoviedb.org/settings/api).
3. Apply for a developer API credential, accept the current terms, and describe
   your educational anime–movie similarity research honestly in the application.
   TMDB recommends registering from a desktop browser.
4. Copy the **API Read Access Token**. The v3 **API Key** is also supported;
   they are different credentials, so use the matching variable below.

[TMDB's FAQ](https://developer.themoviedb.org/docs/faq) says non-commercial use
is free with attribution; commercial use requires contacting TMDB for licensing.
The free developer API provides the metadata used here. Before displaying TMDB
data in the application, add its approved logo and this notice to About/Credits:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The movie metadata sidecar also records that notice. The existing UI is not
changed by this collection workflow.

## Configure the credential locally

Run these commands from the repository root:

```bash
cp data/semantic_similarity/.env.example data/semantic_similarity/.env.local
```

Open the new `.env.local` file in your editor and fill **one** variable:

```dotenv
TMDB_READ_ACCESS_TOKEN=your_api_read_access_token
# Or, instead:
TMDB_API_KEY=your_v3_api_key
```

Do not put the credential in the root `.env`: that existing file is tracked by
this repository. The new directory's `.gitignore` excludes `.env.local` and
`output/`. Environment variables also work and take precedence over matching
values in `.env.local`. An optional `--env-file /absolute/path/to/file` can select
another file; parsing supports simple `KEY=value` lines, not shell expressions
or interpolation. No credentials are stored in CSVs or checkpoints.

## Gather the two datasets

```bash
python3 data/semantic_similarity/collect_anime.py
python3 data/semantic_similarity/collect_movies.py
```

Default outputs (relative to this directory, regardless of your working directory):

```text
output/anime_top_1000.csv
output/anime_top_1000.metadata.json
output/movies_top_1000.csv
output/movies_top_1000.metadata.json
```

Anime normally needs 20 requests at 50 results per page. Movies normally need
50 popular-list requests at 20 results per page, followed by 1,000 detail
requests with `append_to_response=keywords`: about 1,050 requests total.
The append parameter combines movie details and keywords in one request;
see [popular movies](https://developer.themoviedb.org/reference/movie-popular-list),
[movie details](https://developer.themoviedb.org/reference/movie-details), and
[append to response](https://developer.themoviedb.org/docs/append-to-response).
Extra pages may be needed when live ordering causes duplicate IDs.

Allow roughly one to a few minutes for anime and several to tens of minutes
for movies, depending on latency/retries. Anime requests are spaced at least
2.1 seconds apart, consistent with the documented temporary
[30 requests/minute limit](https://docs.anilist.co/guide/rate-limiting).
Movie requests default to 0.3 seconds apart. Both honor `Retry-After`, retry
temporary failures with bounded attempts, and print progress. TMDB's current
[rate-limit guidance](https://developer.themoviedb.org/docs/rate-limiting)
requires clients to respect HTTP 429 responses.

For a small smoke check, use a separate output filename:

```bash
python3 data/semantic_similarity/collect_anime.py --limit 10 --output /tmp/anime_sample.csv
python3 data/semantic_similarity/collect_movies.py --limit 10 --output /tmp/movie_sample.csv
```

An interrupted run saves a `.checkpoint.json` alongside the target CSV. Resume
with the **same selection options and output path**, adding `--resume`:

```bash
python3 data/semantic_similarity/collect_anime.py --resume
python3 data/semantic_similarity/collect_movies.py --resume
```

Resume continues the original sample, so its records may span different fetch
times. Omit `--resume` for a new live run. A successful run replaces the target
CSV and metadata; an API failure leaves any prior complete CSV in place and
keeps the checkpoint. A complete CSV is emitted only when the requested number
of unique records has been collected. Run only one collector process per output
path at a time.

## CSV fields

Both datasets have the same UTF-8, standard CSV schema. Commas, quotes, and
newlines are properly escaped by Python's CSV writer.

| Field | Meaning |
| --- | --- |
| `title` | Name used for analysis: English → romaji → native for anime; requested TMDB translation → original for movies |
| `genres` | JSON array of source genre names |
| `tags` | JSON array of AniList tag names / TMDB keyword names |
| `synopsis` | Plain text from AniList description / TMDB overview; HTML and excess whitespace removed |
| `semantic_text` | Title, genres, tags, and synopsis combined with consistent labels |
| `source`, `source_id`, `source_url` | Provenance; use `(source, source_id)` as the record key |
| `popularity_rank`, `popularity` | Observed position and source-specific popularity value |
| `title_original`, `title_english`, `title_romaji`, `title_native` | Alternative title forms when supplied by the source |
| `tags_details` | Original tag objects: AniList includes relevance rank and spoiler flags; TMDB includes keyword IDs |
| `release_date`, `release_year`, `format`, `status`, `is_adult`, `original_language` | Context; unknown dates/languages remain blank |
| `average_score` | Source rating: AniList 0–100, TMDB 0–10; not a semantic similarity score |
| `fetched_at_utc` | When that record was normalized from a live API response |

The default movie language is `en-US`; this requests translated text without
restricting the movies' original languages. A translated synopsis may still be
missing. Anime descriptions are provided by AniList, with no language selector.
No missing text or tags are invented, and records with missing fields are kept
so the popular sample is not silently changed. Metadata reports missing-field
counts. Empty lists are stored as `[]`, and missing text as an empty cell.

AniList spoiler tags are excluded from `tags`/`semantic_text` by default. Their
original objects remain in `tags_details`; add `--include-spoilers` to use them
in the analysis text. TMDB keywords do not provide equivalent spoiler flags.

Read the list columns as JSON, not by splitting on commas:

```python
import csv
import json

with open("data/semantic_similarity/output/anime_top_1000.csv", encoding="utf-8", newline="") as f:
    anime = list(csv.DictReader(f))
for item in anime:
    item["genres"] = json.loads(item["genres"])
    item["tags"] = json.loads(item["tags"])
```

## Next analysis step

These files prepare the corpus; the collectors do not compute similarity scores.
The two samples permit 1,000 × 1,000 = 1,000,000 anime–movie comparisons.
A next script can embed `semantic_text` using the same text embedding model for
both sources and calculate cosine similarity. For greater control, embed title,
genres, tags, and synopsis separately and combine their cosine similarities
with documented weights, giving synopsis/themes more influence than names.
Evaluate matches manually before interpreting thresholds; cosine similarity is
not a calibrated probability.

Genre and tag vocabularies differ between sources, so embedding-based comparison
is more suitable than exact string matching alone. Keep source labels out of the
semantic input. TMDB includes anime films too, so the two corpora can overlap:
identify same-work matches separately if the research question is about broader
thematic connections. AniList also treats seasons/sequels as separate records;
this sample does not merge franchises.

Run the collectors' offline checks from the repository root:

```bash
python3 -m unittest discover -s data/semantic_similarity/tests -v
```
