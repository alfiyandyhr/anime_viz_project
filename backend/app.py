from pathlib import Path
import os

from flask import Flask, jsonify, redirect, request, send_from_directory, url_for
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from anilist_service import AniListService, DashboardDataError
from story_service import StoryService


PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

app = Flask(
    __name__,
    static_folder=str(FRONTEND_DIR),
    static_url_path="/frontend"
)

# Same-origin serving is preferred, but CORS also makes local development easier.
CORS(app, resources={r"/api/*": {"origins": "*"}})

service = AniListService()
story_service = StoryService()


@app.get("/")
def index():
    return send_from_directory(PROJECT_ROOT, "index.html")


@app.get("/data.json")
def static_dashboard_data():
    return send_from_directory(PROJECT_ROOT, "data.json")


@app.get("/story.json")
def static_story_data():
    return send_from_directory(PROJECT_ROOT, "story.json")


@app.get("/story")
@app.get("/story/")
def story_page():
    return redirect(url_for("static", filename="story/index.html"))


@app.get("/api/story")
def story():
    """Serve cached annual rankings; refreshes happen server-side, never on scroll."""
    return jsonify(story_service.get_story())


@app.get("/api/health")
def health():
    cache_info = service.cache_status()

    return jsonify({
        "status": "ok",
        "service": "AnIViz API",
        "anilist_endpoint": service.anilist_url,
        "cache": cache_info
    })


@app.get("/api/dashboard")
def dashboard():
    """
    Return the full dashboard dataset.

    Optional query parameter:
        refresh=true

    A normal page load should not use refresh=true because the backend cache
    protects both dashboard performance and AniList's rate limit.
    """
    refresh = request.args.get("refresh", "false").lower() == "true"
    return jsonify(service.get_dashboard(force_refresh=refresh))


@app.post("/api/refresh")
def refresh():
    """Explicitly refresh the AniList dataset."""
    return jsonify(service.get_dashboard(force_refresh=True))


@app.get("/api/anime/<int:anime_id>")
def anime_detail(anime_id):
    dashboard_data = service.get_dashboard()

    anime = next(
        (
            item for item in dashboard_data.get("anime", [])
            if item.get("id") == anime_id
        ),
        None
    )

    if anime is None:
        return jsonify({
            "error": "Anime not found in the current sampled dataset."
        }), 404

    return jsonify(anime)


@app.errorhandler(DashboardDataError)
def handle_dashboard_error(error):
    return jsonify({
        "error": "The dashboard data could not be loaded.",
        "details": str(error)
    }), 503


@app.errorhandler(HTTPException)
def handle_http_error(error):
    return jsonify({
        "error": error.name,
        "details": error.description
    }), error.code


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unexpected application error")

    return jsonify({
        "error": "Unexpected server error.",
        "details": str(error) if app.debug else "Check the Flask console."
    }), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))

    print("=" * 68)
    print("AnIViz — Anime Industry Visualization")
    print(f"Dashboard: http://localhost:{port}")
    print(f"Health API: http://localhost:{port}/api/health")
    print("=" * 68)

    app.run(
        host="0.0.0.0",
        port=port,
        debug=os.getenv("FLASK_DEBUG", "true").lower() == "true"
    )
