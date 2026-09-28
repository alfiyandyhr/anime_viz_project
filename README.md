# AnIViz — Anime Industry Visualization

A story-driven visualization of what makes anime resonate — reading through the most-followed titles on AniList in three chapters (Reception → Content → Creators), built with Python/Flask, AniList GraphQL API, and D3.js.

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
