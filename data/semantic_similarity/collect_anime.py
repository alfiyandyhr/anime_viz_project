"""Fetch up to 1,000 popular AniList anime into a fresh local CSV."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from common import (
    OUTPUT, CollectionError, JsonClient, bounded_limit, checkpoint_path,
    clean_text, complete_csv, json_cell, load_checkpoint, request_interval,
    semantic_text, utc_now, write_json,
)

ANILIST_URL = "https://graphql.anilist.co"
QUERY = """
query SemanticAnimePage($page: Int!, $perPage: Int!, $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: [POPULARITY_DESC, ID], isAdult: $isAdult) {
      id
      title { english romaji native }
      description(asHtml: false)
      genres
      tags { id name rank category isGeneralSpoiler isMediaSpoiler isAdult }
      popularity
      averageScore
      startDate { year month day }
      format
      status
      isAdult
      siteUrl
    }
  }
}
"""


def normalise_anime(media, rank, include_spoilers=False):
    titles = media.get("title") or {}
    title = clean_text(titles.get("english") or titles.get("romaji") or titles.get("native"))
    if not title:
        raise CollectionError(f"AniList record {media.get('id')} has no title.")
    genres = [clean_text(name) for name in media.get("genres") or []]
    raw_tags = sorted(media.get("tags") or [], key=lambda tag: -(tag.get("rank") or 0))
    tags = list(dict.fromkeys(
        clean_text(tag["name"]) for tag in raw_tags if tag.get("name") and (
            include_spoilers or not (tag.get("isGeneralSpoiler") or tag.get("isMediaSpoiler"))
        )
    ))
    synopsis = clean_text(media.get("description"))
    date = media.get("startDate") or {}
    release_date = ""
    if all(date.get(part) for part in ("year", "month", "day")):
        release_date = f"{date['year']:04d}-{date['month']:02d}-{date['day']:02d}"
    return {
        "source": "anilist", "source_id": media["id"], "popularity_rank": rank,
        "title": title, "title_original": titles.get("native") or titles.get("romaji") or "",
        "title_english": titles.get("english") or "", "title_romaji": titles.get("romaji") or "",
        "title_native": titles.get("native") or "", "genres": json_cell(genres),
        "tags": json_cell(tags), "tags_details": json_cell(raw_tags), "synopsis": synopsis,
        "popularity": media.get("popularity"), "average_score": media.get("averageScore"),
        "release_date": release_date, "release_year": date.get("year") or "",
        "format": media.get("format") or "", "status": media.get("status") or "",
        "is_adult": media.get("isAdult", False), "original_language": "",
        "source_url": media.get("siteUrl") or f"https://anilist.co/anime/{media['id']}",
        "fetched_at_utc": utc_now(), "semantic_text": semantic_text(title, genres, tags, synopsis),
    }


def collect_anime(output, limit=1000, include_adult=False, include_spoilers=False,
                  resume=False, interval=2.1, client=None):
    output = Path(output)
    config = {"source": "anilist", "limit": limit, "include_adult": include_adult,
              "include_spoilers": include_spoilers, "sort": "POPULARITY_DESC,ID"}
    state = load_checkpoint(output, config) if resume else {
        "version": 1, "config": config, "started_at_utc": utc_now(),
        "next_page": 1, "rows": [], "attribution": "Anime metadata from AniList (https://anilist.co).",
    }
    rows = state["rows"]
    seen = {row["source_id"] for row in rows}
    client = client or JsonClient("AniList", max(2.1, interval))
    while len(rows) < limit:
        page = state["next_page"]
        if page > 500:
            raise CollectionError("Reached the pagination safety limit without enough unique anime.")
        payload = client.request(ANILIST_URL, payload={"query": QUERY, "variables": {
            "page": page, "perPage": 50, "isAdult": None if include_adult else False,
        }})
        page_data = (payload.get("data") or {}).get("Page")
        if not isinstance(page_data, dict) or not isinstance(page_data.get("media"), list):
            raise CollectionError("AniList returned an unexpected page structure.")
        media = page_data["media"]
        for item in media:
            if not item or item.get("id") in seen:
                continue
            rows.append(normalise_anime(item, len(rows) + 1, include_spoilers))
            seen.add(item["id"])
            if len(rows) == limit:
                break
        state["next_page"] = page + 1
        write_json(checkpoint_path(output), state)
        print(f"AniList: page {page}, {len(rows)}/{limit} unique anime", flush=True)
        if len(rows) < limit and (not media or not (page_data.get("pageInfo") or {}).get("hasNextPage")):
            raise CollectionError(f"AniList exhausted results at {len(rows)} anime; complete CSV not replaced.")
    return complete_csv(output, rows, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=bounded_limit, default=1000)
    parser.add_argument("--output", type=Path, default=OUTPUT / "anime_top_1000.csv")
    parser.add_argument("--include-adult", action="store_true", help="Include adult anime in the ranking.")
    parser.add_argument("--include-spoilers", action="store_true", help="Include spoiler tags in tags/semantic_text.")
    parser.add_argument("--resume", action="store_true", help="Resume the saved sample rather than fetch a new one.")
    parser.add_argument("--interval", type=request_interval, default=2.1, help="Seconds between requests; minimum 2.1.")
    args = parser.parse_args()
    try:
        collect_anime(args.output, args.limit, args.include_adult, args.include_spoilers,
                      args.resume, args.interval)
    except (CollectionError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. Use --resume with the same options to continue.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
