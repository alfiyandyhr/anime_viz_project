from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import app, service, story_service


class FrontendRoutesTests(unittest.TestCase):
    def test_recommendation_page_and_published_assets_need_no_upstream_requests(self):
        with app.test_client() as client, \
                patch.object(service, "get_dashboard", side_effect=AssertionError("No dashboard request")), \
                patch.object(story_service, "get_story", side_effect=AssertionError("No story request")):
            for url in ["/recommendations", "/recommendations/"]:
                with client.get(url, follow_redirects=True) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(b'id="movie-search"', response.data)
            for url, relative in [
                ("/data/movie_recommendations.json", "data/movie_recommendations.json"),
                ("/data/movie_anime_scores.bin", "data/movie_anime_scores.bin"),
                ("/data/story_movie_recommendations.json", "data/story_movie_recommendations.json"),
                ("/assets/tmdb-logo.svg", "assets/tmdb-logo.svg"),
                ("/frontend/recommendations/app.js", "frontend/recommendations/app.js"),
                ("/frontend/recommendations/dust-magnet.js", "frontend/recommendations/dust-magnet.js"),
            ]:
                with self.subTest(url=url), client.get(url) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, (ROOT / relative).read_bytes())

    def test_asset_routes_do_not_expose_other_data_files(self):
        with app.test_client() as client:
            for url in ["/data/anilist_dashboard_cache.json", "/data/semantic_similarity/.env.local"]:
                with client.get(url) as response:
                    self.assertEqual(response.status_code, 404)
