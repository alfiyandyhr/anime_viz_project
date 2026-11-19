"""Refresh the shared Full Catalogue and Dust & Magnet data in two steps."""
from __future__ import annotations

import argparse
from datetime import date, datetime
from difflib import SequenceMatcher
import fcntl
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory, mkdtemp
import unicodedata

from export_movie_details import CAST_LIMIT, movie_credits, movie_details
from export_movie_popularity import build_sidecar
from export_recommendations import build_bundle

DATA = Path(__file__).resolve().parent
ROOT = DATA.parent
SEMANTIC = DATA / "semantic_similarity"
sys.path[:0] = [str(SEMANTIC), str(ROOT / "backend")]

from collect_anime import ANILIST_URL, normalise_anime
from collect_movies import ATTRIBUTION, TMDB_URL, normalise_movie
from common import (
    OUTPUT, TMDB_ENV_FILE, CollectionError, JsonClient, checkpoint_path, clean_text,
    complete_csv, load_checkpoint, load_tmdb_credentials, utc_now, write_json,
)
from compute_similarity import load_records, positive_int, sha256

COUNT = 1000
WORKSPACE = OUTPUT / "catalogue"
CHECKPOINT_BASE = WORKSPACE / "collection.json"
LATEST = WORKSPACE / "latest.json"
ANIME_CSV = "anime_top_1000.csv"
MOVIE_CSV = "movies_top_1000.csv"
INPUTS = ("data.json", ANIME_CSV, MOVIE_CSV, "movies_top_1000.metadata.json", "movie_details.json")
RECOMMENDATIONS = "movie_recommendations.json"
MATRIX = "movie_anime_scores.bin"
LANGUAGE = "en-US"
ANIME_PAGE_SIZE = 50
FILM_FORMATS = {"MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}

# Reviewed same-version matches from assets/data_treatment.md (TMDB -> AniList).
# Skip the TMDB row only if the paired AniList ID is in this collection.
SAME_VERSION = {
    1311031: 178788,  # Demon Slayer: Infinity Castle
    4935: 431,       # Howl's Moving Castle
    129: 199,        # Spirited Away
    372058: 21519,   # Your Name.
    1218925: 171627, # Chainsaw Man: Reze Arc
    8392: 523,       # My Neighbor Totoro
    128: 164,        # Princess Mononoke
    10494: 437,      # Perfect Blue
}
DISTINCT_VERSIONS = {
    (81, 572),         # Warriors of the Wind, the shorter English-language cut of Nausicaä
    (315837, 43),      # Ghost in the Shell, live action and animated adaptation
    (1290821, 97731),  # Shelter, feature and short
    (687259, 1281),    # Ghost Stories, film and TV series
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def title_key(value):
    text = unicodedata.normalize("NFKC", clean_text(value)).casefold()
    return "".join(char for char in text if char.isalnum())


def title_keys(values):
    return {key for value in values if (key := title_key(value))}


def synopsis_words(value):
    return set(re.findall(r"[a-z]{5,}", clean_text(value).casefold()))


def release_date(value):
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        return None


def anime_match_records(media):
    for item in media:
        titles = item.get("title") or {}
        start = item.get("startDate") or {}
        year, month, day = (start.get(part) for part in ("year", "month", "day"))
        full_date = f"{year:04d}-{month:02d}-{day:02d}" if year and month and day else None
        yield {
            "id": item["id"],
            "title": titles.get("english") or titles.get("romaji") or titles.get("native"),
            "titles": title_keys([*titles.values(), *(item.get("synonyms") or [])]),
            "native": title_key(titles.get("native")),
            "year": year or item.get("seasonYear"),
            "date": release_date(full_date),
            "runtime": item.get("duration"),
            "film": item.get("format") in FILM_FORMATS and item.get("episodes") in (1, None),
            "words": synopsis_words(item.get("description")),
        }


def match_movie(movie, anime, anime_ids):
    """Return a single confident match, or evidence for possible matches."""
    tmdb_id = movie["id"]
    reviewed = SAME_VERSION.get(tmdb_id)
    if reviewed in anime_ids:
        return {"anilist_id": reviewed, "reason": "reviewed same version"}, []

    alternatives = (movie.get("alternative_titles") or {}).get("titles")
    if not isinstance(alternatives, list):
        raise CollectionError(f"TMDB did not return alternative titles for movie {tmdb_id}.")
    titles = title_keys([movie.get("title"), movie.get("original_title"),
                         *(item.get("title") for item in alternatives)])
    native = title_key(movie.get("original_title"))
    released = release_date(movie.get("release_date"))
    runtime = movie.get("runtime") or 0
    animated = any(genre.get("id") == 16 or genre.get("name") == "Animation"
                   for genre in movie.get("genres") or [])
    words = synopsis_words(movie.get("overview"))

    confident, candidates = [], []
    for record in anime:
        if (tmdb_id, record["id"]) in DISTINCT_VERSIONS:
            continue
        shared = titles & record["titles"]
        near_year = released and record["year"] and abs(released.year - record["year"]) <= 1
        anime_runtime = record["runtime"] or 0
        close_runtime = (runtime > 0 and anime_runtime > 0
                         and abs(runtime - anime_runtime) <= min(4, max(1, anime_runtime * 0.05)))
        compatible = bool(animated and record["film"] and near_year and close_runtime)
        if not shared and not compatible:
            continue

        same_date = released is not None and released == record["date"]
        same_native = bool(native and native == record["native"])
        shared_words = len(words & record["words"])
        same_synopsis = shared_words >= 8 and shared_words / len(words | record["words"]) >= 0.30
        close_title = compatible and not shared and any(
            min(len(left), len(right)) >= 8
            and SequenceMatcher(None, left, right).ratio() >= 0.92
            for left in titles for right in record["titles"]
        )
        if not (shared or close_title or (compatible and same_date and same_synopsis)):
            continue

        evidence = {
            "anilist_id": record["id"], "anime_title": record["title"],
            "shared_titles": sorted(shared), "close_title": close_title,
            "movie_date": released.isoformat() if released else None, "anime_year": record["year"],
            "same_date": same_date, "same_native_title": same_native,
            "movie_runtime": runtime or None, "anime_runtime": anime_runtime or None,
            "animated": animated, "anime_film": record["film"], "same_synopsis": same_synopsis,
        }
        candidates.append(evidence)
        if compatible and ((shared and (same_date or same_native or same_synopsis))
                           or (close_title and same_date and same_synopsis)):
            confident.append(evidence)

    if len(confident) == 1:
        return {**confident[0], "reason": "matching title, format and release metadata"}, []
    return None, candidates


def save_checkpoint(state):
    write_json(checkpoint_path(CHECKPOINT_BASE), state)


def collect_anime(state, media_fields):
    query = """
    query SharedCatalogue($page: Int!, $perPage: Int!) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: [POPULARITY_DESC, ID], isAdult: false) {
    """ + media_fields + """
          synonyms
          isAdult
          tags { id name rank category isGeneralSpoiler isMediaSpoiler isAdult }
        }
      }
    }
    """
    client = JsonClient("AniList", 2.1)
    rows = state["anime"]
    seen = {item["id"] for item in rows}
    while len(rows) < COUNT:
        page = state["anime_page"]
        if page > 500:
            raise CollectionError("AniList reached the page limit before collecting 1,000 anime.")
        payload = client.request(ANILIST_URL, payload={"query": query, "variables": {
            "page": page, "perPage": ANIME_PAGE_SIZE,
        }})
        result = (payload.get("data") or {}).get("Page") or {}
        media = result.get("media")
        if not isinstance(media, list):
            raise CollectionError("AniList returned an unexpected media page.")
        for item in media:
            if not item or item.get("isAdult") or item.get("id") in seen:
                continue
            if type(item.get("id")) is not int or item["id"] < 1:
                raise CollectionError("AniList returned an invalid media ID.")
            rows.append(item)
            seen.add(item["id"])
            if len(rows) == COUNT:
                break
        if len(rows) < COUNT and not (result.get("pageInfo") or {}).get("hasNextPage"):
            raise CollectionError(f"AniList exhausted results at {len(rows)} unique anime.")
        if len(rows) == COUNT:
            state["anime_completed_at_utc"] = utc_now()
        state["anime_page"] += 1
        save_checkpoint(state)
        print(f"AniList: page {page}, {len(rows)}/{COUNT} unique anime", flush=True)


def collect_movies(state, client):
    anime = list(anime_match_records(state["anime"]))
    anime_ids = {item["id"] for item in anime}
    rows = state["movies"]
    seen = set(state["seen_movies"])
    while len(rows) < COUNT:
        page = state["movie_page"]
        if page > 500 or (state["movie_total_pages"] is not None and page > state["movie_total_pages"]):
            raise CollectionError(f"TMDB exhausted results at {len(rows)} eligible movies.")
        if state["movie_candidates"] is None:
            payload = client.request(f"{TMDB_URL}/movie/popular", params={"page": page, "language": LANGUAGE})
            movies = payload.get("results")
            if not isinstance(movies, list) or type(payload.get("total_pages")) is not int:
                raise CollectionError("TMDB returned an unexpected popularity page.")
            state["movie_total_pages"] = payload["total_pages"]
            state["movie_candidates"] = movies
            save_checkpoint(state)

        for selection in state["movie_candidates"]:
            movie_id = selection.get("id")
            if type(movie_id) is not int or movie_id < 1:
                raise CollectionError("TMDB returned an invalid movie ID.")
            if movie_id in seen:
                continue
            seen.add(movie_id)
            state["seen_movies"].append(movie_id)
            if selection.get("adult"):
                continue
            movie = client.request(f"{TMDB_URL}/movie/{movie_id}", params={
                "language": LANGUAGE, "append_to_response": "keywords,alternative_titles,credits",
            })
            if movie.get("id") != movie_id:
                raise CollectionError(f"TMDB detail ID does not match movie {movie_id}.")
            if movie.get("adult"):
                continue
            match, possible = match_movie(movie, anime, anime_ids)
            evidence = {"tmdb_id": movie_id, "movie_title": movie.get("title"), "candidate_rank": len(seen)}
            if match:
                state["excluded"].append({**evidence, **match})
                continue
            if possible:
                state["review"].append({**evidence, "candidates": possible})

            row = normalise_movie(movie, selection, len(rows) + 1, LANGUAGE)
            details = movie_details({**movie, "popularity": row["popularity"]}, movie_id)
            row["average_score"] = details["vote_average"]
            row["candidate_rank"] = len(seen)
            rows.append(row)
            state["details"][str(movie_id)] = details
            if len(rows) == COUNT:
                break

        if len(rows) == COUNT:
            state["movie_completed_at_utc"] = utc_now()
        state["movie_page"] += 1
        state["movie_candidates"] = None
        save_checkpoint(state)
        print(f"TMDB: page {page}, {len(rows)}/{COUNT} retained, "
              f"{len(state['excluded'])} cross-source duplicates excluded", flush=True)


def tmdb_client():
    token, key = load_tmdb_credentials(TMDB_ENV_FILE)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return JsonClient("TMDB", 0.3, headers, api_key=None if token else key)


def collect_credits(client, details, movie_ids):
    for index, movie_id in enumerate(movie_ids, 1):
        credits = client.request(f"{TMDB_URL}/movie/{movie_id}/credits", params={"language": LANGUAGE})
        details[movie_id].update(movie_credits(credits, int(movie_id)))
        if index % 100 == 0 or index == len(movie_ids):
            print(f"TMDB: fetched cast and writing credits for {index}/{len(movie_ids)} movies", flush=True)


def update_published_credits():
    recommendations = read_json(DATA / RECOMMENDATIONS)
    movie_ids = [str(movie["id"]) for movie in recommendations["movies"]]
    path = DATA / "movie_details.json"
    payload = read_json(path)
    details = payload["movies"]
    if (payload["schema_version"] != 1 or payload["source"] != "TMDB"
            or not movie_ids or len(movie_ids) != payload["record_count"]
            or len(movie_ids) != len(details) or set(movie_ids) != set(details)
            or any(not re.fullmatch(r"[1-9][0-9]*", movie_id) for movie_id in movie_ids)):
        raise CollectionError("Published TMDB details and recommendation movie IDs differ or are invalid.")

    collect_credits(tmdb_client(), details, movie_ids)
    payload.pop("cast_collected_at_utc", None)
    payload.update(cast_limit=CAST_LIMIT, credits_collected_at_utc=utc_now())
    write_json(path, payload)
    print(f"Updated cast and writing credits for {len(movie_ids)} movies in {path}", flush=True)


def update_dataset(resume):
    from anilist_service import AniListService, DASHBOARD_MEDIA_FIELDS

    tmdb = tmdb_client()
    config = {"limit": COUNT, "language": LANGUAGE, "anime_page_size": ANIME_PAGE_SIZE,
              "same_version": sorted([movie, anime] for movie, anime in SAME_VERSION.items()),
              "distinct_versions": sorted([movie, anime] for movie, anime in DISTINCT_VERSIONS)}
    state = load_checkpoint(CHECKPOINT_BASE, config) if resume else {
        "version": 1, "config": config, "started_at_utc": utc_now(),
        "anime": [], "anime_page": 1, "movie_page": 1, "movie_total_pages": None,
        "movie_candidates": None, "seen_movies": [], "movies": [],
        "details": {}, "excluded": [], "review": [],
    }
    save_checkpoint(state)
    collect_anime(state, DASHBOARD_MEDIA_FIELDS)
    collect_movies(state, tmdb)
    details = state["details"]
    # Older checkpoints can be missing one or both kinds of credits.
    missing_credits = [movie_id for movie_id, detail in details.items()
                       if "cast" not in detail or "writers" not in detail]
    if missing_credits:
        collect_credits(tmdb, details, missing_credits)
        save_checkpoint(state)

    folder = Path(mkdtemp(prefix="snapshot-", dir=WORKSPACE))
    try:
        started = state["started_at_utc"]
        anime_completed = state["anime_completed_at_utc"]
        dashboard = AniListService().build_dashboard(state["anime"])
        dashboard["meta"].update(cache_status="live", requested_pages=state["anime_page"] - 1,
                                 per_page=ANIME_PAGE_SIZE, catalogue_snapshot=folder.name,
                                 generated_at=anime_completed,
                                 generated_epoch=datetime.fromisoformat(anime_completed).timestamp())
        write_json(folder / "data.json", dashboard)
        anime_rows = []
        for rank, item in enumerate(state["anime"], 1):
            row = normalise_anime(item, rank)
            row["release_year"] = row["release_year"] or item.get("seasonYear") or ""
            anime_rows.append(row)
        complete_csv(folder / ANIME_CSV, anime_rows, {
            "config": {"source": "anilist", "limit": COUNT, "sort": "POPULARITY_DESC,ID"},
            "started_at_utc": started, "completed_at_utc": anime_completed,
            "attribution": "Anime metadata from AniList (https://anilist.co).",
        })
        provenance = complete_csv(folder / MOVIE_CSV, state["movies"], {
            "config": {"source": "tmdb", "limit": COUNT, "sort": "popularity.desc", "language": LANGUAGE},
            "started_at_utc": started, "completed_at_utc": state["movie_completed_at_utc"],
            "attribution": ATTRIBUTION,
        }, extra_fields=("candidate_rank",),
            ranking_note="First eligible unique TMDB IDs in observed popularity order after cross-source matching.")

        # Use observed list popularity and sample order, as the browser does.
        ranked = sorted(details, key=lambda movie_id: -details[movie_id]["popularity"])
        for rank, movie_id in enumerate(ranked, 1):
            details[movie_id]["popularity_rank"] = rank
        write_json(folder / "movie_details.json", {
            "schema_version": 1, "source": "TMDB", "record_count": len(details),
            "started_at_utc": started, "completed_at_utc": provenance["completed_at_utc"],
            "ranking_note": "Descending TMDB popularity within the retained sample, ties by candidate order.",
            "cast_limit": CAST_LIMIT,
            "movies": details,
        })
        write_json(folder / "duplicate_report.json", {
            "candidate_count": len(state["seen_movies"]), "excluded": state["excluded"],
            "retained_for_review": state["review"],
        })
        write_json(LATEST, {"folder": folder.name, "sha256": {name: sha256(folder / name) for name in INPUTS}})
    except Exception:
        shutil.rmtree(folder)
        raise
    checkpoint_path(CHECKPOINT_BASE).unlink(missing_ok=True)
    print(f"Staged {COUNT} anime and {COUNT} movies in {folder}", flush=True)
    print(f"Duplicate report: {folder / 'duplicate_report.json'}", flush=True)


def load_dataset():
    if not LATEST.is_file():
        raise CollectionError("No staged catalogue. Run --update-dataset first.")
    manifest = read_json(LATEST)
    folder = WORKSPACE / manifest["folder"]
    for name in INPUTS:
        if sha256(folder / name) != manifest["sha256"][name]:
            raise CollectionError(f"Staged {name} changed. Run --update-dataset again.")
    anime, _ = load_records(folder / ANIME_CSV, COUNT, "anilist")
    movies, _ = load_records(folder / MOVIE_CSV, COUNT, "tmdb")
    anime_ids = [record["source_id"] for record in anime]
    movie_ids = [record["source_id"] for record in movies]
    dashboard = read_json(folder / "data.json")
    if len(dashboard["anime"]) != COUNT or {str(row["id"]) for row in dashboard["anime"]} != set(anime_ids):
        raise CollectionError("Staged dashboard and similarity anime IDs differ.")
    details = read_json(folder / "movie_details.json")
    if details["record_count"] != COUNT or set(details["movies"]) != set(movie_ids):
        raise CollectionError("Staged TMDB details and similarity movie IDs differ.")
    return folder, anime_ids, movie_ids


def recompute_scores(batch_size, device):
    folder, anime_ids, movie_ids = load_dataset()
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
    except ImportError as error:
        raise CollectionError("Install data/semantic_similarity/requirements-embeddings.txt first.") from error

    model_cache = str(Path(HF_HUB_CACHE).expanduser())
    print(f"Scoring staged catalogue {folder.name}", flush=True)
    similarity = folder / "similarity"
    if not similarity.exists():
        with TemporaryDirectory(prefix="scoring-", dir=folder) as temporary:
            output = Path(temporary) / "similarity"
            subprocess.run([
                sys.executable, str(SEMANTIC / "compute_similarity.py"),
                "--anime-csv", str(folder / ANIME_CSV), "--movies-csv", str(folder / MOVIE_CSV),
                "--output-dir", str(output), "--expected-count", str(COUNT),
                "--batch-size", str(batch_size), "--device", device, "--cache-dir", model_cache,
            ], check=True)
            output.rename(similarity)
    else:
        print(f"Reusing the completed similarity run in {similarity}", flush=True)

    with TemporaryDirectory(prefix="publish-", dir=folder) as temporary:
        staged = Path(temporary)
        bundle = build_bundle(folder, staged / MATRIX)
        if ([record["id"] for record in bundle["anime"]] != anime_ids
                or [record["id"] for record in bundle["movies"]] != movie_ids
                or bundle["meta"]["pair_count"] != COUNT * COUNT):
            raise CollectionError("Similarity result does not cover the staged catalogue in CSV order.")
        bundle["meta"]["catalogue_snapshot"] = folder.name
        write_json(staged / RECOMMENDATIONS, bundle, compact=True)
        write_json(staged / "movie_popularity.json", build_sidecar(folder, bundle), compact=True)

        history = "history_movie_matches.json"
        # The Movie Timeline reads the eligible IDs from this bundle, so update
        # it against the same movie axis and reuse the newly computed vectors.
        subprocess.run([
            sys.executable, str(DATA / "export_story_recommendations.py"), "--annual", "--compute-missing",
            "--base", str(staged / RECOMMENDATIONS), "--matrix", str(staged / MATRIX),
            "--output", str(staged / history), "--similarity-dir", str(similarity),
            "--device", device, "--model-cache", model_cache,
        ], check=True)
        for name in ("data.json", "movie_details.json"):
            shutil.copyfile(folder / name, staged / name)
        (staged / "data.json").replace(ROOT / "data.json")
        for name in ("movie_details.json", MATRIX, "movie_popularity.json", history, RECOMMENDATIONS):
            (staged / name).replace(DATA / name)
    print(f"Updated web data for {COUNT} anime, {COUNT} movies and {COUNT * COUNT:,} scores.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--update-dataset", action="store_true", help="Collect and stage a fresh shared catalogue.")
    action.add_argument("--recompute-scores", action="store_true", help="Score the staged catalogue and update web files.")
    parser.add_argument("--cast-and-writer-only", action="store_true",
                        help="With --update-dataset, update cast and writers for the published movies.")
    parser.add_argument("--resume", action="store_true", help="Continue an interrupted --update-dataset.")
    parser.add_argument("--batch-size", type=positive_int, help="Embedding batch size for --recompute-scores (default: 8).")
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), help="Scoring device (default: auto).")
    args = parser.parse_args()
    if args.cast_and_writer_only and (not args.update_dataset or args.resume):
        parser.error("--cast-and-writer-only requires --update-dataset and cannot be combined with --resume.")
    if args.resume and not args.update_dataset:
        parser.error("--resume only applies to --update-dataset.")
    if (args.batch_size or args.device) and not args.recompute_scores:
        parser.error("--batch-size and --device only apply to --recompute-scores.")

    try:
        WORKSPACE.mkdir(parents=True, exist_ok=True)
        with (WORKSPACE / "refresh.lock").open("a", encoding="utf-8") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise CollectionError("Another catalogue refresh or scoring command is running.") from None
            if args.cast_and_writer_only:
                update_published_credits()
            elif args.update_dataset:
                update_dataset(args.resume)
            else:
                recompute_scores(args.batch_size or 8, args.device or "auto")
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Error: {error}\n")
    except subprocess.CalledProcessError as error:
        parser.exit(1, f"Error: {Path(error.cmd[1]).name} exited with status {error.returncode}.\n")
    except KeyboardInterrupt:
        parser.exit(130, "Interrupted.\n")


if __name__ == "__main__":
    main()
