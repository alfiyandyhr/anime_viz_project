from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
import refresh_data as refresh


def staff_page(*rows):
    return {"data": {"Page": {"media": [
        {"id": anime_id, "staff": {"pageInfo": {"hasNextPage": more}, "edges": edges}}
        for anime_id, more, edges in rows
    ]}}}


class AnimeCreditsRefreshTests(unittest.TestCase):
    def test_metadata_only_refresh_paginates_and_joins_by_published_id(self):
        author = {"id": 31, "name": {"full": "Original Author"}}
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data"
            dashboard = root / "data.json"
            recommendations = data / refresh.RECOMMENDATIONS
            matrix = data / refresh.MATRIX
            output = data / "anime_credits.json"
            refresh.write_json(dashboard, {"anime": [{"id": 2}, {"id": 1}]})
            refresh.write_json(recommendations, {"anime": [{"id": "1"}, {"id": "2"}]})
            matrix.write_bytes(b"existing scores")
            refresh.write_json(output, {"previous": "credits"})
            unchanged = {path: path.read_bytes() for path in (dashboard, recommendations, matrix, output)}

            with patch.multiple(refresh, ROOT=root, DATA=data, WORKSPACE=data / "staged"), \
                    patch.object(sys, "argv", ["refresh_data.py", "--update-dataset", "--anime-creator-only"]), \
                    patch.object(refresh, "JsonClient") as create_client, \
                    patch.object(refresh, "update_dataset") as full_refresh, \
                    patch.object(refresh, "recompute_scores") as score:
                client = create_client.return_value
                first_page = staff_page((1, False, []), (2, True, [
                    {"role": "Director", "node": author},
                    {"role": "Original Character Design", "node": {"id": 99, "name": {"full": "Designer"}}},
                    {"role": "Original Creator", "node": author},
                ]))
                client.request.side_effect = [first_page, staff_page()]
                with patch.object(sys, "stderr"), self.assertRaises(SystemExit) as error:
                    refresh.main()
                self.assertEqual(error.exception.code, 1)
                self.assertEqual(output.read_bytes(), unchanged[output])

                client.request.reset_mock()
                client.request.side_effect = [
                    first_page, staff_page((2, False, [
                        {"role": "Original Creator", "node": author}, {"role": "Original Story", "node": author},
                    ])),
                ]
                refresh.main()
                full_refresh.assert_not_called()
                score.assert_not_called()

            requests = [request.kwargs["payload"] for request in client.request.call_args_list]
            self.assertEqual([(p["variables"]["ids"], p["variables"]["page"]) for p in requests],
                             [([2, 1], 1), ([2], 2)])
            for request in requests:
                self.assertIn("id_in: $ids", request["query"])
                self.assertIn("staff(page: $page", request["query"])
                self.assertNotIn("characters", request["query"])
                self.assertNotIn("voiceActors", request["query"])
            credits = refresh.read_json(output)
            self.assertEqual(credits["record_count"], 2)
            self.assertNotIn("cast_language", credits)
            self.assertEqual(credits["anime"]["1"], {"original_creators": []})
            self.assertEqual(credits["anime"]["2"], {
                "original_creators": [{"id": "31", "name": "Original Author", "image": None, "site_url": None,
                                       "roles": ["Original Creator", "Original Story"]}],
            })
            for path in (dashboard, recommendations, matrix):
                self.assertEqual(path.read_bytes(), unchanged[path])
