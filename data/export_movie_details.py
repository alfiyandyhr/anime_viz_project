"""Fetch TMDB details for the movies in the published recommendation catalogue."""

from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import re
import sys
from threading import local

from semantic_similarity.common import (
    HERE, CollectionError, JsonClient, atomic_write, load_tmdb_credentials, utc_now,
)


DATA = Path(__file__).resolve().parent
TMDB_URL = "https://api.themoviedb.org/3"


def movie_details(movie, movie_id):
    if movie.get("id") != movie_id:
        raise CollectionError(f"TMDB detail ID does not match movie {movie_id}.")

    def image(field):
        path = movie.get(field)
        return path if isinstance(path, str) and re.fullmatch(r"/[\w-]+\.jpg", path, re.ASCII) else None

    popularity = movie.get("popularity")
    if type(popularity) not in (int, float) or not math.isfinite(popularity) or popularity < 0:
        raise CollectionError(f"Invalid TMDB popularity for movie {movie_id}.")
    runtime = movie.get("runtime")
    score = movie.get("vote_average")
    votes = movie.get("vote_count")
    return {
        "poster_path": image("poster_path"),
        "backdrop_path": image("backdrop_path"),
        "runtime": runtime if type(runtime) is int and runtime > 0 else None,
        "vote_average": score if type(votes) is int and votes > 0
        and type(score) in (int, float) and 0 <= score <= 10 else None,
        "popularity": popularity,
    }


def export_details():
    recommendations = json.loads((DATA / "movie_recommendations.json").read_text())
    ids = [int(movie["id"]) for movie in recommendations["movies"]]
    if not ids or len(set(ids)) != len(ids) or min(ids) < 1:
        raise CollectionError("Published movie IDs must be positive, unique, and nonempty.")
    token, key = load_tmdb_credentials(HERE / ".env.local")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    worker = local()

    def fetch(movie_id):
        if not hasattr(worker, "client"):
            worker.client = JsonClient("TMDB", 0.3, headers, api_key=None if token else key)
        movie = worker.client.request(f"{TMDB_URL}/movie/{movie_id}", params={"language": "en-US"})
        return movie_details(movie, movie_id)

    started = utc_now()
    details = {}
    # Six clients at most, each starting no more than one request per 0.3 seconds.
    with ThreadPoolExecutor(max_workers=6) as pool:
        for index, (movie_id, record) in enumerate(zip(ids, pool.map(fetch, ids)), 1):
            details[movie_id] = record
            if index % 100 == 0 or index == len(ids):
                print(f"TMDB: fetched {index}/{len(ids)} movies", flush=True)

    ranked = sorted(ids, key=lambda movie_id: (-details[movie_id]["popularity"], movie_id))
    for rank, movie_id in enumerate(ranked, 1):
        details[movie_id]["popularity_rank"] = rank
    payload = {
        "schema_version": 1,
        "source": "TMDB",
        "started_at_utc": started,
        "completed_at_utc": utc_now(),
        "ranking_note": "Descending TMDB popularity within the published movie sample, ties by TMDB ID.",
        "record_count": len(details),
        "movies": details,
    }
    output = DATA / "movie_details.json"
    atomic_write(output, lambda handle: handle.write(
        json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n"))
    print(f"Saved {len(details)} TMDB records to {output}", flush=True)


if __name__ == "__main__":
    try:
        export_details()
    except (CollectionError, OSError) as error:
        sys.exit(f"Error: {error}")
