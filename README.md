# Anime Industry Atlas

Interactive visualization of anime titles, studios, genres, scores, and Japanese voice-actor networks — built with Python/Flask, AniList GraphQL API, and D3.js.

**Live site:** https://alfiyandyhr.github.io/anime_viz_project/

---

## Run the backend locally

```bash
# Install dependencies (Python 3.10+)
pip install -r backend/requirements.txt

# Start the Flask server
python backend/app.py
```

Open http://localhost:5000. The backend fetches live data from AniList on the first request and caches it for 6 hours.

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
