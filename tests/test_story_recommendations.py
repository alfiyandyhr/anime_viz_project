import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("story_recommendations", ROOT / "data/export_story_recommendations.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class StoryRecommendationsTests(unittest.TestCase):
    def test_selection_uses_each_period_and_current_popularity_with_id_ties(self):
        archive = {"meta": {"end_year": 2026}, "years": [
            {"year": 1979, "anime": [{"id": 3, "popularity": 8}, {"id": 2, "popularity": 8}]},
            {"year": 1980, "anime": [{"id": 1, "popularity": 100}]},
            {"year": 1978, "status": "unavailable", "anime": [{"id": 4, "popularity": 999}]},
        ]}
        html = '<section class="story-step" id="birth" data-start="1963" data-end="1979"></section><section class="story-step" id="modern" data-start="1980" data-end="present"></section>'
        periods = exporter.select_periods(archive, html)
        self.assertEqual([a["id"] for a in periods[0]["anime"]], [2, 3])
        self.assertEqual([a["id"] for a in periods[1]["anime"]], [1])
        self.assertEqual(periods[1]["end"], 2026)

    def test_original_movie_major_scores_are_reused_exactly_including_negatives(self):
        raw = struct.pack("<6f", 0.2, -0.1, 0.8, -0.5, 0.8, 0.3)
        base = {"meta": {"model": exporter.embedding.MODEL_ID, "score_matrix": {
            "dtype": "float32-le", "layout": "movie-major", "rows": 3, "columns": 2,
            "sha256": hashlib.sha256(raw).hexdigest()}}, "anime": [{"id": "7"}, {"id": "8"}],
            "movies": [{"id": str(i), "title": str(i), "year": 2000, "genres": [],
                        "tags": [], "synopsis": "", "url": ""} for i in range(3)]}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "scores.bin"
            path.write_bytes(raw)
            read = exporter.read_base_scores(base, path)
            self.assertEqual(read(7), [struct.unpack("<f", raw[i:i + 4])[0] for i in (0, 8, 16)])
            self.assertLess(read(8)[0], 0)
            self.assertIsNone(read(99))
            period = {"id": "p", "start": 1963, "end": 1979, "anime": [
                {"id": 7, "title": "A", "year": 1979, "popularity": 10}]}
            # Deliberately bad supplemental values must never replace an existing row.
            output = exporter.build_bundle({"meta": {}}, [period], base, read, {"7": [1, 0, 0]}, {})
            matches = output["periods"][0]["anime"][0]["matches"]
            self.assertEqual([m["movie_id"] for m in matches], ["1", "2", "0"])
            self.assertEqual(matches[0]["score"], read(7)[1])
            self.assertEqual(output["meta"]["reused_anime"], 1)
            self.assertEqual(output["meta"]["supplemental_anime"], 0)
            path.write_bytes(raw + b"x")
            with self.assertRaises(ValueError):
                exporter.read_base_scores(base, path)

    def test_missing_scores_are_never_fabricated_and_model_is_the_original_4b(self):
        period = {"id": "p", "start": 1963, "end": 1979, "anime": [
            {"id": 7, "title": "A", "year": 1979}]}
        with self.assertRaisesRegex(ValueError, "Missing scores"):
            exporter.build_bundle({"meta": {}}, [period], {"movies": [1, 2, 3]}, lambda _: None, {}, {})
        self.assertEqual(exporter.model_spec()["id"], "Qwen/Qwen3-Embedding-4B")
        self.assertEqual(exporter.model_spec()["revision"], exporter.embedding.MODEL_REVISION)
        self.assertEqual(exporter.model_spec()["dimension"], 2560)
        self.assertEqual(exporter.model_spec()["prompt"], "")

    def test_published_movie_text_reconstruction_matches_original_preprocessing(self):
        base = exporter.read_json(ROOT / "data/movie_recommendations.json")
        with tempfile.TemporaryDirectory() as folder:
            records = exporter.prepare_records(exporter.movie_rows(base["movies"]), Path(folder) / "movies.csv", "tmdb")
        for record, movie in zip(records, base["movies"]):
            self.assertEqual(record["source_id"], movie["id"])
            self.assertEqual(record["title"], movie["title"])
            self.assertEqual(record["genres"], movie["genres"])
            self.assertEqual(record["tags"], movie["tags"])
            self.assertEqual(record["synopsis"], movie["synopsis"])


if __name__ == "__main__":
    unittest.main()
