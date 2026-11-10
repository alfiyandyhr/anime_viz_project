"""Publish TMDB popularity and ratings from the archived recommendation sample."""

import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re


DATA = Path(__file__).resolve().parent
ARCHIVE = DATA / "semantic_similarity" / "output"


def build_sidecar(archive, recommendations):
    csv_path = archive / "movies_top_1000.csv"
    run = json.loads((archive / "similarity" / "run_metadata.json").read_text())
    provenance = json.loads((archive / "movies_top_1000.metadata.json").read_text())
    input_meta = run["inputs"]["movies"]
    digest = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    if (run["status"] != "complete" or digest != input_meta["sha256"]
            or run["completed_at_utc"] != recommendations["meta"]["generated_at"]):
        raise ValueError("Movie CSV does not match the published similarity run")

    published_ids = [str(movie["id"]) for movie in recommendations["movies"]]
    if len(set(published_ids)) != len(published_ids) or not published_ids:
        raise ValueError("Published movie IDs must be unique and nonempty")

    snapshot = datetime.fromisoformat(provenance["completed_at_utc"])
    if (provenance["source"] != "tmdb" or snapshot.utcoffset() is None
            or snapshot > datetime.fromisoformat(run["started_at_utc"])):
        raise ValueError("Invalid TMDB collection provenance")

    values = {}
    ratings = {}
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            movie_id = row["source_id"]
            if row["source"] != "tmdb" or not re.fullmatch(r"[1-9][0-9]*", movie_id) or movie_id in values:
                raise ValueError(f"Invalid or duplicate TMDB ID: {movie_id}")
            raw = row["popularity"].strip()
            value = float(raw) if raw else None
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"Invalid popularity for TMDB ID {movie_id}")
            values[movie_id] = value
            raw_score = row["average_score"].strip()
            score = float(raw_score) if raw_score else None
            if score is not None and not 0 <= score <= 10:
                raise ValueError(f"Invalid rating for TMDB ID {movie_id}")
            ratings[movie_id] = score

    if (set(values) != set(published_ids)
            or len(values) != input_meta["rows"] or len(values) != provenance["record_count"]):
        raise ValueError("TMDB CSV coverage does not match the published movie IDs")

    return {
        "schema_version": 1,
        "source": "TMDB",
        "metric": "popularity",
        "snapshot_date": snapshot.astimezone(timezone.utc).date().isoformat(),
        "input_sha256": digest,
        "record_count": len(values),
        "eligible_count": sum(value is not None for value in values.values()),
        "popularity": values,
        "vote_average": ratings,
    }


if __name__ == "__main__":
    recommendations = json.loads((DATA / "movie_recommendations.json").read_text())
    sidecar = build_sidecar(ARCHIVE, recommendations)
    target = DATA / "movie_popularity.json"
    target.write_text(json.dumps(sidecar, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"{target.name}: {sidecar['eligible_count']}/{sidecar['record_count']} values from {sidecar['snapshot_date']}")
