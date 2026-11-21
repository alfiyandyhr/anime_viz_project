# Embeddings and similarity scores

For updates to the website, use the [shared catalogue workflow](README.md). The browser reads precomputed scores. Python runs the model during a refresh or a separate research run.

## How scoring works

**Qwen/Qwen3-Embedding-4B** encodes each anime and movie as a 2,560-dimensional vector. The scorer pins the model revision to `5cf2132abc99cad020ac570b19d031efec650f2b` and uses the same document encoding with an empty prompt for both catalogues. [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-4B)

Each document contains the title, genres, tags (AniList tags or TMDB keywords), and synopsis. The scorer cleans text, deduplicates genre and tag labels within each field, and omits empty fields. It falls back to English and then romaji if the preferred title is missing or visibly damaged. Ratings, popularity, IDs, release dates, and aliases are excluded from the embedding input. AniList tags marked as spoilers are excluded during collection.

Vectors are saved as normalized float32 arrays. Their dot product gives signed cosine similarity in `[-1, 1]`. Higher scores indicate closer text representations. Scores have no percentage or probability interpretation. Shared genres, franchise entries, and gaps in source metadata can influence the ranking.

## Run a standalone experiment

Install `data/semantic_similarity/requirements-embeddings.txt` in a Python 3.10+ environment. Pass both input CSVs and a new output directory. For example, with two 100-title CSVs in the project root:

```bash
python data/semantic_similarity/compute_similarity.py \
  --anime-csv anime.csv --movies-csv movies.csv \
  --expected-count 100 --batch-size 2 \
  --output-dir data/semantic_similarity/output/experiment
```

The CSVs require `source`, `source_id`, `title`, `genres`, `tags`, and `synopsis`. Use `anilist` and `tmdb` for the respective sources, unique IDs within each file, and JSON arrays for genres and tags. `--expected-count` applies to each CSV and defaults to 1,000.

The first run downloads model weights. The default device selection tries CUDA, Apple MPS, then CPU. Reduce `--batch-size` to 1 or 2 to lower memory use, or select `--device cpu`. For a standalone run with cached weights, use `--offline`. The default 2,048-token budget includes special tokens. Longer inputs halt the run unless you raise `--max-tokens` (up to 32,768) or explicitly allow truncation with `--allow-truncation`.

## Read the outputs

| Output | How to read it |
| --- | --- |
| `anime_embeddings.npy`, `movie_embeddings.npy` | One normalized vector per title in input order |
| `cosine_similarity.npy` | Anime rows × movie columns |
| `anime_records.jsonl`, `movie_records.jsonl` | Row-to-ID maps, exact input text, token counts, and missing or truncated fields |
| `all_pairs.csv.gz`, `top_movies_per_anime.csv`, `top_anime_per_movie.csv` | All scores and ranked matches in both directions |
| `run_metadata.json` | Completion status, model revision, runtime versions, settings, and input and output hashes |

The website export stores the same scores movie-first in `data/movie_anime_scores.bin` as little-endian float32, with the axis order and hash in `data/movie_recommendations.json`. For annual anime outside the main matrix, the History exporter uses the same pinned model and reuses the catalogue's movie vectors when available.

Read the [methodology PDF](similarity_methodology.pdf) or its [LaTeX source](similarity_methodology.tex) for the scoring formula, data selection, and how the three views use the results.
