# Movie journey verification

Verified 2026-11-03 using the published repository data on a local static server,
the default 1280 × 720 desktop viewport, and a 390 × 844 mobile viewport.
This is a developer cognitive walkthrough, not a recruited-participant study.

## Repeatable browser walkthrough

Serve the repository root with `python3 -m http.server 8765`, then open
`http://localhost:8765/frontend/recommendations/index.html` in a fresh tab/session.

| Scenario | Action and expected result | Observed |
| --- | --- | --- |
| Fresh example | Open Task 1; Inception is explicitly an unchosen example. Focus **Explore these 20 matches →** and press Enter. | Task 2 identifies Inception (2010) and shows 20 of 20 matches. |
| Shared filters | Select Mystery, then follow each descriptive next action through Creators, Reception, and Explorer. | All pages show 8 of 20 Inception matches; Content renders both charts, Creators renders studio/heatmap charts and cast paths, Reception renders its scatterplot and 8-title KPI, and Explorer shows the same 8 titles. |
| Whole-set summary | Inspect Creators after filtering. | Studio-credit summary explicitly describes the original 20, while its note identifies the 8 visible matches used below. |
| Comparison | Shortlist Paprika and Serial Experiments Lain using Space on their checkboxes. | Footer shows original ranks 1 and 10, cosine scores 0.613 and 0.500, runtimes 90 and 299 minutes, and distinct AniList scores. |
| Shortlist limit | Add Death Note, then attempt another selection. Reset filters and advance the table page. | Unselected checkboxes disable at three; all three finalists remain compared after filtering and pagination. |
| Empty results | Search for a nonexistent title with two finalists selected. | Scope reports 0 of 20 and 20 hidden; comparison retains both finalists. Reset restores the same movie's available matches. |
| Restored session | Reload Explorer, revisit Task 1, and continue through the next actions. | Movie, active mode, and relevant filters restore; shortlist starts empty on reload. Task 1 restores the chosen movie without relabelling it as an example. |
| Explicit catalogue | Choose **Browse full catalogue**, search Naruto, reload, and visit Content, Creators, Reception, and Explorer. | All use catalogue headings, counts, and navigation; 5 of 1,000 catalogue anime remain visible. Movie is labelled as saved, with a resume link; journey guidance is hidden. |
| Resume matches | Follow **Resume matches for [movie]** after setting a different movie-match search. | Match search restores independently of Naruto catalogue search. Reset affects only match filters and retains the movie. |
| Movie change | Choose Inception after exploring another movie; change map cutoff to Top & Bottom 10 and continue. | New movie starts with all 20 matches, independently of map cutoff; catalogue search remains Naruto. |
| Mobile journey | Search and choose **Doraemon the Movie: New Nobita and the Castle of the Undersea Devil**, then follow Tasks 2–4 into Explorer at 390px. | Entire title and 20-match context wrap within the screen; document width stays 390px. Collapsing filters using Enter leaves context visible. |
| Mobile comparison | Shortlist Spirited Away and Ponyo; focus the comparison scroll region and use Right Arrow. Also check three-title comparison. | Footer remains within viewport (16px left/right margins); comparison scrolls horizontally by keyboard without widening the document. Clear shortlist works with Enter. |
| Direct entry | Open a dashboard page without a valid movie, including `?mode=matches`. | Explicit catalogue copy and a route to Task 1; no catalogue data is labelled as movie matches. Valid saved scope restores on direct entry. |

## Automated edge cases

Run `node --test tests/*.test.cjs` and
`python3 -m unittest discover -s tests -p 'test_*.py' -v` after installing the
backend requirements in your Python environment. Result: **81 Node tests and
19 Python tests passed**, including three Flask frontend route tests.

- Published example confirmation survives navigation and metadata joins. A
  deliberately incomplete dashboard exposes only 2 of the original 20 matches;
  the other 18 remain unavailable, with original IDs, ranks, and scores intact.
- Read errors, write errors, silently discarded writes, interrupted writes to
  each movie-context key, and a discarded catalogue-to-matches scope write never
  permit Task 1 continuation with a false success message.
- Guided pages with unavailable storage show a persistence warning in both the
  context strip and the next-action description. Local filtering still works.
- Shared filter changes dispatch every page's registered chart/summary renderers
  for unfiltered, narrowed, empty, and reset results. Creators' original-set
  studio summary has separate coverage.
- Invalid direct-entry context, legacy filters, independent scope filters,
  changing movies, comparison evidence, missing runtime, hidden finalists,
  shortlist clearing, and reload behaviour are covered.
- Flask serves every journey page with direct, matches, and catalogue queries
  plus the published data without live API calls. Existing bookmark and relative
  resource checks continue to pass.

## Brief usability walkthrough

At each guided page, read only the visible heading, context strip, and next
action, then answer these prompts:

1. **Which movie did I choose?** The context names the movie and year; the long
   Doraemon title remains readable on mobile with filters collapsed.
2. **Which anime am I seeing?** The strip distinguishes the original Top 20,
   visible matches, filter-hidden titles, and missing metadata. In catalogue
   mode it explicitly names the full catalogue and counts its sampled titles.
3. **What should I do next?** Content directs users to creators, Creators to
   reception, and Reception to Explorer. Explorer directs users to shortlist
   2–3 titles and compare similarity, format, runtime, and audience scores.

Each answer was available from those visible elements in the walkthrough.
The four-task indicator marks location only; it does not claim measured
completion. Story and Dust & Magnet remain labelled optional.

## Fixes and limits

Verification fixes explicitly associate minimum-score sliders with their labels,
name Explorer pagination actions and the current page, make both table scroll
regions keyboard-focusable and named, and avoid persistence promises in guided
next-action copy when storage is unavailable.

Session context is limited to browser session storage. Shortlists live only in
the current Explorer document: filtering, sorting, pagination, and resizing keep
them; reloading or navigating away clears them, including scope navigation.
Missing metadata is never replaced. This walkthrough does not establish outcomes
for real first-time participants or exhaustive screen-reader/device coverage.
