# AnIViz — Anime Industry Visualization

A story-driven visualization of what makes anime resonate — reading through the most-followed titles on AniList in three chapters (Reception → Content → Creators), built with Python/Flask, AniList GraphQL API, and D3.js.

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
├── explorer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── story/
    ├── index.html
    ├── styles.css
    ├── data.js
    └── app.js
```

The root `index.html` redirects to the introduction and preserves existing
chapter bookmarks such as `#creators`. Page navigation uses relative URLs for
Flask and GitHub Pages. Filters persist across pages for the current browser
session. The bundled dataset remains at the project root as `data.json`.

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
running. The page tells six connected chapters from 1963 to the current year.
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

To add a historical chapter, add a `.story-step` section to
`frontend/story/index.html` with its start/end years, theme, and accent color,
then add its link to `.era-nav`. Scroll and chart logic derive periods from
these attributes. `data.js` contains independently testable sample and scroll
transformations; `app.js` owns the D3 joins, controls, and data loading.

Run the relevant checks with:

```bash
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.cjs
```
