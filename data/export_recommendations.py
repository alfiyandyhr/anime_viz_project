"""Export the completed similarity run for Flask and GitHub Pages (stdlib only)."""
import argparse
import csv
import gzip
import hashlib
import heapq
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "data/semantic_similarity/output"
DEFAULT_OUTPUT = ROOT / "data/movie_recommendations.json"


def read_records(folder, kind, metadata):
    input_key = "movies" if kind == "movie" else "anime"
    with (folder / f"{input_key}_top_1000.csv").open(encoding="utf-8", newline="") as file:
        context = {row["source_id"]: row for row in csv.DictReader(file)}
    with (folder / "similarity" / f"{kind}_records.jsonl").open(encoding="utf-8") as file:
        records = [json.loads(line) for line in file if line.strip()]
    if len(records) != metadata["inputs"][input_key]["rows"]:
        raise ValueError(f"Unexpected {kind} record count")
    if len({record["source_id"] for record in records}) != len(records):
        raise ValueError(f"Duplicate {kind} source IDs")
    exported = []
    for index, record in enumerate(records):
        if record["index"] != index:
            raise ValueError(f"Invalid {kind} row map")
        row = context[record["source_id"]]
        exported.append({
            "id": record["source_id"], "title": record["title"],
            "aliases": list(dict.fromkeys(row[key] for key in (
                "title_original", "title_english", "title_romaji", "title_native"
            ) if row[key] and row[key] != record["title"])),
            "genres": record["genres"], "tags": record["tags"],
            "synopsis": record["synopsis"],
            "year": int(row["release_year"]) if row["release_year"] else None,
            "format": row["format"],
            "url": f"https://{'anilist.co/anime' if kind == 'anime' else 'www.themoviedb.org/movie'}/{record['source_id']}",
        })
    return exported


def read_bottom_matches(run, anime, movies, count=20, score_buffer=None):
    """Keep the last ranks of score-descending, anime-index-ascending order."""
    heaps = [[] for _ in movies]
    seen = [0 for _ in movies]
    with gzip.open(run / "all_pairs.csv.gz", "rt", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            anime_index, movie_index = int(row["anime_index"]), int(row["movie_index"])
            if not (0 <= anime_index < len(anime) and 0 <= movie_index < len(movies)):
                raise ValueError("Invalid full-matrix pair index")
            if anime[anime_index]["id"] != row["anime_id"] or movies[movie_index]["id"] != row["movie_id"]:
                raise ValueError("Full-matrix pair does not match the record maps")
            score = float(row["cosine_similarity"])
            if not math.isfinite(score) or not -1 <= score <= 1:
                raise ValueError("Invalid full-matrix cosine score")
            if score_buffer is not None:
                struct.pack_into("<f", score_buffer, (movie_index * len(anime) + anime_index) * 4, score)
            bit = 1 << anime_index
            if seen[movie_index] & bit:
                raise ValueError("Duplicate full-matrix pair")
            seen[movie_index] |= bit
            heap = heaps[movie_index]
            candidate = (-score, anime_index)
            if len(heap) < count:
                heapq.heappush(heap, candidate)
            elif candidate > heap[0]:
                heapq.heapreplace(heap, candidate)
    expected = (1 << len(anime)) - 1
    if any(bits != expected for bits in seen):
        raise ValueError("Full matrix must include every anime for every movie")
    return [sorted([[index, -score] for score, index in heap], key=lambda pair: (pair[1], -pair[0]))
            for heap in heaps]


def build_bundle(folder, matrix_output=None):
    run = folder / "similarity"
    metadata = json.loads((run / "run_metadata.json").read_text(encoding="utf-8"))
    if metadata["status"] != "complete":
        raise ValueError("Similarity run must be complete")
    # Confirm the ranked records and their context belong to the same run.
    for name in ("anime_records.jsonl", "movie_records.jsonl", "top_anime_per_movie.csv", "all_pairs.csv.gz"):
        digest = hashlib.sha256((run / name).read_bytes()).hexdigest()
        if digest != metadata["output_sha256"][name]:
            raise ValueError(f"Similarity file changed since computation: {name}")
    for kind in ("anime", "movies"):
        digest = hashlib.sha256((folder / f"{kind}_top_1000.csv").read_bytes()).hexdigest()
        if digest != metadata["inputs"][kind]["sha256"]:
            raise ValueError(f"Source CSV changed since computation: {kind}")
    anime = read_records(folder, "anime", metadata)
    movies = read_records(folder, "movie", metadata)
    for movie in movies:
        movie["matches"] = []
    with (run / "top_anime_per_movie.csv").open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            movie = movies[int(row["query_index"])]
            index, score, rank = int(row["match_index"]), float(row["cosine_similarity"]), int(row["rank"])
            if movie["id"] != row["query_id"] or anime[index]["id"] != row["match_id"]:
                raise ValueError("Ranked pair does not match the record maps")
            if not math.isfinite(score) or not -1 <= score <= 1:
                raise ValueError("Invalid cosine score")
            matches = movie["matches"]
            if rank != len(matches) + 1 or (matches and score > matches[-1][1]):
                raise ValueError("Ranks must be consecutive and descending")
            matches.append([index, score])
    for movie in movies:
        if len(movie["matches"]) < 20 or len({m[0] for m in movie["matches"]}) != len(movie["matches"]):
            raise ValueError("Each movie must have at least 20 unique ranked matches")
        movie["matches"] = movie["matches"][:20]
    # Movie-major float32 scores let the browser compare any 1–3 movies without inference.
    scores = bytearray(len(anime) * len(movies) * 4)
    for movie, bottom in zip(movies, read_bottom_matches(run, anime, movies, score_buffer=scores)):
        movie["bottom_matches"] = bottom
    matrix_name = "movie_anime_scores.bin" if matrix_output is None else matrix_output.name
    matrix_meta = {"file": matrix_name, "dtype": "float32-le", "layout": "movie-major",
                   "rows": len(movies), "columns": len(anime),
                   "sha256": hashlib.sha256(scores).hexdigest()}
    if matrix_output is not None:
        matrix_output.parent.mkdir(parents=True, exist_ok=True)
        matrix_output.write_bytes(scores)
    return {
        "schema_version": 2,
        "meta": {"model": metadata["model"]["id"],
                 "generated_at": metadata["completed_at_utc"],
                 "anime_count": len(anime), "movie_count": len(movies),
                 "pair_count": metadata["similarity"]["pair_count"], "top_k": 20, "bottom_k": 20,
                 "score_matrix": matrix_meta},
        "anime": anime, "movies": movies,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    bundle = build_bundle(args.input_dir, args.output.with_name("movie_anime_scores.bin"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported {len(bundle['movies'])} movies with full scores and top/bottom matches to {args.output}")


if __name__ == "__main__":
    main()
