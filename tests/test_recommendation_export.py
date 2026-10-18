import importlib.util
import csv
import gzip
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("export_recommendations", ROOT / "data/export_recommendations.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class RecommendationExportTests(unittest.TestCase):
    def make_pair_fixture(self, folder, rows):
        with gzip.open(folder / "all_pairs.csv.gz", "wt", encoding="utf-8", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["anime_index", "anime_id", "movie_index", "movie_id", "cosine_similarity"])
            writer.writerows(rows)

    def test_bottom_matches_use_full_matrix_with_stable_ties_and_negative_scores(self):
        anime = [{"id": str(index)} for index in range(4)]
        movies = [{"id": "movie"}]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            # Last global ranks favor later anime indices when scores are tied.
            self.make_pair_fixture(folder, [
                [3, "3", 0, "movie", 0.2], [1, "1", 0, "movie", -0.1],
                [2, "2", 0, "movie", -0.1], [0, "0", 0, "movie", 0.9]
            ])
            self.assertEqual(exporter.read_bottom_matches(folder, anime, movies, count=2),
                             [[[2, -0.1], [1, -0.1]]])
            self.assertEqual(exporter.read_bottom_matches(folder, anime, movies, count=1),
                             [[[2, -0.1]]])

    def test_missing_or_duplicate_matrix_pairs_are_rejected(self):
        anime = [{"id": "0"}, {"id": "1"}]
        movies = [{"id": "movie"}]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            row = [0, "0", 0, "movie", 0.2]
            self.make_pair_fixture(folder, [row])
            with self.assertRaisesRegex(ValueError, "every anime"):
                exporter.read_bottom_matches(folder, anime, movies, count=1)
            self.make_pair_fixture(folder, [row, row])
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                exporter.read_bottom_matches(folder, anime, movies, count=1)

    def test_web_bundle_exactly_matches_completed_run(self):
        if not (exporter.DEFAULT_INPUT / "similarity/run_metadata.json").exists():
            self.skipTest("Local similarity analysis outputs are unavailable")
        expected = exporter.build_bundle(exporter.DEFAULT_INPUT)
        bundled = json.loads(exporter.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        self.assertEqual(bundled, expected)
        self.assertEqual(bundled["meta"]["pair_count"], 1_000_000)

    def test_incomplete_run_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "similarity").mkdir()
            (folder / "similarity/run_metadata.json").write_text('{"status":"incomplete"}')
            with self.assertRaisesRegex(ValueError, "must be complete"):
                exporter.build_bundle(folder)

    def test_changed_similarity_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "similarity").mkdir()
            (folder / "similarity/run_metadata.json").write_text(json.dumps({
                "status": "complete", "output_sha256": {"anime_records.jsonl": "old-hash"}
            }))
            (folder / "similarity/anime_records.jsonl").write_text("changed")
            with self.assertRaisesRegex(ValueError, "changed since computation"):
                exporter.build_bundle(folder)


if __name__ == "__main__":
    unittest.main()
