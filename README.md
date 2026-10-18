# AnIViz — Anime Industry Visualization

A story-driven visualization of what makes anime resonate — four chapters (Reception → Content → Creators → Movie → Anime), built with Python/Flask, AniList GraphQL API, and D3.js.

**Live site:** https://alfiyandyhr.github.io/anime_viz_project/

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

## Movie → Anime recommendations (chapter 04)

Open **Movie → Anime** in the rail, or visit `#recommendations`. The default
**Dust & magnets** view lets you add one, two, or three favorite movies through
search or suggestions. Remove a movie with its × button. Drag magnets (or focus
one and use arrow keys) to rearrange the field; **Reset positions** restores the
layout. Hover or keyboard-focus an anime dot for its title and exact cosine score
to each movie. Click or press Enter to update the anime details, storyline,
genres, tags, and AniList link. **Read story** takes you to the detail panel on
smaller screens.

The field defaults to **60 dots**, with 30 and 90 options. It reserves half the
candidate budget equally for each movie's strongest matches, then fills remaining
slots with the highest mean cosine scores across all selected movies, deduplicating
overlap. All candidates are scored using the complete matrix. Color identifies
the highest-scoring movie; pink marks the selected anime. Only selected/hovered
connections appear, and collision spacing keeps dots apart.

Target distance is proportional to `sqrt(2 - 2 * cosine)`, the Euclidean distance
between normalized embeddings. A deterministic stress layout balances those
target distances in 2D, then separates dots for readability. Distances are
approximate, especially with multiple magnets; anime-to-anime distances carry
no meaning. Exact per-movie scores remain available in tooltips and details.

**Connection map** compares one movie’s **Top & Bottom 5** or **Top & Bottom 10**,
including global ranks. Below the map, **Full anime ranking** lists all anime by
similarity, with 10 rows per page and Explorer-style page numbers and Previous/Next
controls. Select any ranked anime to read its details. Choosing a different movie
resets the table to page 1 and starts a fresh one-movie selection.

This chapter uses its own movie controls, independently of the dashboard’s
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

Run recommendation and existing network checks:

```bash
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Movie metadata comes from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. The bundled approved TMDB logo by Travis Bell
is preserved from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg)
under its [CC BY-SA 4.0 license](https://creativecommons.org/licenses/by-sa/4.0/).
