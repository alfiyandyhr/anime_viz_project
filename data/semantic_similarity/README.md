# Refreshing the AniMoViz data

Dust & Magnet and Full Catalogue share a catalogue of 1,000 anime and 1,000 movies. History uses a separate AniList archive of annual rankings and matches its annual winners against the shared movie sample.

## Refresh the shared catalogue

Use the [installation and refresh commands in the project README](../../README.md#refresh-the-dataset-and-similarity-scores). Run them from the repository root on macOS or Linux.

1. `python data/refresh_data.py --update-dataset` collects and stages the two catalogues. It uses popularity order, keeps unique source IDs and excludes adult entries. When a TMDB movie is the same version as a sampled AniList film, the AniList entry stays and the next eligible TMDB movie fills the slot. The matcher uses reviewed ID pairs and compares titles and aliases, format, dates, runtimes, and synopses.
2. Review the printed `duplicate_report.json` path for exclusions and ambiguous pairs kept in the sample. For a reviewed correction, update `SAME_VERSION` or `DISTINCT_VERSIONS` in [refresh_data.py](../refresh_data.py) and rerun collection. Add `--resume` to continue an interrupted collection from its last checkpoint.
3. `python data/refresh_data.py --recompute-scores` validates the staged roster, computes the complete cosine matrix and writes the published files. It rebuilds History's movie matches from the existing `story.json`. Rerunning this command can reuse completed scores for the same staged catalogue. See the [embedding guide](README_EMBEDDINGS.md) for model and hardware settings.
4. `python data/refresh_data.py --update-dataset --anime-creator-only` updates original-creator credits for the newly published anime roster. Movie cast and writing credits are already collected with the main dataset. For a movie credits-only update, use `--update-dataset --cast-and-writer-only`.

Keep the ignored `output/catalogue/` directory between collection and scoring. It holds checkpoints, staged snapshots, duplicate reports, and completed score runs. `output/story/` caches supplemental History metadata, vectors, and score rows.

## Refresh History's annual AniList archive

To update the annual anime rankings themselves, regenerate the two History files together.

```bash
python data/refresh_story.py
python data/export_story_recommendations.py --annual --compute-missing
```

If you are also refreshing the shared catalogue, run `refresh_story.py` before `--recompute-scores`. That step exports the annual matches for the new archive and catalogue in one run. If all required supplemental score rows are already cached, use `--annual --offline` for a standalone export.

## Publish together

Commit the updated files as one set. Check both Catalogue tabs, both title directions in Dust & Magnet, and both timelines in History before publishing.

| Files | Contents |
| --- | --- |
| `data.json`, `data/anime_credits.json` | Anime metadata and original-creator credits |
| `data/movie_recommendations.json`, `data/movie_anime_scores.bin` | Ordered title records, ranked matches, and the complete score matrix |
| `data/movie_popularity.json`, `data/movie_details.json` | Movie popularity and ratings, artwork, runtimes, and credits |
| `story.json`, `data/history_movie_matches.json` | Annual AniList archive and matches against eligible movies |
