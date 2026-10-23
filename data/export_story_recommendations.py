"""Build period anime -> movie recommendations, reusing every existing pair score.

Only missing anime are encoded. The movie corpus and preprocessing are the same
as the published Movie -> Anime run. Raw vectors/weights stay in ignored output/.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import math
import struct
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data/semantic_similarity"))
import compute_similarity as embedding


def digest(path):
    return embedding.sha256(Path(path))


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False,
                                   separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


class PeriodParser(HTMLParser):
    def __init__(self, end_year):
        super().__init__()
        self.end_year, self.periods = end_year, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "section" and "story-step" in attrs.get("class", "").split():
            self.periods.append({"id": attrs["id"], "start": int(attrs["data-start"]),
                                 "end": self.end_year if attrs["data-end"] == "present"
                                 else int(attrs["data-end"])})


def select_periods(archive, html, limit=10):
    parser = PeriodParser(archive["meta"]["end_year"])
    parser.feed(html)
    result = []
    for period in parser.periods:
        works = {work["id"]: work for row in archive["years"]
                 if period["start"] <= row["year"] <= period["end"]
                 and row.get("status") != "unavailable" for work in row["anime"]}
        ranked = sorted(works.values(), key=lambda work: (-(work.get("popularity") or 0), work["id"]))
        result.append({**period, "anime": ranked[:limit]})
    if not result:
        raise ValueError("No Story periods found")
    return result


def read_base_scores(bundle, matrix):
    meta = bundle["meta"]["score_matrix"]
    if (bundle["meta"]["model"] != embedding.MODEL_ID or meta["dtype"] != "float32-le"
            or meta["layout"] != "movie-major" or meta["rows"] != len(bundle["movies"])
            or meta["columns"] != len(bundle["anime"])):
        raise ValueError("Published model or matrix layout does not match the original pipeline")
    raw = Path(matrix).read_bytes()
    if len(raw) != meta["rows"] * meta["columns"] * 4 or hashlib.sha256(raw).hexdigest() != meta["sha256"]:
        raise ValueError("Published score matrix hash/size mismatch")
    index = {str(work["id"]): i for i, work in enumerate(bundle["anime"])}
    if len(index) != len(bundle["anime"]):
        raise ValueError("Duplicate published anime ID")

    def scores(anime_id):
        i = index.get(str(anime_id))
        if i is None:
            return None
        values = [struct.unpack_from("<f", raw, (j * len(index) + i) * 4)[0]
                  for j in range(len(bundle["movies"]))]
        validate_scores(values, len(bundle["movies"]))
        return values
    return scores


def validate_scores(scores, count):
    if len(scores) != count or any(not math.isfinite(x) or not -1 <= x <= 1 for x in scores):
        raise ValueError("Incomplete or invalid cosine scores")


def model_spec():
    return {"id": embedding.MODEL_ID, "revision": embedding.MODEL_REVISION,
            "dimension": embedding.DIMENSION, "prompt": "", "max_tokens": 2048,
            "normalized": True, "inference_dtype": "float16", "attention": "eager",
            "padding_side": "left", "truncation_side": "right"}


def prepare_records(rows, path, source):
    """Route both corpora through the original, unchanged input preprocessing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [*embedding.REQUIRED_FIELDS, "source_url", "title_english", "title_romaji"]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return embedding.load_records(path, len(rows), source)[0]


def movie_rows(movies):
    return [{"source": "tmdb", "source_id": str(movie["id"]), "title": movie["title"],
             "genres": json.dumps(movie["genres"], ensure_ascii=False),
             "tags": json.dumps(movie["tags"], ensure_ascii=False),
             "synopsis": movie["synopsis"], "source_url": movie["url"],
             "title_english": "", "title_romaji": ""} for movie in movies]


def fetch_missing_records(works, cache, offline=False):
    from common import JsonClient
    from collect_anime import normalise_anime
    path = cache / "anime_metadata.json"
    saved = read_json(path) if path.exists() else {}
    missing = [work["id"] for work in works if str(work["id"]) not in saved]
    if missing and offline:
        raise ValueError("Offline mode needs cached AniList metadata for every missing anime")
    if missing:
        client = JsonClient("AniList", 2.1)
        query = """query StoryMovieAnime($ids: [Int]) {
          Page(page: 1, perPage: 50) { media(id_in: $ids, type: ANIME) {
            id title { english romaji native } description(asHtml: false)
            genres tags { name rank isGeneralSpoiler isMediaSpoiler }
            startDate { year month day } format siteUrl
          } }
        }"""
        for start in range(0, len(missing), 50):
            payload = client.request("https://graphql.anilist.co", payload={
                "query": query, "variables": {"ids": missing[start:start + 50]}})
            media = (payload.get("data") or {}).get("Page", {}).get("media", [])
            for work in media:
                saved[str(work["id"])] = normalise_anime(work, 0, include_spoilers=False)
            save_json(path, saved)
    absent = [work["id"] for work in works if str(work["id"]) not in saved]
    if absent:
        raise ValueError(f"AniList metadata unavailable for: {absent}")
    return prepare_records([saved[str(work["id"])] for work in works], cache / "missing_anime.csv", "anilist")


def compute_missing(works, movies, args, corpus_hash):
    """Cache new full rows; never re-encode or rescore an existing anime row."""
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    cache = args.cache_dir
    records = fetch_missing_records(works, cache, args.offline)
    movie_records = prepare_records(movie_rows(movies), cache / "movies.csv", "tmdb")
    spec = model_spec()
    row_cache = cache / "scores"
    row_cache.mkdir(parents=True, exist_ok=True)
    result, pending = {}, []
    for record in records:
        path = row_cache / f"{record['source_id']}.json"
        expected = {"model": spec, "movie_corpus_sha256": corpus_hash,
                    "anime_text_sha256": fingerprint(record["embedding_text"])}
        saved = read_json(path) if path.exists() else None
        if saved and saved.get("provenance") == expected:
            validate_scores(saved["scores"], len(movies))
            result[record["source_id"]] = saved["scores"]
        else:
            pending.append((record, path, expected))
    if not pending:
        return result
    vector_path = cache / "movie_embeddings.npy"
    vector_meta_path = cache / "movie_embeddings.meta.json"
    vector_spec = {"model": spec, "movie_corpus_sha256": corpus_hash,
                   "texts_sha256": fingerprint([r["embedding_text"] for r in movie_records])}
    movie_vectors = None
    if vector_path.exists() and vector_meta_path.exists():
        meta = read_json(vector_meta_path)
        if meta.get("provenance") == vector_spec and meta.get("sha256") == digest(vector_path):
            movie_vectors = np.load(vector_path, allow_pickle=False)
    if movie_vectors is None and args.similarity_dir:
        folder = args.similarity_dir
        meta = read_json(folder / "run_metadata.json")
        original_records = [json.loads(line) for line in (folder / "movie_records.jsonl").read_text().splitlines()]
        original = folder / "movie_embeddings.npy"
        if (meta["status"] != "complete" or meta["model"]["id"] != spec["id"]
                or meta["model"]["resolved_revision"] != spec["revision"]
                or meta["output_sha256"][original.name] != digest(original)
                or [(r["source_id"], r["embedding_text"]) for r in original_records]
                != [(r["source_id"], r["embedding_text"]) for r in movie_records]):
            raise ValueError("Original movie embeddings do not match the published movie corpus/model")
        movie_vectors = np.load(original, allow_pickle=False)
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    torch.manual_seed(0)
    print(f"Loading {spec['id']}@{spec['revision']} on {device}", flush=True)
    model = SentenceTransformer(spec["id"], revision=spec["revision"], device=device,
        cache_folder=str(args.model_cache), local_files_only=args.offline, trust_remote_code=False,
        model_kwargs={"torch_dtype": torch.float16, "attn_implementation": "eager"},
        tokenizer_kwargs={"padding_side": "left", "truncation_side": "right"})
    model.max_seq_length = spec["max_tokens"]
    model.eval()
    save_json(cache / "runtime.json", {"model": spec, "device": device,
        "batch_size": args.batch_size, "script_sha256": digest(__file__),
        "packages": {name: importlib.metadata.version(name) for name in
                     ("numpy", "torch", "sentence-transformers", "transformers", "huggingface-hub")}})
    budget = argparse.Namespace(max_tokens=spec["max_tokens"], allow_truncation=False)
    embedding.check_token_budget(model, [r for r, _, _ in pending] + ([] if movie_vectors is not None else movie_records), budget)
    with torch.inference_mode():
        if movie_vectors is None:
            print(f"Encoding {len(movies)} unchanged movies (vectors were not retained)", flush=True)
            movie_vectors = embedding.embed(model, movie_records, args.batch_size, np)
            np.save(vector_path, movie_vectors, allow_pickle=False)
            save_json(vector_meta_path, {"provenance": vector_spec, "sha256": digest(vector_path)})
        if (movie_vectors.shape != (len(movies), spec["dimension"]) or not np.isfinite(movie_vectors).all()
                or not np.allclose(np.linalg.norm(movie_vectors, axis=1), 1, atol=1e-5)):
            raise ValueError("Movie embeddings have invalid shape/norms")
        for record, path, provenance in pending:
            print(f"Computing only new row: {record['source_id']} · {record['title']}", flush=True)
            vector = embedding.embed(model, [record], 1, np)
            scores = np.clip(vector @ movie_vectors.T, -1, 1)[0].tolist()
            validate_scores(scores, len(movies))
            save_json(path, {"provenance": provenance, "scores": scores, "record": record})
            result[record["source_id"]] = scores
    return result


def build_bundle(archive, periods, base, get_scores, additional, hashes):
    movie_fields = ("id", "title", "year", "genres", "tags", "synopsis", "url")
    used_movies, result = {}, []
    reused = computed = 0
    for period in periods:
        anime = []
        for rank, work in enumerate(period["anime"], 1):
            scores = get_scores(work["id"])
            source = "published_matrix" if scores is not None else "supplemental_cache"
            if scores is None:
                scores = additional.get(str(work["id"]))
                computed += 1
            else:
                reused += 1
            if scores is None:
                raise ValueError(f"Missing scores for {work['id']}: {work['title']}; run with --compute-missing")
            validate_scores(scores, len(base["movies"]))
            order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))[:3]
            matches = []
            for i in order:
                movie = base["movies"][i]
                used_movies[movie["id"]] = {key: movie[key] for key in movie_fields}
                matches.append({"movie_id": movie["id"], "score": scores[i]})
            anime.append({"id": work["id"], "title": work["title"], "year": work["year"],
                          "popularity": work.get("popularity", 0), "rank": rank,
                          "score_source": source, "matches": matches})
        result.append({key: value for key, value in period.items() if key != "anime"} | {"anime": anime})
    return {"schema_version": 1, "meta": {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model_spec(), "movie_count": len(base["movies"]),
        "reused_anime": reused, "supplemental_anime": computed,
        "reused_pair_count": reused * len(base["movies"]),
        "supplemental_pair_count": computed * len(base["movies"]),
        "supplemental_scores_sha256": fingerprint(additional),
        "selection": "Current AniList popularity descending, ID ascending, within each period's annual Top 10 sample",
        "movie_ties": "Original published movie record order", "sources": hashes,
        "archive_generated_at": archive["meta"].get("generated_at")},
        "periods": result, "movies": list(used_movies.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / "story.json")
    parser.add_argument("--base", type=Path, default=ROOT / "data/movie_recommendations.json")
    parser.add_argument("--matrix", type=Path, default=ROOT / "data/movie_anime_scores.bin")
    parser.add_argument("--output", type=Path, default=ROOT / "data/story_movie_recommendations.json")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "data/semantic_similarity/output/story")
    parser.add_argument("--model-cache", type=Path, default=ROOT / "data/semantic_similarity/output/model-cache")
    parser.add_argument("--similarity-dir", type=Path, help="Optional original completed similarity run with movie vectors")
    parser.add_argument("--compute-missing", action="store_true")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--batch-size", type=embedding.positive_int, default=1)
    args = parser.parse_args()
    archive, base = read_json(args.archive), read_json(args.base)
    periods = select_periods(archive, (ROOT / "frontend/story/index.html").read_text())
    get_scores = read_base_scores(base, args.matrix)
    missing = {work["id"]: work for p in periods for work in p["anime"] if get_scores(work["id"]) is None}
    print(f"{sum(len(p['anime']) for p in periods)} period anime; {len(missing)} missing rows; unchanged {len(base['movies'])} movies", flush=True)
    additional = compute_missing(list(missing.values()), base["movies"], args,
        fingerprint(movie_rows(base["movies"]))) if missing and args.compute_missing else {}
    bundle = build_bundle(archive, periods, base, get_scores, additional, {
        "story_sha256": digest(args.archive), "base_sha256": digest(args.base), "matrix_sha256": digest(args.matrix)})
    save_json(args.output, bundle)
    print(f"Exported {len(bundle['periods'])} periods; reused {bundle['meta']['reused_anime']} anime rows; supplemental {bundle['meta']['supplemental_anime']}", flush=True)


if __name__ == "__main__":
    main()
