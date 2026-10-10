from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from anilist_service import DashboardDataError
from story_service import StoryService, annual_query
from app import app, story_service


class StoryServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = StoryService(Path(self.directory.name) / "cache.json")

    def tearDown(self):
        self.service.session.close()
        self.directory.cleanup()

    def test_queries_rank_each_year_independently_and_include_unknown_month_day(self):
        query = annual_query([1963, 1964])
        self.assertIn("y1963: Page(page: 1, perPage: 10)", query)
        self.assertIn("startDate_greater: 19629999", query)
        self.assertIn("startDate_lesser: 19640000", query)
        self.assertIn('countryOfOrigin: "JP"', query)
        self.assertIn("status_not: NOT_YET_RELEASED", query)
        self.assertIn("sort: [POPULARITY_DESC]", query)
        self.assertEqual(query.count("perPage: 10"), 2)

    def test_normalization_handles_missing_fields_and_uses_first_release_year(self):
        records = [
            {"id": 1, "startDate": {"year": 1963}, "seasonYear": 1964, "popularity": 3},
            {"id": 2, "title": {"romaji": "Romaji"}, "startDate": {"year": 1963}, "popularity": 5},
            {"id": 2, "title": {"romaji": "Romaji"}, "startDate": {"year": 1963}, "popularity": 5},
            {"id": 3, "startDate": {"year": 1964}}, None,
        ]
        anime = self.service._normalise_year(records, 1963)
        self.assertEqual([work["id"] for work in anime], [2, 1])
        self.assertEqual(anime[1]["year"], 1963)
        self.assertEqual(anime[0]["studio_names"], ["Unknown studio"])
        self.assertIsNone(anime[0]["average_score"])
        self.assertEqual(anime[0]["genres"], [])

    def test_fresh_cache_serves_without_any_upstream_request(self):
        year = time.gmtime().tm_year
        cache = {"meta": {"schema_version": 1, "generated_epoch": time.time(), "end_year": year, "complete": True}, "years": []}
        self.service._write_story_cache(cache)
        with patch.object(self.service, "_post_graphql", side_effect=AssertionError("Must not fetch")):
            self.assertEqual(self.service.get_story()["meta"]["cache_status"], "cached")

    def test_upstream_failure_preserves_cached_years_and_marks_gaps(self):
        cached = {"meta": {"schema_version": 1, "generated_epoch": 1, "generated_at": "old", "end_year": 1963},
                  "years": [{"year": 1963, "anime": [], "fetched_at": "old"}]}
        self.service._write_story_cache(cached)
        with patch.object(self.service, "_post_graphql", side_effect=DashboardDataError("Offline")) as fetch:
            result = self.service.get_story()
            self.assertFalse(result["meta"]["complete"])
            self.assertEqual(result["meta"]["stale_years"], [1963])
            self.assertIn(1964, result["meta"]["missing_years"])
            self.assertEqual(result["years"][0]["status"], "stale")
            self.assertEqual(result["years"][1]["status"], "unavailable")
            self.service.get_story()
            self.assertEqual(fetch.call_count, 1, "Failure cooldown should avoid repeated upstream requests")

    def test_no_cache_failure_is_explicit(self):
        with patch.object(self.service, "_post_graphql", side_effect=DashboardDataError("Offline")):
            with self.assertRaises(DashboardDataError):
                self.service.get_story()

    def test_live_fetch_covers_all_years_in_four_year_batches_and_caches(self):
        def fake_response(query, variables):
            import re
            years = [int(year) for year in re.findall(r"y(\d+): Page", query)]
            return {"data": {f"y{year}": {"media": [{"id": year, "title": {"english": str(year)}, "startDate": {"year": year}}]} for year in years}}
        with patch.object(self.service, "_post_graphql", side_effect=fake_response) as fetch, patch("story_service.time.sleep"):
            result = self.service.get_story()
            self.assertTrue(result["meta"]["complete"])
            self.assertEqual(len(result["years"]), time.gmtime().tm_year - 1963 + 1)
            self.assertTrue(result["years"][-1]["provisional"])
            self.assertTrue(self.service.story_cache_file.exists())
            count = fetch.call_count
            self.service.get_story()
            self.assertEqual(fetch.call_count, count)

    def test_routes_serve_story_page_and_api_without_modifying_dashboard(self):
        client = app.test_client()
        with patch.object(story_service, "get_story", return_value={"meta": {"source": "test"}, "years": []}):
            self.assertEqual(client.get("/api/story").json["meta"]["source"], "test")
        for url, expected in [("/story", 302), ("/frontend/story/index.html", 200),
                              ("/story.json", 200), ("/data.json", 200)]:
            response = client.get(url)
            self.assertEqual(response.status_code, expected)
            response.close()


if __name__ == "__main__":
    unittest.main()
