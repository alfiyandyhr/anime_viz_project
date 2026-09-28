from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from html import unescape
from itertools import combinations
from pathlib import Path
from threading import Lock
from typing import Any
import json
import math
import os
import re
import time

import requests
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = PROJECT_ROOT / "data"
CACHE_FILE = DATA_DIR / "anilist_dashboard_cache.json"

ANILIST_URL = "https://graphql.anilist.co"

ANILIST_QUERY = """
query AnimeDashboardPage($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      currentPage
      hasNextPage
      total
    }
    media(
      type: ANIME
      sort: [POPULARITY_DESC]
      isAdult: false
    ) {
      id
      idMal
      title {
        english
        romaji
        native
      }
      description(asHtml: false)
      siteUrl
      format
      status
      source(version: 3)
      season
      seasonYear
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      episodes
      duration
      countryOfOrigin
      averageScore
      meanScore
      popularity
      favourites
      trending
      genres
      coverImage {
        extraLarge
        large
        medium
        color
      }
      bannerImage
      studios(isMain: true) {
        nodes {
          id
          name
          siteUrl
        }
      }
      characters(role: MAIN, perPage: 12) {
        edges {
          node {
            id
            name {
              full
            }
          }
          voiceActors(language: JAPANESE) {
            id
            name {
              full
            }
            image {
              medium
            }
            siteUrl
          }
        }
      }
    }
  }
}
"""


ANALYTICAL_QUESTIONS = [
    {
        "number": 1,
        "question": "Which anime combine high audience ratings with unusually large popularity?",
        "view": "Score–popularity explorer"
    },
    {
        "number": 2,
        "question": "Are the most popular anime also the highest rated?",
        "view": "Scatterplot and correlation summary"
    },
    {
        "number": 3,
        "question": "Which genres appear most often in this popular-anime sample?",
        "view": "Interactive genre ranking"
    },
    {
        "number": 4,
        "question": "Which genres achieve the strongest average ratings?",
        "view": "Genre ranking metric selector"
    },
    {
        "number": 5,
        "question": "How has the composition and average score of popular anime changed over time?",
        "view": "Release-year timeline"
    },
    {
        "number": 6,
        "question": "Which studios combine a large audience reach with consistently strong scores?",
        "view": "Studio performance chart"
    },
    {
        "number": 7,
        "question": "Which studios specialize in particular genres?",
        "view": "Studio–genre heatmap"
    },
    {
        "number": 8,
        "question": "Which Japanese voice actors appear across the greatest number of sampled anime?",
        "view": "Voice-actor network"
    },
    {
        "number": 9,
        "question": "Which voice actors repeatedly co-star, and on which shows?",
        "view": "Weighted co-starring links"
    },
    {
        "number": 10,
        "question": "How do format, source material, year, genre, and studio filters change the story?",
        "view": "Coordinated global filters and anime table"
    }
]


class DashboardDataError(RuntimeError):
    """Raised when neither live data nor a usable cache is available."""


def clean_text(value: str | None) -> str:
    if not value:
        return ""

    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    value = unescape(value)
    value = re.sub(r"\s+", " ", value)

    return value.strip()


def safe_number(value: Any, default: float = 0) -> float:
    return value if isinstance(value, (int, float)) else default


def average(values: list[float]) -> float | None:
    values = [value for value in values if isinstance(value, (int, float))]

    if not values:
        return None

    return round(sum(values) / len(values), 2)


def pearson_correlation(pairs: list[tuple[float, float]]) -> float | None:
    if len(pairs) < 3:
        return None

    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]

    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)

    numerator = sum(
        (x - mean_x) * (y - mean_y)
        for x, y in pairs
    )

    denominator_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs))
    denominator_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys))

    denominator = denominator_x * denominator_y

    if denominator == 0:
        return None

    return round(numerator / denominator, 3)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AniListService:
    def __init__(self) -> None:
        self.anilist_url = ANILIST_URL

        self.pages = max(
            1,
            int(os.getenv("ANILIST_PAGES", "3"))
        )
        self.per_page = max(
            10,
            min(int(os.getenv("ANILIST_PER_PAGE", "50")), 50)
        )
        self.cache_ttl_hours = max(
            1,
            int(os.getenv("CACHE_TTL_HOURS", "6"))
        )

        self.network_node_limit = max(
            20,
            int(os.getenv("NETWORK_NODE_LIMIT", "90"))
        )
        self.network_link_limit = max(
            100,
            int(os.getenv("NETWORK_LINK_LIMIT", "750"))
        )

        self._lock = Lock()
        self._memory_cache: dict[str, Any] | None = None

        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": (
                "AnIViz/1.0 "
                "(educational data-visualization project)"
            )
        })

        DATA_DIR.mkdir(parents=True, exist_ok=True)

    def cache_status(self) -> dict[str, Any]:
        cached = self._read_cache()

        if not cached:
            return {
                "available": False,
                "fresh": False,
                "generated_at": None
            }

        return {
            "available": True,
            "fresh": self._is_fresh(cached),
            "generated_at": cached.get("meta", {}).get("generated_at"),
            "sample_size": cached.get("meta", {}).get("sample_size")
        }

    def get_dashboard(self, force_refresh: bool = False) -> dict[str, Any]:
        with self._lock:
            if (
                not force_refresh
                and self._memory_cache
                and self._is_fresh(self._memory_cache)
            ):
                result = deepcopy(self._memory_cache)
                result["meta"]["cache_status"] = "memory-cache"
                return result

            disk_cache = self._read_cache()

            if (
                not force_refresh
                and disk_cache
                and self._is_fresh(disk_cache)
            ):
                self._memory_cache = disk_cache
                result = deepcopy(disk_cache)
                result["meta"]["cache_status"] = "disk-cache"
                return result

            try:
                raw_media = self._fetch_live_media()
                dashboard = self._build_dashboard(raw_media)
                self._write_cache(dashboard)
                self._memory_cache = dashboard

                result = deepcopy(dashboard)
                result["meta"]["cache_status"] = "live"
                return result

            except Exception as error:
                if disk_cache:
                    result = deepcopy(disk_cache)
                    result["meta"]["cache_status"] = "stale-cache"
                    result["meta"]["warning"] = (
                        "Live AniList data could not be retrieved. "
                        "The dashboard is displaying the most recent local cache."
                    )
                    result["meta"]["live_error"] = str(error)
                    self._memory_cache = disk_cache
                    return result

                raise DashboardDataError(str(error)) from error

    def _is_fresh(self, dashboard: dict[str, Any]) -> bool:
        generated_epoch = dashboard.get("meta", {}).get("generated_epoch")

        if not generated_epoch:
            return False

        age_seconds = time.time() - generated_epoch
        ttl_seconds = self.cache_ttl_hours * 60 * 60

        return age_seconds < ttl_seconds

    def _read_cache(self) -> dict[str, Any] | None:
        if not CACHE_FILE.exists():
            return None

        try:
            with CACHE_FILE.open("r", encoding="utf-8") as cache_file:
                return json.load(cache_file)
        except (OSError, json.JSONDecodeError):
            return None

    def _write_cache(self, dashboard: dict[str, Any]) -> None:
        temporary_file = CACHE_FILE.with_suffix(".tmp")

        with temporary_file.open("w", encoding="utf-8") as cache_file:
            json.dump(
                dashboard,
                cache_file,
                ensure_ascii=False,
                indent=2
            )

        temporary_file.replace(CACHE_FILE)

    def _fetch_live_media(self) -> list[dict[str, Any]]:
        all_media: list[dict[str, Any]] = []

        for page in range(1, self.pages + 1):
            variables = {
                "page": page,
                "perPage": self.per_page
            }

            payload = self._post_graphql(ANILIST_QUERY, variables)
            page_data = payload.get("data", {}).get("Page", {})
            media = page_data.get("media", [])

            all_media.extend(item for item in media if item)

            if not page_data.get("pageInfo", {}).get("hasNextPage", False):
                break

            # Avoid burst requests even though this project makes very few calls.
            time.sleep(0.4)

        # Prevent duplicated entries if the upstream page ordering changes
        # during the fetch.
        deduplicated: dict[int, dict[str, Any]] = {}

        for media in all_media:
            media_id = media.get("id")

            if media_id is not None:
                deduplicated[media_id] = media

        if not deduplicated:
            raise DashboardDataError("AniList returned an empty media list.")

        return list(deduplicated.values())

    def _post_graphql(
        self,
        query: str,
        variables: dict[str, Any]
    ) -> dict[str, Any]:
        attempts = 4
        last_error: Exception | None = None

        for attempt in range(attempts):
            try:
                response = self.session.post(
                    self.anilist_url,
                    json={
                        "query": query,
                        "variables": variables
                    },
                    timeout=35
                )

                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", "5"))
                    time.sleep(min(max(retry_after, 1), 60))
                    continue

                if response.status_code in {500, 502, 503, 504}:
                    time.sleep(2 ** attempt)
                    continue

                response.raise_for_status()
                payload = response.json()

                if payload.get("errors"):
                    messages = "; ".join(
                        error.get("message", "Unknown GraphQL error")
                        for error in payload["errors"]
                    )
                    raise DashboardDataError(messages)

                return payload

            except (
                requests.RequestException,
                ValueError,
                DashboardDataError
            ) as error:
                last_error = error

                if attempt < attempts - 1:
                    time.sleep(2 ** attempt)

        raise DashboardDataError(
            f"AniList request failed after {attempts} attempts: {last_error}"
        )

    def _normalise_anime(
        self,
        media: dict[str, Any]
    ) -> dict[str, Any]:
        titles = media.get("title") or {}

        title = (
            titles.get("english")
            or titles.get("romaji")
            or titles.get("native")
            or f"Anime {media.get('id', '')}"
        )

        studios = [
            {
                "id": studio.get("id"),
                "name": studio.get("name") or "Unknown studio",
                "site_url": studio.get("siteUrl")
            }
            for studio in (media.get("studios") or {}).get("nodes", [])
            if studio
        ]

        if not studios:
            studios = [{
                "id": None,
                "name": "Unknown studio",
                "site_url": None
            }]

        voice_actor_map: dict[str, dict[str, Any]] = {}

        for edge in (media.get("characters") or {}).get("edges", []):
            character = edge.get("node") or {}
            character_name = (
                (character.get("name") or {}).get("full")
                or "Unknown character"
            )

            for actor in edge.get("voiceActors") or []:
                actor_id = str(actor.get("id"))

                if actor_id not in voice_actor_map:
                    voice_actor_map[actor_id] = {
                        "id": actor_id,
                        "name": (
                            (actor.get("name") or {}).get("full")
                            or "Unknown voice actor"
                        ),
                        "image": (actor.get("image") or {}).get("medium"),
                        "site_url": actor.get("siteUrl"),
                        "characters": []
                    }

                if character_name not in voice_actor_map[actor_id]["characters"]:
                    voice_actor_map[actor_id]["characters"].append(
                        character_name
                    )

        start_date = media.get("startDate") or {}
        end_date = media.get("endDate") or {}
        cover = media.get("coverImage") or {}
        genres = media.get("genres") or []

        release_year = media.get("seasonYear") or start_date.get("year")

        episodes = media.get("episodes")
        duration = media.get("duration")

        runtime_minutes = (
            episodes * duration
            if isinstance(episodes, int) and isinstance(duration, int)
            else None
        )

        return {
            "id": media.get("id"),
            "mal_id": media.get("idMal"),
            "title": title,
            "titles": {
                "english": titles.get("english"),
                "romaji": titles.get("romaji"),
                "native": titles.get("native")
            },
            "description": clean_text(media.get("description")),
            "site_url": media.get("siteUrl"),
            "format": media.get("format") or "UNKNOWN",
            "status": media.get("status") or "UNKNOWN",
            "source": media.get("source") or "UNKNOWN",
            "season": media.get("season"),
            "year": release_year,
            "start_date": start_date,
            "end_date": end_date,
            "episodes": episodes,
            "duration": duration,
            "runtime_minutes": runtime_minutes,
            "country": media.get("countryOfOrigin"),
            "average_score": media.get("averageScore"),
            "mean_score": media.get("meanScore"),
            "popularity": safe_number(media.get("popularity")),
            "favourites": safe_number(media.get("favourites")),
            "trending": safe_number(media.get("trending")),
            "genres": genres,
            "primary_genre": genres[0] if genres else "Other",
            "studios": studios,
            "studio_names": [studio["name"] for studio in studios],
            "voice_actors": sorted(
                voice_actor_map.values(),
                key=lambda actor: actor["name"]
            ),
            "cover": {
                "extra_large": cover.get("extraLarge"),
                "large": cover.get("large"),
                "medium": cover.get("medium"),
                "color": cover.get("color")
            },
            "banner_image": media.get("bannerImage")
        }

    def _build_dashboard(
        self,
        raw_media: list[dict[str, Any]]
    ) -> dict[str, Any]:
        anime = [
            self._normalise_anime(media)
            for media in raw_media
        ]

        anime.sort(
            key=lambda item: (
                item.get("popularity", 0),
                item.get("average_score") or 0
            ),
            reverse=True
        )

        network = self._build_voice_actor_network(anime)
        genre_summary = self._build_genre_summary(anime)
        studio_summary = self._build_studio_summary(anime)
        timeline = self._build_timeline(anime)
        insights = self._build_insights(
            anime,
            genre_summary,
            studio_summary,
            network
        )

        years = sorted({
            item["year"]
            for item in anime
            if isinstance(item.get("year"), int)
        })

        formats = sorted({
            item["format"]
            for item in anime
            if item.get("format")
        })

        sources = sorted({
            item["source"]
            for item in anime
            if item.get("source")
        })

        genres = sorted({
            genre
            for item in anime
            for genre in item.get("genres", [])
        })

        studios = sorted({
            studio
            for item in anime
            for studio in item.get("studio_names", [])
        })

        scores = [
            item["average_score"]
            for item in anime
            if isinstance(item.get("average_score"), (int, float))
        ]

        generated_epoch = time.time()

        return {
            "meta": {
                "project": "AnIViz — Anime Industry Visualization",
                "generated_at": iso_now(),
                "generated_epoch": generated_epoch,
                "source": "AniList GraphQL API",
                "sample_strategy": "Most popular non-adult anime",
                "sample_size": len(anime),
                "requested_pages": self.pages,
                "per_page": self.per_page,
                "cache_ttl_hours": self.cache_ttl_hours,
                "year_min": min(years) if years else None,
                "year_max": max(years) if years else None,
                "score_min": min(scores) if scores else None,
                "score_max": max(scores) if scores else None,
                "genres": genres,
                "studios": studios,
                "formats": formats,
                "sources": sources,
                "methodology_note": (
                    "This is a popularity-sorted sample, not a census of every "
                    "anime ever produced. Findings describe the sampled titles "
                    "and should not be generalized to the entire industry "
                    "without additional sampling."
                )
            },
            "questions": ANALYTICAL_QUESTIONS,
            "insights": insights,
            "summaries": {
                "genres": genre_summary,
                "studios": studio_summary,
                "timeline": timeline
            },
            "network": network,
            "anime": anime
        }

    def _build_genre_summary(
        self,
        anime: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        genre_items: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for item in anime:
            for genre in item.get("genres", []):
                genre_items[genre].append(item)

        summary = []

        for genre, items in genre_items.items():
            scores = [
                item["average_score"]
                for item in items
                if isinstance(item.get("average_score"), (int, float))
            ]

            summary.append({
                "genre": genre,
                "count": len(items),
                "average_score": average(scores),
                "total_popularity": sum(
                    item.get("popularity", 0) for item in items
                ),
                "total_favourites": sum(
                    item.get("favourites", 0) for item in items
                ),
                "top_title": max(
                    items,
                    key=lambda item: item.get("popularity", 0)
                )["title"]
            })

        return sorted(
            summary,
            key=lambda item: (
                item["count"],
                item["total_popularity"]
            ),
            reverse=True
        )

    def _build_studio_summary(
        self,
        anime: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        studio_items: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for item in anime:
            for studio_name in item.get("studio_names", []):
                studio_items[studio_name].append(item)

        summary = []

        for studio, items in studio_items.items():
            scores = [
                item["average_score"]
                for item in items
                if isinstance(item.get("average_score"), (int, float))
            ]

            genre_counter = Counter(
                genre
                for item in items
                for genre in item.get("genres", [])
            )

            summary.append({
                "studio": studio,
                "count": len(items),
                "average_score": average(scores),
                "total_popularity": sum(
                    item.get("popularity", 0) for item in items
                ),
                "total_favourites": sum(
                    item.get("favourites", 0) for item in items
                ),
                "dominant_genre": (
                    genre_counter.most_common(1)[0][0]
                    if genre_counter
                    else "Unknown"
                ),
                "top_titles": [
                    item["title"]
                    for item in sorted(
                        items,
                        key=lambda title: title.get("popularity", 0),
                        reverse=True
                    )[:3]
                ]
            })

        return sorted(
            summary,
            key=lambda item: item["total_popularity"],
            reverse=True
        )

    def _build_timeline(
        self,
        anime: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        year_items: dict[int, list[dict[str, Any]]] = defaultdict(list)

        for item in anime:
            year = item.get("year")

            if isinstance(year, int):
                year_items[year].append(item)

        timeline = []

        for year, items in sorted(year_items.items()):
            scores = [
                item["average_score"]
                for item in items
                if isinstance(item.get("average_score"), (int, float))
            ]

            timeline.append({
                "year": year,
                "count": len(items),
                "average_score": average(scores),
                "total_popularity": sum(
                    item.get("popularity", 0) for item in items
                ),
                "total_favourites": sum(
                    item.get("favourites", 0) for item in items
                )
            })

        return timeline

    def _build_voice_actor_network(
        self,
        anime: list[dict[str, Any]]
    ) -> dict[str, Any]:
        actors: dict[str, dict[str, Any]] = {}
        links: dict[tuple[str, str], dict[str, Any]] = {}

        for item in anime:
            item_actors = item.get("voice_actors", [])
            unique_actor_ids = sorted({
                actor["id"] for actor in item_actors
            })

            for actor in item_actors:
                actor_id = actor["id"]

                if actor_id not in actors:
                    actors[actor_id] = {
                        "id": actor_id,
                        "name": actor["name"],
                        "image": actor.get("image"),
                        "site_url": actor.get("site_url"),
                        "show_ids": set(),
                        "shows": set(),
                        "characters": set(),
                        "genres": Counter(),
                        "popularity_reach": 0
                    }

                actor_record = actors[actor_id]

                if item["id"] not in actor_record["show_ids"]:
                    actor_record["show_ids"].add(item["id"])
                    actor_record["shows"].add(item["title"])
                    actor_record["popularity_reach"] += item.get(
                        "popularity",
                        0
                    )
                    actor_record["genres"].update(item.get("genres", []))

                actor_record["characters"].update(
                    actor.get("characters", [])
                )

            for source, target in combinations(unique_actor_ids, 2):
                pair = tuple(sorted((source, target)))

                if pair not in links:
                    links[pair] = {
                        "source": pair[0],
                        "target": pair[1],
                        "show_ids": set(),
                        "shows": set()
                    }

                links[pair]["show_ids"].add(item["id"])
                links[pair]["shows"].add(item["title"])

        ranked_actor_ids = sorted(
            actors,
            key=lambda actor_id: (
                len(actors[actor_id]["show_ids"]),
                actors[actor_id]["popularity_reach"]
            ),
            reverse=True
        )[:self.network_node_limit]

        retained_ids = set(ranked_actor_ids)

        candidate_links = [
            link
            for link in links.values()
            if (
                link["source"] in retained_ids
                and link["target"] in retained_ids
            )
        ]

        candidate_links.sort(
            key=lambda link: (
                len(link["show_ids"]),
                actors[link["source"]]["popularity_reach"]
                + actors[link["target"]]["popularity_reach"]
            ),
            reverse=True
        )

        candidate_links = candidate_links[:self.network_link_limit]

        degree = Counter()

        for link in candidate_links:
            degree[link["source"]] += 1
            degree[link["target"]] += 1

        nodes = []

        for actor_id in ranked_actor_ids:
            actor = actors[actor_id]
            dominant_genre = (
                actor["genres"].most_common(1)[0][0]
                if actor["genres"]
                else "Other"
            )

            nodes.append({
                "id": actor_id,
                "name": actor["name"],
                "image": actor["image"],
                "site_url": actor["site_url"],
                "count": len(actor["show_ids"]),
                "show_ids": sorted(actor["show_ids"]),
                "shows": sorted(actor["shows"]),
                "characters": sorted(actor["characters"]),
                "primary_genre": dominant_genre,
                "popularity_reach": actor["popularity_reach"],
                "degree": degree[actor_id]
            })

        serialised_links = [
            {
                "source": link["source"],
                "target": link["target"],
                "weight": len(link["show_ids"]),
                "show_ids": sorted(link["show_ids"]),
                "shows": sorted(link["shows"])
            }
            for link in candidate_links
        ]

        return {
            "nodes": nodes,
            "links": serialised_links,
            "full_actor_count": len(actors),
            "full_link_count": len(links),
            "displayed_actor_count": len(nodes),
            "displayed_link_count": len(serialised_links)
        }

    def _build_insights(
        self,
        anime: list[dict[str, Any]],
        genres: list[dict[str, Any]],
        studios: list[dict[str, Any]],
        network: dict[str, Any]
    ) -> list[dict[str, Any]]:
        if not anime:
            return []

        highest_rated = max(
            anime,
            key=lambda item: item.get("average_score") or -1
        )
        most_popular = max(
            anime,
            key=lambda item: item.get("popularity", 0)
        )

        eligible_genres = [
            genre for genre in genres
            if genre["count"] >= 5 and genre["average_score"] is not None
        ]

        highest_rated_genre = (
            max(
                eligible_genres,
                key=lambda item: item["average_score"]
            )
            if eligible_genres
            else None
        )

        eligible_studios = [
            studio for studio in studios
            if studio["count"] >= 3 and studio["average_score"] is not None
        ]

        strongest_studio = (
            max(
                eligible_studios,
                key=lambda item: item["average_score"]
            )
            if eligible_studios
            else None
        )

        top_actor = (
            max(
                network.get("nodes", []),
                key=lambda actor: (
                    actor["count"],
                    actor["popularity_reach"]
                )
            )
            if network.get("nodes")
            else None
        )

        strongest_link = (
            max(
                network.get("links", []),
                key=lambda link: link["weight"]
            )
            if network.get("links")
            else None
        )

        actor_names = {
            actor["id"]: actor["name"]
            for actor in network.get("nodes", [])
        }

        correlation_pairs = [
            (
                math.log10(item["popularity"]),
                item["average_score"]
            )
            for item in anime
            if (
                item.get("popularity", 0) > 0
                and isinstance(item.get("average_score"), (int, float))
            )
        ]

        correlation = pearson_correlation(correlation_pairs)

        insights = [
            {
                "label": "Most popular title",
                "value": most_popular["title"],
                "detail": (
                    f"{most_popular['popularity']:,} AniList users "
                    "have it on their lists."
                )
            },
            {
                "label": "Highest-rated title",
                "value": highest_rated["title"],
                "detail": (
                    f"Average score: "
                    f"{highest_rated.get('average_score') or 'N/A'}/100."
                )
            },
            {
                "label": "Score–popularity relationship",
                "value": (
                    f"r = {correlation}"
                    if correlation is not None
                    else "Insufficient data"
                ),
                "detail": (
                    "Pearson correlation between score and log10 popularity "
                    "within the sampled titles."
                )
            }
        ]

        if highest_rated_genre:
            insights.append({
                "label": "Highest-rated recurring genre",
                "value": highest_rated_genre["genre"],
                "detail": (
                    f"{highest_rated_genre['average_score']}/100 across "
                    f"{highest_rated_genre['count']} sampled titles."
                )
            })

        if strongest_studio:
            insights.append({
                "label": "Strong studio by average score",
                "value": strongest_studio["studio"],
                "detail": (
                    f"{strongest_studio['average_score']}/100 across "
                    f"{strongest_studio['count']} sampled titles."
                )
            })

        if top_actor:
            insights.append({
                "label": "Most represented voice actor",
                "value": top_actor["name"],
                "detail": (
                    f"Appears in {top_actor['count']} sampled anime."
                )
            })

        if strongest_link:
            source_name = actor_names.get(
                strongest_link["source"],
                "Unknown"
            )
            target_name = actor_names.get(
                strongest_link["target"],
                "Unknown"
            )

            insights.append({
                "label": "Strongest co-starring connection",
                "value": f"{source_name} + {target_name}",
                "detail": (
                    f"{strongest_link['weight']} shared sampled anime."
                )
            })

        return insights
