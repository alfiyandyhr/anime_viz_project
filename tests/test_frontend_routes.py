from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import app, service, story_service


class FrontendRoutesTests(unittest.TestCase):
    def test_four_views_and_legacy_redirects_serve_without_live_api_requests(self):
        with app.test_client() as client, \
                patch.object(service, "get_dashboard", side_effect=AssertionError("No dashboard request")), \
                patch.object(story_service, "get_story", side_effect=AssertionError("No story request")):
            for page in ["intro", "recommendations", "content", "creators", "reception", "dust-magnet", "network", "story", "explorer"]:
                for query in ["", "?mode=matches", "?mode=catalogue"]:
                    with self.subTest(page=page, query=query), \
                            client.get(f"/frontend/{page}/index.html{query}") as response:
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.data, (ROOT / "frontend" / page / "index.html").read_bytes())
                        if page in ["intro", "recommendations", "content", "creators", "reception"]:
                            self.assertIn(b'url=../dust-magnet/index.html', response.data)
                        else:
                            self.assertIn(b'data-view-menu', response.data)
                            self.assertNotIn(b'class="rail"', response.data)
            with client.get("/data.json") as response:
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, (ROOT / "data.json").read_bytes())

    def test_recommendation_page_and_published_assets_need_no_upstream_requests(self):
        with app.test_client() as client, \
                patch.object(service, "get_dashboard", side_effect=AssertionError("No dashboard request")), \
                patch.object(story_service, "get_story", side_effect=AssertionError("No story request")):
            for url in ["/recommendations", "/recommendations/", "/dust-magnet", "/dust-magnet/", "/network", "/network/"]:
                with client.get(url, follow_redirects=True) as response:
                    self.assertEqual(response.status_code, 200)
                    if url.startswith("/recommendations"):
                        self.assertIn(b'url=../dust-magnet/index.html', response.data)
                    elif url.startswith("/network"):
                        self.assertIn(b'id="network-chart"', response.data)
                    else:
                        self.assertIn(b'id="movie-search"', response.data)
            with client.get("/") as response:
                self.assertIn(b'url=frontend/dust-magnet/index.html', response.data)
            for url, relative in [
                ("/frontend/common/navigation.js", "frontend/common/navigation.js"),
                ("/data/movie_recommendations.json", "data/movie_recommendations.json"),
                ("/data/movie_anime_scores.bin", "data/movie_anime_scores.bin"),
                ("/data/movie_popularity.json", "data/movie_popularity.json"),
                ("/data/movie_details.json", "data/movie_details.json"),
                ("/data/story_movie_recommendations.json", "data/story_movie_recommendations.json"),
                ("/assets/tmdb-logo.svg", "assets/tmdb-logo.svg"),
                ("/frontend/recommendations/app.js", "frontend/recommendations/app.js"),
                ("/frontend/recommendations/dust-magnet.js", "frontend/recommendations/dust-magnet.js"),
            ]:
                with self.subTest(url=url), client.get(url) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, (ROOT / relative).read_bytes())

    def test_clean_paths_preserve_query_and_offer_history_and_catalogue_aliases(self):
        from urllib.parse import urlparse, parse_qs
        with app.test_client() as client:
            for view in ["intro", "content", "creators", "reception", "recommendations", "dust-magnet", "network", "story", "history", "explorer", "catalogue"]:
                for suffix in ["", "/"]:
                    with self.subTest(view=view, suffix=suffix):
                        response = client.get(f"/{view}{suffix}?mode=matches&shared=one&shared=two")
                        self.assertEqual(response.status_code, 302)
                        target = urlparse(response.location)
                        page = {"history": "story", "catalogue": "explorer"}.get(view, view)
                        self.assertEqual(target.path, f"/frontend/{page}/index.html")
                        query = parse_qs(target.query)
                        self.assertEqual(query["shared"], ["one", "two"])
                        self.assertEqual(query["mode"], ["catalogue" if page == "explorer" else "matches"])
                        with client.get(response.location) as page_response:
                            self.assertEqual(page_response.status_code, 200)
            self.assertEqual(client.get("/unknown-view").status_code, 404)

    def test_asset_routes_do_not_expose_other_data_files(self):
        with app.test_client() as client:
            for url in ["/data/anilist_dashboard_cache.json", "/data/semantic_similarity/.env.local"]:
                with client.get(url) as response:
                    self.assertEqual(response.status_code, 404)
