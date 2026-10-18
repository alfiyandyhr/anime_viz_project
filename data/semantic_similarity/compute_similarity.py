"""Embed anime/movie metadata locally and save every cross-corpus cosine score.

Python 3.10+. Install requirements-embeddings.txt, then run this file yourself.
Defaults are relative to this script, independently of the working directory.
The first run downloads free model weights; inference never uses a hosted API.
Inputs are read-only. An existing output directory is always refused.
See README_EMBEDDINGS.md and similarity_methodology.pdf for the method.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import html
import importlib.metadata
import json
import os
import platform
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_ID = "Qwen/Qwen3-Embedding-4B"
# Hugging Face repository revision checked on 2026-10-17.
MODEL_REVISION = "5cf2132abc99cad020ac570b19d031efec650f2b"
DIMENSION = 2560
TEXT_FIELDS = ("title", "genres", "tags", "synopsis")
REQUIRED_FIELDS = ("source", "source_id", *TEXT_FIELDS)


def positive_int(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("Must be at least 1.")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--anime-csv", type=Path,
                        default=HERE / "output/anime_top_1000.csv")
    parser.add_argument("--movies-csv", type=Path,
                        default=HERE / "output/movies_top_1000.csv")
    parser.add_argument("--output-dir", type=Path, default=HERE / "output/similarity",
                        help="Must be a NEW directory; existing directories are never overwritten.")
    parser.add_argument("--expected-count", type=positive_int, default=1000,
                        help="Required row count in EACH CSV (default: 1000).")
    parser.add_argument("--batch-size", type=positive_int, default=8)
    parser.add_argument("--top-k", type=positive_int, default=20)
    parser.add_argument("--max-tokens", type=positive_int, default=2048,
                        help="Input token budget, including special tokens (maximum: 32768).")
    parser.add_argument("--allow-truncation", action="store_true",
                        help="Explicitly permit right truncation and record affected rows.")
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    parser.add_argument("--revision", default=MODEL_REVISION,
                        help="Model revision; the default pins a specific commit.")
    parser.add_argument("--cache-dir", type=Path,
                        help="Optional local Hugging Face model cache directory.")
    parser.add_argument("--offline", action="store_true",
                        help="Load cached weights only; do not contact Hugging Face.")
    args = parser.parse_args()
    if not 2 <= args.max_tokens <= 32768:
        parser.error("--max-tokens must be between 2 and 32768.")
    return args


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        digest = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_text(value: str) -> str:
    # Keep valid non-Latin text: a Japanese title is not encoding corruption.
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    value = unicodedata.normalize("NFC", value)
    return re.sub(r"\s+", " ", value).strip()


def damaged_title(value: str) -> bool:
    return "\ufffd" in value or any(
        unicodedata.category(char) == "Cc" and not char.isspace() for char in value
    )


def choose_title(row: dict[str, str]) -> tuple[str, str]:
    # Never embed title_original/title_native; do not guess a mojibake repair.
    # Most rows use exactly the preferred title column. Only clearly unusable
    # titles fall back to English/romaji; otherwise the title field is omitted.
    for column in ("title", "title_english", "title_romaji"):
        raw = row.get(column, "")
        if raw and not damaged_title(raw):
            cleaned = clean_text(raw)
            if cleaned and not damaged_title(cleaned):
                return cleaned, column
    return "", "omitted"


def parse_list(value: str, column: str, context: str) -> list[str]:
    try:
        items = json.loads(value) if value.strip() else []
    except json.JSONDecodeError as error:
        raise ValueError(f"{context}: {column} must be a JSON array.") from error
    if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
        raise ValueError(f"{context}: {column} must be a JSON array of strings.")
    # Deduplicate within a field while retaining source order and spelling.
    seen: set[str] = set()
    result = []
    for item in items:
        cleaned = clean_text(item)
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def load_records(path: Path, expected_count: int, source: str) -> tuple[list[dict], str]:
    before = sha256(path)
    records = []
    seen = set()
    # Strict UTF-8 (optionally BOM): never silently replace undecodable bytes.
    with path.open(encoding="utf-8-sig", errors="strict", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError(f"{path}: missing or duplicate CSV header.")
        missing = set(REQUIRED_FIELDS) - set(reader.fieldnames)
        if missing:
            raise ValueError(f"{path}: missing required columns: {sorted(missing)}")
        for index, row in enumerate(reader):
            context = f"{path.name}, data row {index + 1}"
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{context}: inconsistent CSV column count.")
            item_source, item_id = row["source"].strip(), row["source_id"].strip()
            if item_source != source or not item_id:
                raise ValueError(f"{context}: expected source={source!r} and a nonempty source_id.")
            key = (item_source, item_id)
            if key in seen:
                raise ValueError(f"{context}: duplicate record key {key}.")
            seen.add(key)
            title, title_column = choose_title(row)
            genres = parse_list(row["genres"], "genres", context)
            tags = parse_list(row["tags"], "tags", context)
            synopsis = clean_text(row["synopsis"])
            values = (title, ", ".join(genres), ", ".join(tags), synopsis)
            text = "\n".join(f"{field.capitalize()}: {value}"
                             for field, value in zip(TEXT_FIELDS, values) if value)
            if not text:
                raise ValueError(f"{context}: all embedding fields are empty/unusable.")
            records.append({
                "index": index, "source": item_source, "source_id": item_id,
                "source_url": row.get("source_url", ""), "title": title,
                "title_column_used": title_column, "genres": genres, "tags": tags,
                "synopsis": synopsis, "embedding_text": text,
                "missing_fields": [f for f, v in zip(TEXT_FIELDS, values) if not v],
            })
    if len(records) != expected_count:
        raise ValueError(f"{path}: expected {expected_count} records, found {len(records)}.")
    if sha256(path) != before:
        raise ValueError(f"{path}: input changed during reading; retry on a stable snapshot.")
    return records, before


def check_token_budget(model, records: list[dict], args: argparse.Namespace) -> None:
    tokenized = model.tokenizer(
        [item["embedding_text"] for item in records],
        add_special_tokens=True, padding=False, truncation=False,
        return_attention_mask=False,
    )["input_ids"]
    over_budget = []
    for item, tokens in zip(records, tokenized):
        item["token_count_before_truncation"] = len(tokens)
        item["truncated"] = len(tokens) > args.max_tokens
        if item["truncated"]:
            over_budget.append(f"{item['source']}:{item['source_id']} ({len(tokens)} tokens)")
    if over_budget:
        message = (f"{len(over_budget)} records exceed --max-tokens={args.max_tokens}: "
                   + ", ".join(over_budget[:5]))
        if not args.allow_truncation:
            raise ValueError(message + ". Increase --max-tokens or explicitly use --allow-truncation.")
        print("WARNING: " + message + "; the rightmost tokens will be dropped.", file=sys.stderr)


def embed(model, records: list[dict], batch_size: int, np):
    vectors = model.encode(
        [item["embedding_text"] for item in records], batch_size=batch_size,
        # The same document encoding for both corpora makes the metric symmetric.
        # An empty prompt explicitly overrides any model default retrieval prompt.
        prompt="", show_progress_bar=True, convert_to_numpy=True,
        normalize_embeddings=True, precision="float32",
    )
    vectors = np.asarray(vectors, dtype=np.float32)
    if vectors.shape != (len(records), DIMENSION) or not np.isfinite(vectors).all():
        raise ValueError(f"Unexpected/nonfinite embedding array: {vectors.shape}.")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.isfinite(norms).all() or (norms <= 1e-12).any():
        raise ValueError("A record produced a zero or nonfinite embedding.")
    # Enforce unit length after casting to float32, so a dot product is cosine.
    return np.ascontiguousarray(vectors / norms, dtype=np.float32)


def write_records(path: Path, records: list[dict]) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        for item in records:
            handle.write(json.dumps(item, ensure_ascii=False, allow_nan=False) + "\n")


def write_all_pairs(path: Path, scores, anime: list[dict], movies: list[dict]) -> None:
    with gzip.open(path, "xt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["anime_index", "anime_source", "anime_id", "movie_index",
                         "movie_source", "movie_id", "cosine_similarity"])
        for i, a in enumerate(anime):
            for j, m in enumerate(movies):
                # Nine significant digits preserve a float32 score on round-trip.
                writer.writerow([i, a["source"], a["source_id"], j, m["source"],
                                 m["source_id"], format(float(scores[i, j]), ".9g")])


def write_top_matches(path: Path, scores, queries: list[dict], candidates: list[dict],
                      top_k: int, np) -> None:
    with path.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["query_index", "query_source", "query_id", "query_title", "rank",
                         "match_index", "match_source", "match_id", "match_title",
                         "cosine_similarity"])
        for i, query in enumerate(queries):
            # Stable sorting resolves exact ties in original candidate CSV order.
            order = np.argsort(-scores[i], kind="stable")[:min(top_k, len(candidates))]
            for rank, j in enumerate(order, start=1):
                match = candidates[int(j)]
                writer.writerow([i, query["source"], query["source_id"], query["title"], rank,
                                 int(j), match["source"], match["source_id"], match["title"],
                                 format(float(scores[i, j]), ".9g")])


def main() -> None:
    args = parse_args()
    output = args.output_dir.expanduser().resolve()
    if output.exists():
        raise FileExistsError(f"Output already exists: {output}. Choose a NEW --output-dir.")
    anime_path = args.anime_csv.expanduser().resolve()
    movies_path = args.movies_csv.expanduser().resolve()
    anime, anime_hash = load_records(anime_path, args.expected_count, "anilist")
    movies, movies_hash = load_records(movies_path, args.expected_count, "tmdb")
    if args.offline:
        # Set these before importing Hugging Face libraries.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    try:
        import numpy as np
        import torch
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise RuntimeError("Install requirements-embeddings.txt in your Python environment first.") from error

    device = args.device
    if device == "auto":
        device = ("cuda" if torch.cuda.is_available() else
                  "mps" if torch.backends.mps.is_available() else "cpu")
    if device == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable; use --device cpu or auto.")
    if device == "mps" and not torch.backends.mps.is_available():
        raise ValueError("Apple MPS is unavailable; use --device cpu or auto.")
    torch.manual_seed(0)
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"Loading {MODEL_ID}@{args.revision} on {device} (local float16 inference).", flush=True)
    model = SentenceTransformer(
        MODEL_ID, revision=args.revision, device=device,
        cache_folder=str(args.cache_dir.expanduser().resolve()) if args.cache_dir else None,
        local_files_only=args.offline, trust_remote_code=False,
        model_kwargs={"torch_dtype": torch.float16, "attn_implementation": "eager"},
        tokenizer_kwargs={"padding_side": "left", "truncation_side": "right"},
    )
    model.max_seq_length = args.max_tokens
    model.eval()
    check_token_budget(model, anime + movies, args)
    print(f"Embedding {len(anime)} anime and {len(movies)} movies.", flush=True)
    with torch.inference_mode():
        anime_vectors = embed(model, anime, args.batch_size, np)
        movie_vectors = embed(model, movies, args.batch_size, np)
    scores = anime_vectors @ movie_vectors.T
    if not np.isfinite(scores).all():
        raise ValueError("Nonfinite cosine scores were produced.")
    # Clip float32 rounding excursions, retaining negative cosine scores.
    np.clip(scores, -1.0, 1.0, out=scores)

    # Reserve a fresh directory only after computation succeeds. No file is replaced.
    # Exclusive mkdir also catches a competing run creating the target meanwhile.
    output.mkdir(parents=True, exist_ok=False)
    for name, array in (("anime_embeddings.npy", anime_vectors),
                        ("movie_embeddings.npy", movie_vectors),
                        ("cosine_similarity.npy", scores)):
        with (output / name).open("xb") as handle:
            np.save(handle, array, allow_pickle=False)
    write_records(output / "anime_records.jsonl", anime)
    write_records(output / "movie_records.jsonl", movies)
    print(f"Saving {scores.size:,} pair scores to {output}.", flush=True)
    write_all_pairs(output / "all_pairs.csv.gz", scores, anime, movies)
    write_top_matches(output / "top_movies_per_anime.csv", scores, anime, movies, args.top_k, np)
    write_top_matches(output / "top_anime_per_movie.csv", scores.T, movies, anime, args.top_k, np)
    metadata = {
        "schema_version": 1, "status": "complete", "started_at_utc": started,
        "completed_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "inputs": {"anime": {"path": str(anime_path), "sha256": anime_hash, "rows": len(anime)},
                   "movies": {"path": str(movies_path), "sha256": movies_hash, "rows": len(movies)}},
        "script_sha256": sha256(Path(__file__)),
        "model": {"id": MODEL_ID, "requested_revision": args.revision,
                  "resolved_revision": getattr(model[0].auto_model.config, "_commit_hash", None),
                  "dimension": DIMENSION, "inference_dtype": "float16",
                  "attention": "eager", "pooling": "last_non_padding_token",
                  "device": device, "prompt": "",
                  "normalized": True, "saved_dtype": "float32", "max_tokens": args.max_tokens,
                  "padding_side": "left", "truncation_side": "right"},
        "preprocessing": {"fields": list(TEXT_FIELDS), "unicode_normalization": "NFC",
                          "title_priority": ["title", "title_english", "title_romaji"],
                          "ignored_title_columns": ["title_original", "title_native"],
                          "missing_fields": "omit label; retain record", "list_duplicates": "casefold"},
        "quality": {label: {
            "missing_fields": {field: sum(field in r["missing_fields"] for r in items)
                               for field in TEXT_FIELDS},
            "fallback_or_omitted_titles": sum(r["title_column_used"] != "title" for r in items),
            "truncated_records": sum(r["truncated"] for r in items),
            "max_input_tokens": max(r["token_count_before_truncation"] for r in items),
        } for label, items in (("anime", anime), ("movies", movies))},
        "similarity": {"metric": "cosine", "formula": "normalized_anime @ normalized_movies.T",
                       "range": [-1, 1], "shape": list(scores.shape), "pair_count": int(scores.size),
                       "row_axis": "anime_records.jsonl", "column_axis": "movie_records.jsonl",
                       "minimum": float(scores.min()), "maximum": float(scores.max()),
                       "mean": float(scores.mean()), "top_k_requested": args.top_k,
                       "interpretation": "Semantic similarity; not a probability or calibrated percentage."},
        "settings": {"batch_size": args.batch_size, "offline": args.offline,
                     "allow_truncation": args.allow_truncation, "random_seed": 0},
        "runtime": {"python": platform.python_version(), "platform": platform.platform(),
                    "packages": {name: importlib.metadata.version(name) for name in
                                 ("numpy", "torch", "sentence-transformers", "transformers", "huggingface-hub")}},
        "output_sha256": {p.name: sha256(p) for p in sorted(output.iterdir()) if p.is_file()},
        "notes": ["Same-work overlaps and franchise sequels are retained; IDs belong to different sources.",
                  "Hardware/library changes can cause small floating-point differences."],
    }
    # Written LAST: its presence with status=complete marks a successful bundle.
    with (output / "run_metadata.json").open("x", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write("\n")
    print(f"Complete: vectors {anime_vectors.shape}/{movie_vectors.shape}; scores {scores.shape}.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        print("If writing failed, keep any partial bundle for inspection and choose a new output directory. "
              "Only a run_metadata.json with status=complete marks a finished run.", file=sys.stderr)
        sys.exit(1)
