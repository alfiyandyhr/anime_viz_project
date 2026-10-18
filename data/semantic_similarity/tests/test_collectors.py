"""Offline checks for selection, resumability, CSV fidelity and API failures."""
import csv
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collect_anime import collect_anime, normalise_anime
from collect_movies import collect_movies
from common import CollectionError, FIELDS, JsonClient, checkpoint_path, load_tmdb_credentials


def anime(identifier):
    return {"id": identifier, "title": {"english": f'Anime {identifier}, "story"'},
            "description": "<b>A hero</b><br> meets a friend &amp; rival.", "genres": ["Action"],
            "tags": [{"id": 1, "name": "Friendship", "rank": 80},
                     {"id": 2, "name": "Hidden ending", "rank": 90, "isMediaSpoiler": True}],
            "popularity": 2000 - identifier, "startDate": {"year": 2020}, "format": "TV"}


def detail(identifier, keywords=True):
    value = {"id": identifier, "title": f"Movie {identifier}", "overview": 'A hero, a friend, and "hope".',
             "genres": [{"id": 1, "name": "Science Fiction"}], "original_language": "ja",
             "original_title": "映画", "popularity": 999, "release_date": "2021-01-01"}
    if keywords:
        value["keywords"] = {"keywords": [{"id": 7, "name": "friendship"}]}
    return value


class FakeClient:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def request(self, url, params=None, payload=None):
        self.calls.append((url, params, payload))
        return self.responder(url, params, payload)


class CollectorsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name) / "sample.csv"
        stdout = patch("sys.stdout", new=io.StringIO())
        stdout.start()
        self.addCleanup(stdout.stop)

    def rows(self):
        with self.output.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            self.assertEqual(reader.fieldnames, FIELDS)
            return list(reader)

    def test_anime_exact_1000_across_20_pages(self):
        def respond(url, params, payload):
            variables = payload["variables"]
            self.assertEqual(variables["perPage"], 50)
            self.assertIs(variables["isAdult"], False)
            first = (variables["page"] - 1) * 50 + 1
            return {"data": {"Page": {"media": [anime(i) for i in range(first, first + 50)],
                                      "pageInfo": {"hasNextPage": True}}}}
        client = FakeClient(respond)
        collect_anime(self.output, client=client)
        rows = self.rows()
        self.assertEqual(len(rows), 1000)
        self.assertEqual(len({row["source_id"] for row in rows}), 1000)
        self.assertEqual(len(client.calls), 20)
        self.assertEqual(rows[-1]["popularity_rank"], "1000")
        self.assertFalse(checkpoint_path(self.output).exists())

    def test_anime_csv_roundtrip_and_spoiler_policy(self):
        record = normalise_anime(anime(1), 1)
        self.assertEqual(record["synopsis"], "A hero meets a friend & rival.")
        self.assertEqual(json.loads(record["tags"]), ["Friendship"])
        self.assertEqual(len(json.loads(record["tags_details"])), 2)
        self.assertEqual(record["release_date"], "")
        self.assertEqual(record["release_year"], 2020)
        spoilers = normalise_anime(anime(1), 1, include_spoilers=True)
        self.assertIn("Hidden ending", json.loads(spoilers["tags"]))
        client = FakeClient(lambda *args: {"data": {"Page": {"media": [anime(1)],
                                                    "pageInfo": {"hasNextPage": False}}}})
        collect_anime(self.output, limit=1, client=client)
        self.assertEqual(self.rows()[0]["semantic_text"], record["semantic_text"])

    def test_anime_duplicates_and_resume(self):
        def interrupted(url, params, payload):
            if payload["variables"]["page"] == 2:
                raise CollectionError("temporary failure")
            return {"data": {"Page": {"media": [anime(1), anime(2)],
                                      "pageInfo": {"hasNextPage": True}}}}
        with self.assertRaises(CollectionError):
            collect_anime(self.output, limit=3, client=FakeClient(interrupted))
        self.assertFalse(self.output.exists())
        def resume(url, params, payload):
            self.assertEqual(payload["variables"]["page"], 2)
            return {"data": {"Page": {"media": [anime(2), anime(3)],
                                      "pageInfo": {"hasNextPage": False}}}}
        collect_anime(self.output, limit=3, resume=True, client=FakeClient(resume))
        self.assertEqual([row["source_id"] for row in self.rows()], ["1", "2", "3"])

    def test_movies_paginate_deduplicate_and_enrich_keywords(self):
        def respond(url, params, payload):
            if url.endswith("/popular"):
                ids = [10, 11] if params["page"] == 1 else [11, 12]
                return {"results": [{"id": i, "popularity": 100 - i} for i in ids], "total_pages": 2}
            self.assertEqual(params["append_to_response"], "keywords")
            return detail(int(url.rsplit("/", 1)[1]))
        client = FakeClient(respond)
        collect_movies(self.output, limit=3, client=client)
        rows = self.rows()
        self.assertEqual([row["source_id"] for row in rows], ["10", "11", "12"])
        self.assertEqual(rows[0]["popularity"], "90")
        self.assertEqual(json.loads(rows[0]["tags"]), ["friendship"])
        self.assertIn('"hope"', rows[0]["synopsis"])
        self.assertEqual(rows[0]["original_language"], "ja")
        self.assertEqual(len(client.calls), 5)

    def test_movie_resume_preserves_selection_and_old_csv_on_failure(self):
        self.output.write_text("previous complete CSV", encoding="utf-8")
        def interrupted(url, params, payload):
            if url.endswith("/popular"):
                return {"results": [{"id": 10}, {"id": 11}], "total_pages": 1}
            return detail(int(url.rsplit("/", 1)[1]), keywords=not url.endswith("/11"))
        with self.assertRaises(CollectionError):
            collect_movies(self.output, limit=2, client=FakeClient(interrupted))
        self.assertEqual(self.output.read_text(), "previous complete CSV")
        def resume(url, params, payload):
            self.assertTrue(url.endswith("/11"))
            return detail(11)
        client = FakeClient(resume)
        collect_movies(self.output, limit=2, resume=True, client=client)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(len(self.rows()), 2)

    def test_checkpoint_config_mismatch(self):
        client = FakeClient(lambda *args: {"results": [{"id": 1}], "total_pages": 1})
        with self.assertRaises(CollectionError):
            collect_movies(self.output, limit=2, client=client)
        with self.assertRaisesRegex(CollectionError, "settings differ"):
            collect_movies(self.output, limit=3, resume=True, client=client)

    def test_empty_fields_are_reported_without_changing_sample(self):
        movie = detail(1)
        movie["overview"] = None
        movie["keywords"] = {"keywords": []}
        client = FakeClient(lambda url, *args: (
            {"results": [{"id": 1}], "total_pages": 1} if url.endswith("/popular") else movie))
        metadata = collect_movies(self.output, limit=1, client=client)
        self.assertEqual(metadata["missing_fields"]["synopsis"], 1)
        self.assertEqual(metadata["missing_fields"]["tags"], 1)
        self.assertEqual(len(self.rows()), 1)

    def test_credentials_environment_precedence_and_missing_message(self):
        path = Path(self.directory.name) / ".env.local"
        path.write_text("TMDB_READ_ACCESS_TOKEN=file-token\nTMDB_API_KEY=file-key\nIGNORED=x\n")
        with patch.dict(os.environ, {"TMDB_READ_ACCESS_TOKEN": "environment-token"}, clear=True):
            self.assertEqual(load_tmdb_credentials(path), ("environment-token", "file-key"))
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(CollectionError, "credential missing"):
                load_tmdb_credentials(path.with_name("missing.env"))

    def test_http_retry_after_and_auth_error_redaction(self):
        class Response(io.BytesIO):
            headers = {}
        rate_error = HTTPError("https://example.test", 429, "limited", {"Retry-After": "7"}, None)
        client = JsonClient("TMDB", 0, api_key="secret-key")
        with patch("common.urlopen", side_effect=[rate_error, Response(b'{"results": []}')]), \
                patch.object(client, "wait") as wait:
            self.assertEqual(client.request("https://example.test"), {"results": []})
            self.assertIn(unittest.mock.call(7.0), wait.call_args_list)
        auth_error = HTTPError("https://example.test?api_key=secret-key", 401, "secret-key", {}, None)
        with patch("common.urlopen", side_effect=auth_error):
            with self.assertRaises(CollectionError) as raised:
                client.request("https://example.test")
            self.assertNotIn("secret-key", str(raised.exception))
            self.assertIn("credential", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
