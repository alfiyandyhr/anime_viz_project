"""Annual AniList Top 10 samples, independent of the dashboard's global sample."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import json
import time

from anilist_service import AniListService, DashboardDataError, PROJECT_ROOT, iso_now

START_YEAR = 1963
STORY_CACHE_FILE = PROJECT_ROOT / "data" / "anilist_story_cache.json"
BATCH_SIZE = 4
MEDIA_FIELDS = """
  id title { english romaji native }
  startDate { year month day }
  coverImage { extraLarge large medium color }
  bannerImage genres popularity averageScore format status
  description(asHtml: false) siteUrl episodes duration favourites source(version: 3)
  countryOfOrigin studios(isMain: true) { nodes { id name siteUrl } }
"""


def annual_query(years: list[int]) -> str:
    """Batch four independent annual rankings into one GraphQL request."""
    selections = []
    for year in years:
        selections.append(f"""
          y{year}: Page(page: 1, perPage: 10) {{
            media(type: ANIME, countryOfOrigin: "JP", isAdult: false,
              status_not: NOT_YET_RELEASED, sort: [POPULARITY_DESC],
              startDate_greater: {year * 10000 - 1},
              startDate_lesser: {(year + 1) * 10000}) {{ {MEDIA_FIELDS} }}
          }}
        """)
    return "query AnimeHistory {" + "\n".join(selections) + "}"


class StoryService(AniListService):
    def __init__(self, cache_file: Path = STORY_CACHE_FILE) -> None:
        super().__init__()
        self.story_cache_file = cache_file
        self._story_cache: dict[str, Any] | None = None
        self._last_attempt = 0.0

    def _read_story_cache(self) -> dict[str, Any] | None:
        try:
            cache_path = self.story_cache_file
            if cache_path == STORY_CACHE_FILE and not cache_path.exists():
                cache_path = PROJECT_ROOT / "story.json"
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            if payload.get("meta", {}).get("schema_version") != 1:
                return None
            if not isinstance(payload.get("years"), list):
                return None
            return payload
        except (OSError, ValueError, AttributeError):
            return None

    def _write_story_cache(self, payload: dict[str, Any]) -> None:
        self.story_cache_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.story_cache_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.story_cache_file)

    def get_story(self, force_refresh: bool = False) -> dict[str, Any]:
        current_year = datetime.now(timezone.utc).year
        with self._lock:
            cached = self._story_cache or self._read_story_cache()
            if (not force_refresh and cached and not cached["meta"].get("complete")
                    and time.time() - self._last_attempt < 300):
                return deepcopy(cached)
            if (not force_refresh and cached and self._is_fresh(cached)
                    and cached["meta"].get("end_year") == current_year
                    and cached["meta"].get("complete")):
                self._story_cache = cached
                result = deepcopy(cached)
                result["meta"]["cache_status"] = "cached"
                return result

            years = list(range(START_YEAR, current_year + 1))
            previous = {row["year"]: row for row in (cached or {}).get("years", [])}
            self._last_attempt = time.time()
            fetched: dict[int, dict[str, Any]] = {}
            error_message = None
            for offset in range(0, len(years), BATCH_SIZE):
                batch = years[offset:offset + BATCH_SIZE]
                try:
                    response = self._post_graphql(annual_query(batch), {})
                    for year in batch:
                        row = response.get("data", {}).get(f"y{year}")
                        if not isinstance(row, dict) or not isinstance(row.get("media"), list):
                            raise DashboardDataError(f"AniList did not return a ranking for {year}.")
                        anime = self._normalise_year(row["media"], year)
                        fetched[year] = {"year": year, "anime": anime, "fetched_at": iso_now()}
                except Exception as error:
                    # Stop after a failed batch. Do not hammer AniList or invent
                    # historical Top 10 rankings from the global dashboard sample.
                    error_message = str(error)
                    break
                if offset + BATCH_SIZE < len(years):
                    time.sleep(0.5)

            if not fetched and not previous:
                raise DashboardDataError(error_message or "No annual AniList data is available.")

            missing = [year for year in years if year not in fetched and year not in previous]
            stale = [year for year in years if year not in fetched and year in previous]
            rows = []
            for year in years:
                row = deepcopy(fetched.get(year) or previous.get(year) or {"year": year, "anime": []})
                row["status"] = "unavailable" if year in missing else "stale" if year in stale else "ready"
                row["provisional"] = year == current_year
                rows.append(row)
            result = {
                "meta": {
                    "schema_version": 1,
                    "source": "AniList GraphQL API",
                    "start_year": START_YEAR,
                    "end_year": current_year,
                    "top_per_year": 10,
                    "generated_at": iso_now() if fetched else cached["meta"].get("generated_at"),
                    "generated_epoch": time.time() if fetched else cached["meta"].get("generated_epoch", 0),
                    "cache_status": "live" if not stale and not missing else "partial-cache",
                    "complete": not missing and not stale,
                    "missing_years": missing,
                    "stale_years": stale,
                    "sample_size": sum(len(row["anime"]) for row in rows),
                    "sample_strategy": "Up to 10 Japanese, non-adult anime per first-release year; unreleased entries excluded",
                    "ranking_basis": "Current AniList user-list popularity, not historical audience size",
                    "year_basis": "AniList startDate.year (first release), not seasonYear",
                },
                "years": rows,
            }
            if error_message:
                result["meta"]["warning"] = "Some years could not be refreshed; cached years or explicit gaps are shown."
            if fetched:
                self._write_story_cache(result)
            self._story_cache = result
            return deepcopy(result)

    def _normalise_year(self, raw_media: list[dict[str, Any]], year: int) -> list[dict[str, Any]]:
        unique = {}
        for media in raw_media:
            if not media or not media.get("id") or (media.get("startDate") or {}).get("year") != year:
                continue
            item = self._normalise_anime(media)
            item["year"] = year
            unique[item["id"]] = item
        return sorted(unique.values(), key=lambda item: (-item["popularity"], item["id"]))[:10]
