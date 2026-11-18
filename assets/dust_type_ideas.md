# Dust type ideas

**Dust type** answers “What does each dot represent?” **Magnet type** answers
“What pulls those dots?” Today, **Anime titles** uses individual AniList works
and **Movie titles** uses individual TMDB works. Title and genre-cohort magnets
come from the other catalogue. Popularity and Score use metrics from the
selected dust catalogue. This gives future options such as **Anime studios**
and **Japanese voice actors** a place in the same selector. Show one kind of
dot at a time so the field, ranking, and comparison use the same unit.

## What could become dust?

| Dust type | Which titles belong to a dot | Feasibility |
| --- | --- | --- |
| **Anime studios** | Each dot represents one AniList studio ID. Include each sampled anime for which AniList lists it as a main studio. A co-production counts once for each credited studio. | Ready to prototype from the published dashboard joined to the recommendation sample. All 1,000 anime have a main studio ID. There are 186 distinct studios, including 86 with at least three sampled works. [AniList collector](../backend/anilist_service.py) |
| **Japanese voice actors** | Each dot represents one AniList person ID, including actors and actresses. Include each anime with a sampled Japanese voice credit for that person and retain the character names for evidence. Multiple roles in the same anime count as one work. | Ready to prototype. The current query samples Japanese cast for up to 12 main characters per title. The joined snapshot has credits for 996 anime, covering 911 people. Of those, 331 have at least three sampled works. Use the per-title credits to build memberships. [AniList collector](../backend/anilist_service.py) |
| **Anime genres** or **Movie genres** | Each dot represents a genre from one provider. Include every sampled title with that label. Give a multi-genre title full membership in each genre and keep the provider vocabularies distinct. | Ready to prototype from the recommendation bundle. It has 18 AniList genres and 19 TMDB genres, small enough to show every eligible group. Use labels like **Anime genres** to make the catalogue visible in the selector. [Recommendation bundle](../data/movie_recommendations.json) |
| **Movie cast** or **Production companies** | Group movies by TMDB person or company ID. Count a cast member once per film and retain credited roles. Include all credited production companies and keep distributor credits separate. | Requires a sidecar for the 1,000 published movie IDs. The current export covers artwork, runtime, and reception. An offline collection can add cast and companies with the existing join pattern. [Movie details exporter](../data/export_movie_details.py) · [TMDB movie credits](https://developer.themoviedb.org/reference/movie-credits) · [TMDB movie details](https://developer.themoviedb.org/reference/movie-details) |

The coverage counts describe the checked-in snapshots. Credits represent the
sampled catalogue and collection rules. Show that scope in the field and on
the detail panel so a handful of sampled titles can be interpreted in context.
[Dashboard snapshot](../data.json) · [Recommendation bundle](../data/movie_recommendations.json)

## Membership, scores, and sampling

1. **Build memberships from the full dust catalogue.** Join metadata by
   provider title ID and index each group by a typed provider key such as
   `anilist:studio:858`. Deduplicate title IDs within each group. Keep the union
   of supporting titles deduplicated when a linked chart covers multiple groups.
   Dot limits and display filters apply after scoring, so the score for a given
   studio stays the same when the field changes from 30 to 60 dots.
2. **Reuse title scores for story magnets.** For a title magnet, compute the
   signed mean cosine across the group's eligible member titles, with one vote
   per title. For a genre-cohort magnet, average the existing per-title cohort
   scores across the group. For example, an anime Horror dot near Inception
   means sampled horror anime have higher average story similarity to that
   magnet. A **Genre cohort** magnet still represents a group on the magnet side.
3. **Define what each metric means at group level.** Start with the median raw
   popularity or rating of a group's covered titles to describe a typical work.
   A later direct credit or genre magnet can score the share of covered works
   meeting the criterion. For example, 8 horror anime among 20 covered works
   gives a studio a Horror share of 0.40. Show the numerator and denominator.
4. **Show coverage and handle small groups.** For each group, report sampled
   works and the number with scores. Where a group is scored against several
   magnets, use the same member titles with values for all of them for the
   combined comparison. Surface groups with no eligible works as unavailable.
   Start ranked studio and performer fields at three contributing works and
   let users lower the threshold to find smaller filmographies. Keep low-support
   groups discoverable in search with their counts. If a few credits still
   dominate rankings, test shrinking the mean toward the catalogue average
   while displaying the raw mean and sample size.
5. **Sample groups with the existing pattern.** Reserve roughly half the dot
   budget for the strongest groups per magnet, deduplicate those choices, and
   fill the rest by combined score. For a compact genre field, show all eligible
   groups when they fit. Give group dots the same size initially and show work
   counts in the tooltip and ranking. [Current scoring and sampling](../frontend/common/dust-context.js)

These example means use the published movie–anime score matrix and the current
memberships. The narrower gap for Kana Hanazawa is worth showing alongside the
dot position, since dragging the magnets changes the layout.

| Example dot | Sampled works | Inception | The Conjuring |
| --- | ---: | ---: | ---: |
| MADHOUSE | 49 | 0.357 | 0.300 |
| Kana Hanazawa | 53 | 0.321 | 0.299 |
| Horror anime | 53 | 0.347 | 0.406 |

## Attraction and magnet strength

- **Build a score vector for each group.** A story-only field can use signed
  mean cosines. When Popularity or Score is active, convert each aggregate
  column to tie-aware percentiles over eligible groups of the selected type.
  Preserve the raw mean, median, or share in the evidence and label the
  combined result as attraction. For a future binary credit magnet, preserve a
  zero share as zero pull so ties among groups with no matches stay neutral.
- **Feed the group scores to the existing simulation.** A single active
  magnet uses a spring whose coefficient scales with the positive part of the
  score. A negative cosine contributes zero to that spring. Multiple active
  magnets place a target using exponential weights on their scores. Clear
  leads favor one anchor and narrow gaps leave the dot between competing
  magnets. Within-magnet percentiles also inform the preferred distance, while
  spacing and damping make the field readable.
- **Keep the 0× to 2× strength control.** At 0× the magnet stops contributing
  to the layout. For multiple active magnets, the existing simulation adjusts
  each score by `temperature × log(strength)` before computing its pull
  weight. Keep ranking, sampling, and displayed score evidence based on the
  underlying group scores. Test ties, small score gaps, sparse memberships,
  and dragged anchors in both the field and mirror. [Current simulation](../frontend/recommendations/dust-magnet.js)

## Interface and rollout

Prototype **Anime studios** with movie title magnets first. The needed
memberships and story scores are already published, and a studio's supporting
titles give users a direct way to check the score. **Anime genres** and **Movie
genres** are a low-data companion. Japanese voice actors can reuse the same
group scoring with role evidence and a more visible coverage count. Movie cast
and companies can follow once the matching credit sidecar is available.

Have each dust type supply its catalogue, typed keys, membership lookup, and
compatible magnets. Keep title sessions readable through the current direction
keys. Save group-specific selections, filters, and layout under their own keys.
When changing dust types within the same catalogue, carry over compatible
magnets and keep the ranking and selection specific to the new type.

For a selected group, show the scores and contributing-title count, and link to
the strongest supporting titles. Include role names for performers. Label chart
summaries by unit, for example **Release years of supporting titles**. Any
scope passed to Network should contain the distinct supporting anime work IDs,
which are the unit Network uses today. Test that group scores survive changes to
the dot limit and display filters, empty coverage has a clear message, and
legacy title sessions still restore. [Details and comparison](../frontend/common/dust-details.js) · [Network scope](../frontend/network/scope.js)
