# Local anime-movie semantic similarity

This adds an independent analysis step to the existing AniList/TMDB collectors.
It reads the two CSVs in `output/` and does not modify them, the collectors,
the dashboard, or `data.json`. The script has not been executed during authoring.

## Model and method

The default is **Qwen/Qwen3-Embedding-0.6B**: a free, Apache-2.0, multilingual
text embedding model with 1,024 output dimensions. A specific Hugging Face
commit is pinned in the script. It is a strong practical local choice, not a
claim of being the universal best model for anime/movie similarity.

Each record becomes one labeled text containing **title, genres, tags, and
synopsis**, then one L2-normalized dense vector. Qwen's trained pipeline pools
the final non-padding token representation. Both corpora use the same
model and an explicitly empty prompt: symmetric document-to-document encoding,
rather than a retrieval query on one side and a passage on the other.

`title` is preferred; `title_original` and `title_native` are never embedded.
If `title` is empty or contains replacement/non-whitespace control characters,
the script tries `title_english`, then `title_romaji`, then omits the title.
Valid non-Latin text is preserved. Strict UTF-8 reading prevents silent byte
replacement; already-corrupted but syntactically valid mojibake cannot always
be detected or repaired. Inspect `*_records.jsonl` for the exact text used.

Genres/tags are parsed as JSON arrays, cleaned, and deduplicated within each
field. Missing fields are omitted; their rows remain present. Source, IDs,
ratings, popularity, alternative titles, and the prebuilt `semantic_text`
column are excluded from the embedding input. There are no explicit field
weights: field length, wording, and model attention affect the final vector.

Scores are **raw cosine similarity in [-1, 1]**. Since vectors are unit length,
the full matrix is `anime_vectors @ movie_vectors.T`. Larger means closer in
this embedding space. A score of 0.8 does **not** mean an 80% probability of
similarity. Ranking is a useful starting point; thresholds need human labels.

## Install and run yourself

From the repository root, use a separate environment, for example:

```bash
python3 -m venv /tmp/anime-similarity-venv
source /tmp/anime-similarity-venv/bin/activate
python -m pip install -r data/semantic_similarity/requirements-embeddings.txt
python data/semantic_similarity/compute_similarity.py
```

No OpenAI package, paid API, or API key is required. The first run downloads
model weights from Hugging Face (roughly 1.2 GB of BF16 weights; other files
and cache need additional disk space). All inference happens locally. The
script loads float32 weights, roughly 2.4 GB for weights alone; activations
and Python require additional memory. Actual runtime and memory depend on
your hardware, token lengths, and batch size; no timing is promised.

`--device auto` selects CUDA, then Apple MPS, then CPU. If GPU memory is tight,
lower `--batch-size` to 1 or 2; if your MPS runtime lacks an operation, use
`--device cpu`. No FlashAttention or CUDA-only dependency is required.

After weights for the pinned revision are cached, prevent network access with:

```bash
python data/semantic_similarity/compute_similarity.py \
  --offline --output-dir data/semantic_similarity/output/similarity_offline
```

An existing output directory is refused, even if it is empty. Use a new
`--output-dir` for each experiment; there is intentionally no overwrite flag.
The default checks **exactly 1,000 rows per CSV** and unique `(source, source_id)`
keys. For deliberately smaller input CSVs, set `--expected-count` to their
shared row count. `--anime-csv` and `--movies-csv` override input paths.
Defaults are anchored to the script directory; explicit relative paths are
relative to your shell's working directory.

The default input budget is **2,048 tokens**, including special tokens. Every
input is counted before encoding. If any input is longer, the run stops rather
than silently dropping text. Increase `--max-tokens` up to 32,768, or explicitly
choose `--allow-truncation`; that choice records affected rows and drops text
from the right. Retain the default budget unless the length check says otherwise.
Longer budgets and bigger batches can increase memory use substantially.

## Saved outputs

The default destination is `data/semantic_similarity/output/similarity/`:

| File | Meaning |
| --- | --- |
| `anime_embeddings.npy` | Float32 unit vectors, shape `(1000, 1024)` |
| `movie_embeddings.npy` | Float32 unit vectors, shape `(1000, 1024)` |
| `cosine_similarity.npy` | Float32 matrix, shape `(1000, 1000)`; anime rows, movie columns |
| `anime_records.jsonl`, `movie_records.jsonl` | Zero-based row maps, source IDs, titles, cleaned fields, exact input text, token counts and missing/truncated-field flags |
| `all_pairs.csv.gz` | All 1,000,000 pairs with indices, source IDs, and raw cosine score; gzip-compressed CSV |
| `top_movies_per_anime.csv` | Best 20 movies per anime by default, with titles and scores |
| `top_anime_per_movie.csv` | Best 20 anime per movie by default, with titles and scores |
| `run_metadata.json` | Model revision, hashes, parameters, actual package versions, quality counts, score statistics, completion marker |

The binary arrays occupy approximately 12.2 MB total before file headers.
CSV/JSONL outputs add more space. The all-pairs CSV uses source IDs and index
maps to avoid repeating long titles one million times. Ranks start at 1;
array/record indices start at 0. `--top-k` changes the ranked-output size only,
never the complete matrix. Exact score ties retain candidate CSV order.

For a later consumer of the generated files (not a command executed here):

```python
import json
from pathlib import Path
import numpy as np

folder = Path("data/semantic_similarity/output/similarity")
scores = np.load(folder / "cosine_similarity.npy", allow_pickle=False)
with (folder / "anime_records.jsonl").open(encoding="utf-8") as f:
    anime = [json.loads(line) for line in f]
with (folder / "movie_records.jsonl").open(encoding="utf-8") as f:
    movies = [json.loads(line) for line in f]
# scores[i, j] compares anime[i] with movies[j].
```

`run_metadata.json` is written last. Its absence means an interrupted/failed
bundle is incomplete; choose a new directory when retrying. The script records
input and output hashes but does not guarantee bitwise identical results across
different hardware or library versions.

## Review before interpreting results

Check best matches, random pairs, and low-score pairs manually. Shared genres
can inflate apparent similarity; different tag vocabularies and missing
synopses can weaken it. Movie records can include the same animated work as
the anime corpus, and franchises/seasons can dominate top results. These
overlaps are retained, not inferred or automatically deleted across databases.
The score measures the supplied text, not plot identity, personal preference,
or causal influence. Future field-weighted scoring should be evaluated as a
different method rather than mixed with these baseline scores.

## References

- [Qwen3-Embedding-0.6B model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- [Qwen3 embedding technical report](https://arxiv.org/abs/2506.05176)
- [BAAI BGE-M3 alternative](https://huggingface.co/BAAI/bge-m3)
- [Google EmbeddingGemma alternative (license acceptance required)](https://huggingface.co/google/embeddinggemma-300m)
- [Sentence Transformers semantic textual similarity](https://www.sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html)

The five-page `similarity_methodology.pdf` and its `.tex` source explain the
selection, text representation, equations, outputs, libraries, and limitations.
