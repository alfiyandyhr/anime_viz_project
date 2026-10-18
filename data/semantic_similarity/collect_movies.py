"""Fetch up to 1,000 popular TMDB movies, including keywords, into a local CSV."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import (
    HERE, OUTPUT, CollectionError, JsonClient, bounded_limit, checkpoint_path,
    clean_text, complete_csv, json_cell, load_checkpoint, load_tmdb_credentials,
    request_interval, semantic_text, utc_now, write_json,
)

TMDB_URL = "https://api.themoviedb.org/3"
ATTRIBUTION = "This product uses the TMDB API but is not endorsed or certified by TMDB."


def normalise_movie(movie, selection, rank, language):
    if movie.get("id") != selection["id"]:
        raise CollectionError("TMDB detail ID does not match the selected movie.")
    title = clean_text(movie.get("title") or selection.get("title") or movie.get("original_title"))
    if not title:
        raise CollectionError(f"TMDB record {movie['id']} has no title.")
    # A missing keyword response is an upstream failure, not an empty tag list.
    keyword_data = movie.get("keywords")
    if not isinstance(keyword_data, dict) or not isinstance(keyword_data.get("keywords"), list):
        raise CollectionError(f"TMDB did not return keywords for movie {movie['id']}; use --resume.")
    raw_tags = keyword_data["keywords"]
    tags = list(dict.fromkeys(clean_text(tag["name"]) for tag in raw_tags if tag.get("name")))
    genres = [clean_text(genre["name"]) for genre in movie.get("genres") or [] if genre.get("name")]
    synopsis = clean_text(movie.get("overview"))
    release_date = movie.get("release_date") or ""
    return {
        "source": "tmdb", "source_id": movie["id"], "popularity_rank": rank,
        "title": title, "title_original": movie.get("original_title") or "",
        "title_english": title if language.split("-")[0] == "en" else "",
        "title_romaji": "", "title_native": movie.get("original_title") or "",
        "genres": json_cell(genres), "tags": json_cell(tags), "tags_details": json_cell(raw_tags),
        "synopsis": synopsis,
        # Preserve the popularity value used for selection, rather than a later
        # detail value that might have changed while enriching 1,000 entries.
        "popularity": selection.get("popularity"), "average_score": movie.get("vote_average"),
        "release_date": release_date, "release_year": release_date[:4], "format": "MOVIE",
        "status": movie.get("status") or "", "is_adult": movie.get("adult", False),
        "original_language": movie.get("original_language") or "",
        "source_url": f"https://www.themoviedb.org/movie/{movie['id']}",
        "fetched_at_utc": utc_now(), "semantic_text": semantic_text(title, genres, tags, synopsis),
    }


def collect_movies(output, limit=1000, language="en-US", include_adult=False,
                   resume=False, interval=0.3, env_file=HERE / ".env.local", client=None):
    output = Path(output)
    config = {"source": "tmdb", "limit": limit, "language": language,
              "include_adult": include_adult, "sort": "popularity.desc", "include_video": False}
    if client is None:
        token, key = load_tmdb_credentials(env_file)
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        client = JsonClient("TMDB", interval, headers, api_key=None if token else key)
    state = load_checkpoint(output, config) if resume else {
        "version": 1, "config": config, "started_at_utc": utc_now(),
        "next_page": 1, "selection": [], "rows": [], "attribution": ATTRIBUTION,
    }
    selection = state["selection"]
    seen = {movie["id"] for movie in selection}
    # First capture the entire ordered sample, then enrich it. On --resume the
    # sample is preserved even if the live popularity ranking has changed.
    while len(selection) < limit:
        page = state["next_page"]
        if page > 500:
            raise CollectionError("Reached TMDB's page limit without enough unique movies.")
        if include_adult:
            endpoint = "/discover/movie"
            params = {"language": language, "page": page, "sort_by": "popularity.desc",
                      "include_adult": "true", "include_video": "false"}
        else:
            endpoint = "/movie/popular"
            params = {"language": language, "page": page}
        payload = client.request(TMDB_URL + endpoint, params=params)
        movies = payload.get("results")
        if not isinstance(movies, list):
            raise CollectionError("TMDB returned an unexpected movie-list structure.")
        for movie in movies:
            if movie.get("id") is None:
                raise CollectionError("TMDB returned a movie without an ID.")
            if movie["id"] in seen:
                continue
            selection.append(movie)
            seen.add(movie["id"])
            if len(selection) == limit:
                break
        state["next_page"] = page + 1
        write_json(checkpoint_path(output), state)
        print(f"TMDB: page {page}, selected {len(selection)}/{limit} unique movies", flush=True)
        if len(selection) < limit and (not movies or page >= payload.get("total_pages", page)):
            raise CollectionError(f"TMDB exhausted results at {len(selection)} movies; complete CSV not replaced.")
    rows = state["rows"]
    for index in range(len(rows), len(selection)):
        movie = selection[index]
        details = client.request(TMDB_URL + f"/movie/{movie['id']}", params={
            "language": language, "append_to_response": "keywords",
        })
        rows.append(normalise_movie(details, movie, index + 1, language))
        write_json(checkpoint_path(output), state)
        if len(rows) % 25 == 0 or len(rows) == limit:
            print(f"TMDB: enriched {len(rows)}/{limit} movies with keywords", flush=True)
    return complete_csv(output, rows, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=bounded_limit, default=1000)
    parser.add_argument("--output", type=Path, default=OUTPUT / "movies_top_1000.csv")
    parser.add_argument("--language", default="en-US", help="Text translation, not an original-language filter.")
    parser.add_argument("--include-adult", action="store_true", help="Include adult entries via discover/movie.")
    parser.add_argument("--resume", action="store_true", help="Reuse an interrupted ranking/sample checkpoint.")
    parser.add_argument("--interval", type=request_interval, default=0.3, help="Seconds between requests.")
    parser.add_argument("--env-file", type=Path, default=HERE / ".env.local")
    args = parser.parse_args()
    try:
        collect_movies(args.output, args.limit, args.language, args.include_adult,
                       args.resume, args.interval, args.env_file)
    except (CollectionError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. Use --resume with the same options to continue.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
