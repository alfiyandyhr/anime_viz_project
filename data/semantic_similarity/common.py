"""Shared CSV and HTTP helpers. Uses only the Python 3.10+ standard library."""
from __future__ import annotations

import csv
import html
import json
import math
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "output"
FIELDS = [
    "source", "source_id", "popularity_rank", "title", "title_original",
    "title_english", "title_romaji", "title_native", "genres", "tags",
    "tags_details", "synopsis", "popularity", "average_score", "release_date",
    "release_year", "format", "status", "is_adult", "original_language",
    "source_url", "fetched_at_utc", "semantic_text",
]


class CollectionError(RuntimeError):
    """A source, configuration, or checkpoint prevented a complete collection."""


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean_text(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def json_cell(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def semantic_text(title, genres, tags, synopsis):
    # Lists use the same readable format across sources; source/rank/score are
    # intentionally excluded from the text used for semantic comparisons.
    return "\n".join([
        f"Title: {title}", f"Genres: {', '.join(genres)}",
        f"Tags: {', '.join(tags)}", f"Synopsis: {synopsis}",
    ])


def atomic_write(path, writer):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="",
                                         dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            writer(handle)
        temporary.replace(path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def write_json(path, value):
    atomic_write(path, lambda handle: json.dump(value, handle, ensure_ascii=False,
                                               indent=2, allow_nan=False))


def checkpoint_path(output):
    return Path(output).with_suffix(".checkpoint.json")


def load_checkpoint(output, config):
    path = checkpoint_path(output)
    if not path.exists():
        raise CollectionError(f"No checkpoint at {path}; run without --resume first.")
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise CollectionError(f"Cannot read checkpoint at {path}.") from error
    if state.get("version") != 1 or state.get("config") != config:
        raise CollectionError("Checkpoint settings differ. Use the original options "
                              "or omit --resume to fetch a fresh sample.")
    return state


def complete_csv(output, rows, state):
    expected = state["config"]["limit"]
    ids = [row["source_id"] for row in rows]
    if len(rows) != expected or len(set(ids)) != expected:
        raise CollectionError(f"Expected {expected} unique records; got {len(set(ids))}.")
    def write(handle):
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    # A failed collection never replaces an existing complete CSV.
    atomic_write(output, write)
    metadata = {
        "source": state["config"]["source"], "record_count": len(rows),
        "started_at_utc": state["started_at_utc"], "completed_at_utc": utc_now(),
        "settings": state["config"],
        "missing_fields": {
            field: sum(row[field] in ("", "[]") for row in rows)
            for field in ("title", "genres", "tags", "synopsis")
        },
        "ranking_note": "First unique records in live popularity order. Paginated "
                        "APIs are not transactional snapshots; rankings may move during collection.",
        "attribution": state["attribution"],
    }
    write_json(Path(output).with_suffix(".metadata.json"), metadata)
    checkpoint_path(output).unlink(missing_ok=True)
    print(f"Saved {len(rows)} records to {output}", flush=True)
    print(f"Missing fields: {metadata['missing_fields']}", flush=True)
    return metadata


def bounded_limit(value):
    from argparse import ArgumentTypeError
    try:
        count = int(value)
    except ValueError as error:
        raise ArgumentTypeError("limit must be an integer") from error
    if not 1 <= count <= 1000:
        raise ArgumentTypeError("limit must be between 1 and 1000")
    return count


def request_interval(value):
    from argparse import ArgumentTypeError
    try:
        interval = float(value)
    except ValueError as error:
        raise ArgumentTypeError("interval must be a number") from error
    if not math.isfinite(interval) or interval < 0:
        raise ArgumentTypeError("interval must be a finite non-negative number")
    return interval


def load_tmdb_credentials(path):
    """Read just two credential keys; environment wins. No shell evaluation."""
    values = {}
    if Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in {"TMDB_READ_ACCESS_TOKEN", "TMDB_API_KEY"}:
                values[key.strip()] = value.strip().strip("\"'")
    token = os.environ.get("TMDB_READ_ACCESS_TOKEN") or values.get("TMDB_READ_ACCESS_TOKEN")
    key = os.environ.get("TMDB_API_KEY") or values.get("TMDB_API_KEY")
    if not token and not key:
        raise CollectionError("TMDB credential missing. Copy .env.example to .env.local "
                              "and set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY, "
                              "or set either environment variable.")
    return token, key


def retry_delay(headers, attempt):
    value = headers.get("Retry-After")
    if value:
        try:
            return max(0.0, float(value))
        except ValueError:
            try:
                return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
            except (TypeError, ValueError, OverflowError):
                pass
    try:
        return max(1.0, float(headers["X-RateLimit-Reset"]) - time.time())
    except (KeyError, TypeError, ValueError):
        return min(60, 2 ** (attempt + 1))


class JsonClient:
    def __init__(self, source, interval, headers=None, api_key=None):
        self.source = source
        self.interval = interval
        self.api_key = api_key
        self.headers = {"Accept": "application/json",
                        "User-Agent": "AnIViz-Semantic-Research/1.0", **(headers or {})}
        self.next_request = 0.0

    def wait(self, seconds):
        # Report long waits and sleep in short chunks so progress stays visible.
        remaining = seconds
        while remaining > 0:
            if remaining >= 30:
                print(f"{self.source}: waiting {remaining:.0f}s for rate limit/retry.", flush=True)
            chunk = min(30, remaining)
            time.sleep(chunk)
            remaining -= chunk

    def request(self, url, params=None, payload=None):
        params = dict(params or {})
        if self.api_key:
            params["api_key"] = self.api_key
        if params:
            url += "?" + urlencode(params)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=body, headers=headers)
        last_failure = "unknown failure"
        for attempt in range(6):
            self.wait(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + self.interval
            try:
                with urlopen(request, timeout=45) as response:
                    result = json.load(response)
                    response_headers = response.headers
                if not isinstance(result, dict):
                    raise CollectionError(f"{self.source} returned an unexpected JSON structure.")
                errors = result.get("errors") or []
                if errors:
                    if any(error.get("status") in {429, 500, 502, 503, 504} for error in errors):
                        last_failure = "temporary GraphQL error"
                        if attempt < 5:
                            self.wait(retry_delay(response_headers, attempt))
                            continue
                    # Do not echo arbitrary API messages or URLs containing keys.
                    raise CollectionError(f"{self.source} returned GraphQL errors; check query/access.")
                if response_headers.get("X-RateLimit-Remaining") == "0":
                    self.next_request = max(self.next_request, time.monotonic() +
                                            retry_delay(response_headers, attempt))
                return result
            except HTTPError as error:
                last_failure = f"HTTP {error.code}"
                error.close()
                if error.code not in {429, 500, 502, 503, 504}:
                    hint = " Check your TMDB credential." if error.code in {401, 403} and self.source == "TMDB" else ""
                    raise CollectionError(f"{self.source} request failed ({last_failure}).{hint}") from None
                if attempt < 5:
                    self.wait(retry_delay(error.headers, attempt))
            except (URLError, TimeoutError, OSError):
                last_failure = "network error"
                if attempt < 5:
                    self.wait(min(60, 2 ** (attempt + 1)))
            except ValueError:
                raise CollectionError(f"{self.source} returned invalid JSON.") from None
        raise CollectionError(f"{self.source} request failed after 6 attempts ({last_failure}). "
                              "Use --resume if a checkpoint is available.")
