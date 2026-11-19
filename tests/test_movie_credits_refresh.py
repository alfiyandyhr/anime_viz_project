from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
import refresh_data as refresh


class MovieCreditsRefreshTests(unittest.TestCase):
    def test_update_dataset_stages_cast_and_writers_separately_from_scoring_input(self):
        cast = [
            {"id": person, "name": "Same Name" if person in (1, 2) else f"Person {person}",
             "order": person - 1, "character": f"Character {person}"}
            for person in range(6, 0, -1)
        ]
        cast.append({"id": 1, "order": 12, "character": "Other Role", "profile_path": "/portrait.jpg"})
        writer = {"id": 525, "name": "Christopher Nolan", "department": "Writing"}
        screenplay = {**writer, "job": "Screenplay"}
        crew = [
            {**writer, "department": "Directing", "job": "Director"},
            screenplay,
            {**writer, "job": "Story", "profile_path": "/writer-portrait.jpg"},
            screenplay,
            {"id": 80, "name": "Another Writer", "department": "Writing", "job": "Novel"},
        ]
        movie = {
            "id": 50, "title": "Movie", "overview": "Movie synopsis.", "vote_average": 7,
            "vote_count": 20, "keywords": {"keywords": []}, "alternative_titles": {"titles": []},
            "credits": {"cast": cast, "crew": crew},
        }
        anime = {"id": 20, "title": {"english": "Anime"}, "popularity": 100}
        anilist = Mock()
        anilist.request.return_value = {"data": {"Page": {"media": [anime]}}}
        tmdb = Mock()
        tmdb.request.side_effect = [
            {"results": [{"id": 50, "popularity": 100}], "total_pages": 1}, movie,
        ]
        with TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            with patch.multiple(refresh, WORKSPACE=workspace, LATEST=workspace / "latest.json",
                                CHECKPOINT_BASE=workspace / "collection.json", COUNT=1), \
                    patch.object(refresh, "tmdb_client", return_value=tmdb), \
                    patch.object(refresh, "JsonClient", return_value=anilist):
                refresh.update_dataset(resume=False)
                folder, _, movie_ids = refresh.load_dataset()

            self.assertEqual(movie_ids, ["50"])
            self.assertEqual(len(tmdb.request.call_args_list), 2)
            request_params = tmdb.request.call_args.kwargs["params"]
            self.assertIn("credits", request_params["append_to_response"].split(","))
            details = refresh.read_json(folder / "movie_details.json")["movies"]["50"]
            collected = details["cast"]
            self.assertEqual([person["id"] for person in collected], ["1", "2", "3", "4", "5"])
            self.assertEqual(collected[0], {"id": "1", "name": "Same Name", "order": 0,
                                            "characters": ["Character 1", "Other Role"],
                                            "profile_path": "/portrait.jpg"})
            self.assertEqual(collected[1]["name"], "Same Name")
            self.assertEqual(details["writers"], [
                {"id": "525", "name": "Christopher Nolan", "jobs": ["Screenplay", "Story"],
                 "profile_path": "/writer-portrait.jpg"},
                {"id": "80", "name": "Another Writer", "jobs": ["Novel"]},
            ])
            csv_text = (folder / refresh.MOVIE_CSV).read_text(encoding="utf-8")
            self.assertNotIn("Character 1", csv_text)
            self.assertNotIn("Christopher Nolan", csv_text)
            self.assertNotIn("cast", csv_text.splitlines()[0])
            self.assertNotIn("writers", csv_text.splitlines()[0])

    def test_cast_and_writer_only_updates_published_ids_and_preserves_scores_even_on_failure(self):
        with TemporaryDirectory() as temporary:
            data = Path(temporary)
            recommendations = data / refresh.RECOMMENDATIONS
            matrix = data / refresh.MATRIX
            details = data / "movie_details.json"
            refresh.write_json(recommendations, {"movies": [{"id": "50"}, {"id": "51"}]})
            matrix.write_bytes(b"existing scores")
            existing = {"schema_version": 1, "source": "TMDB", "record_count": 2,
                        "movies": {"50": {"runtime": 90}, "51": {"runtime": 95}}}
            refresh.write_json(details, existing)
            unchanged = {path: path.read_bytes() for path in (recommendations, matrix, details)}
            credits = {
                "id": 50, "cast": [{"id": 7, "name": "Actor", "character": "Role"}],
                "crew": [{"id": 8, "name": "Writer", "department": "Writing", "job": "Writer"}],
            }

            with patch.multiple(refresh, DATA=data, WORKSPACE=data / "staged"), \
                    patch.object(sys, "argv", ["refresh_data.py", "--update-dataset", "--cast-and-writer-only"]), \
                    patch.object(refresh, "tmdb_client") as create_client:
                client = create_client.return_value
                client.request.side_effect = [credits, {"id": 51, "cast": []}]
                with patch.object(sys, "stderr"), self.assertRaises(SystemExit):
                    refresh.main()
                self.assertEqual(details.read_bytes(), unchanged[details])

                client.request.reset_mock()
                client.request.side_effect = [credits, {"id": 51, "cast": [], "crew": []}]
                refresh.main()
                self.assertEqual(client.request.call_args_list, [
                    call(f"{refresh.TMDB_URL}/movie/50/credits", params={"language": refresh.LANGUAGE}),
                    call(f"{refresh.TMDB_URL}/movie/51/credits", params={"language": refresh.LANGUAGE}),
                ])
                updated = refresh.read_json(details)["movies"]
                self.assertEqual(updated["50"]["cast"], [
                    {"id": "7", "name": "Actor", "order": None, "characters": ["Role"]},
                ])
                self.assertEqual(updated["50"]["writers"], [{"id": "8", "name": "Writer", "jobs": ["Writer"]}])
                self.assertEqual(updated["51"], {"runtime": 95, "cast": [], "writers": []})
                self.assertEqual(updated["50"]["runtime"], 90)
                for path in (recommendations, matrix):
                    self.assertEqual(path.read_bytes(), unchanged[path])
