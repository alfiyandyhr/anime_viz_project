# Anime magnets and movie dust

The forward regression fixture in `tests/fixtures/dust-forward-3342eb3.json`
captures Inception alone and Inception + Interstellar + The Matrix on the
`alfi` baseline at `3342eb3`. Each field uses 60 candidates. The fixture records
candidate IDs, mean ranks, exact per-magnet cosine vectors, and the 1,000-title
rank order for each sort basis. It also records displayed membership before and
after filtering for Action and release year 2000 or later.

1. Open Dust & Magnet on a fresh session and confirm the Inception example.
   Choose **Anime → Movies**. Cowboy Bebop opens as the example and Treasure
   Planet ranks first at `0.6052206158638`. Inception and Cowboy Bebop share
   the exact score `0.5034430027008057` in either direction.
2. Search with an alias or year, add a second and third anime magnet, and
   exercise 30, 60, and 90 dots. Move a magnet with arrow keys. Reset positions
   and check that selection and strongest-magnet colors remain intact.
3. Compare movie dots. Inspect a title outside the field in the full ranking
   and press Escape to return focus to the row. The drawer shows published
   TMDB text, keywords, genres, and cosine evidence for that movie.
4. Narrow movie dust by genre, then filter to empty and reset. Compare the
   field, mirror, connections, chart counts, and displayed ranking flags.
   Open the legacy Content, Reception, and Creators links. Reception and
   Creators show coverage notes for the movie sample.
5. Switch back to Movie → Anime and return to Anime → Movies. Check separate
   selections, filters, ranking sorts, magnet positions, and scroll. Remove
   every anime magnet and confirm that switching preserves the empty field.
6. Open a legacy Current dust link while movie dust is active. Network falls
   back to Catalogue even if v1 contains an older anime set. With active anime
   dust filtered to zero, Network keeps Current dust and shows zero works.

Run the existing browser suites and the directional walkthrough below with
the Playwright setup documented later in this guide. The walkthrough includes
desktop and touch/mobile layouts, reload and Back/Forward, and a matrix Retry
while dashboard metadata is unavailable. It runs against both Flask and the
prefixed static deployment.

```sh
NODE_PATH=/tmp/aniviz-browser/node_modules \
  CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  ANIVIZ_BASE_URL=http://127.0.0.1:8766/anime_viz_project/ \
  node tests/browser/dust-directions.cjs
```

---

# Route migration and final verification — Tasks 9–10 — 2026-11-06

Completed on `alfi`, retaining the existing Tasks 1–8 work. The current contract
has four views, normal scrolling analysis and independent data scopes. Entries
below this section are historical records of earlier implementation stages.

## Repeatable walkthrough

1. Open the root with a fresh session. The field immediately shows the labelled
   Inception example and 60 dots. Use the four-item dropdown with keyboard arrows,
   Tab/Enter and Escape. Add Interstellar and The Matrix in the search input;
   exercise 30, 60 and 90 dots under Field options and remove movies directly.
2. Scroll through Similarity connections → Score vs. popularity / playground mirror →
   Genres → Release years → Studios → Studio × genre → Full anime ranking. No task, show-chart or
   comparison action is needed. Each movie map shows its displayed-dust top 5 and bottom 5
   with curved, score-weighted links (ranks 1–5 and 56–60 with 60 visible dots).
   Curves, endpoint dots and scores match the anime's dust color for its closest magnet;
   the full ranking table includes all 1,000 recommendation records.
3. Select two dots by tap or Enter/Space. Inspect automatic comparison immediately
   below the field. Confirm shared highlights and aggregate contributions without
   changing the charts' displayed-dust scope. Reset positions preserves selection;
   Remove / Clear selection clears it. A fourth selection retains the first three.
4. Exercise each active magnet sort and Average similarity. Every sort resets
   pagination, preserves selected IDs, candidates, scores and positions, and
   reorders only the ranking table. Remove the sorted movie: Average
   similarity becomes active. Both displayed and outside-dust ranking titles
   open the catalogue detail drawer without changing the dust comparison.
5. Filter using genre, studio, year and occupied heatmap marks, then remove chips.
   Filter to empty and Reset filters. Supporting charts consume the same displayed IDs;
   comparison maps rerank within the filtered dust and stay independent of table sorting;
   an empty dust field also clears the maps and offers filter guidance;
   missing metadata is separate from filtering, and unknown metrics stay unknown.
6. Switch to Network: Current dust uses the displayed set; Catalogue is local.
   Full Catalogue starts from its own sample and filters; its shortlist does not
   affect dust. History retains independent annual samples, six eras and posters.
   Back/Forward, returning through the menu and reload restore dust state/scroll.
7. Check root `#recommendations`, `#content`, `#creators`, `#reception`, `#story`,
   `#explorer`, `#dust-magnet`, plus old HTML URLs. Content/Creators/Reception land
   on their main sections. Creators' graph bookmarks land in Network. Catalogue
   ignores old matches mode; graph links translate old modes to local scope.
   New explicit section links override old scroll; Back/reload restore location.
8. Deny session storage, fail metadata, fail the score matrix and Retry. Test
   legacy seed migration before/after metadata arrives, invalid seeds, and a
   versioned session with no movies. Verify the legacy Top-20 IDs are never used
   as new membership. Test root fallbacks with JavaScript disabled.
9. Review 1440×900, 1280×720 and 390×844, reduced motion, chart focus/evidence and
   touch scrolling beside dots. Horizontal tables/maps/heatmaps scroll in their
   named regions, with no page-wide horizontal overflow.

## Observed outcomes

Headless Chrome with Playwright exercised the walkthrough against local static
hosting, Flask, and a static `/anime_viz_project/` deployment prefix. No live
AniList/TMDB API request was needed for route and published-data checks.

| Check | Observed result |
| --- | --- |
| Normalized join / missing metadata | Actual 997/1,000 overlap retained, plus a reduced fixture using the three real unmatched IDs on each side. Dashboard-only records never replace missing recommendation metadata. |
| Ranking | All 1/2/3-movie bases tested with exact arithmetic, negative scores and stable ties. Browser pagination, movie removal, selection preservation and independent full-corpus scope passed. |
| Shared scope | Real genre/year/studio/heatmap mark counts and selected contributions matched displayed IDs before and after filtering. Map IDs remained a displayed subset; scatter IDs matched finite score/positive-popularity records. |
| Direct interaction | Keyboard/touch two-title comparison, outside-ranking inspection, explicit removal, empty/reset, and 30/60/90 candidates passed. Touch scrolling around the field preserved selection. |
| Session / isolation | Movies, scores, selected IDs, ranking sort, filters and layout round trips passed. Menu navigation, Back/Forward and reload restored scroll, including anchored URLs. Catalogue search survived independently; History never loaded the dust adapter. |
| Legacy migration | A resolvable seed became one magnet with 60 freshly computed dusts. Metadata-first loading passed. Old IDs/ranks/filters stayed out of the new state; an explicitly empty versioned session took priority. |
| Failure states | Denied storage retained interactive in-memory dust and one notice. Metadata HTTP 503 retained dust and full ranking, with unavailable coverage. Matrix HTTP 503 showed no fabricated dots/ranks; Retry recovered. |
| Routes / hosting | Legacy hashes, HTML stubs, graph anchors, query modes and unrelated query parameters passed. Flask clean paths, History/Catalogue aliases, project-prefix relative assets and real no-JavaScript refresh fallbacks passed. No redirect loops. |
| Layout / evidence | Four views and main charts reviewed at desktop/mobile sizes; no page-wide overflow. Chart axes, counts, local color meanings, log popularity, focus evidence and confined horizontal scrolling remain readable. |

The before/after captures for this pass use Inception + Interstellar + The Matrix,
60 dots, no filters/selection and matching viewports. Displayed IDs, first-viewport
control count (7), visible interface prose (36 words) and field bounds are identical:

| Viewport | Field bounds (x, y, width, height) | Portion of entire first viewport |
| --- | --- | --- |
| 1440×900 | 16, 116, 1408, 772 | 83.9% |
| 1280×720 | 16, 116, 1248, 592 | 80.2% |
| 390×844 | 8, 146, 374, 674 | 76.6% |

The visible-control count includes the closed Field options summary and the
three direct remove-magnet buttons. The visible word count includes the short scope line and excludes dropdown
choices, plotted SVG labels, credits and below-fold content. These measurements show preservation of the
previous screen-space work during route cleanup. They do not establish an
additional usability gain. Visual review separately checked charts and legends;
mobile connections and the heatmap intentionally require local horizontal scroll.
The earlier Tasks 6–8 entry records the broader prose reduction comparison.

Captures (`before-*`, `after-*`, matched JSON metrics, four-view screenshots and
individual desktop/mobile chart views) are in:
`~/.codex/visualizations/2026/11/06/01a1b04f-c6b0-7763-8a57-d98291ef8e99/tasks-9-10/`.

This was a developer walkthrough framed around first-entry discovery, finding
anime for a movie, scrolling to genres/ratings and comparing two dots. No
recruited first-time-user study or screen-reader audit was performed; automated
passes alone are not evidence of improved usability.

## Automated checks and browser setup

Final results: **85 Node tests, 20 application Python tests and 9 similarity-data
Python tests passed**, plus both browser runners. The Node total is lower than
the previous stage because obsolete numbered-journey and Top-20 continuation
assertions were replaced with migration, four-view, fixture and scope contracts.
Recommendation scores/geometry, graph semantics and historical-data suites remain.
`git diff --check` passed.

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
python -m unittest discover -s data/semantic_similarity/tests -p 'test_*.py'
git diff --check
```

Browser checks are optional and keep dependencies outside this repository.
Install Playwright, then either install its Chromium (`npx --prefix
/tmp/aniviz-browser playwright install chromium`) or set `CHROME_PATH` to an
existing browser. The observed run used local Google Chrome.

```sh
npm install --prefix /tmp/aniviz-browser playwright
python -m http.server 8765 --bind 127.0.0.1
# In another terminal, from the repository root:
NODE_PATH=/tmp/aniviz-browser/node_modules \
  CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node tests/browser/verify.cjs
NODE_PATH=/tmp/aniviz-browser/node_modules \
  CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node tests/browser/routes.cjs
NODE_PATH=/tmp/aniviz-browser/node_modules \
  CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node tests/browser/dust-connections.cjs
```

The dust-connections regression checks displayed-only local ranks, 30/60/90 dots,
filters and empty/small sets, per-anime curve/dot/score colors, stable colors after
movie removal/re-addition, keyboard detail access, and mobile session restoration.

`ANIVIZ_CAPTURE_DIR` writes screenshots. `ANIVIZ_BASE_URL` changes the base for
either runner. Prefix verification used a server rooted at the repository's parent
with `http://127.0.0.1:8766/anime_viz_project/`. Flask verification used
`PORT=8767 FLASK_DEBUG=false python backend/app.py`, then `routes.cjs` with
`ANIVIZ_BASE_URL=http://127.0.0.1:8767/ ANIVIZ_FLASK=1`. Both route runs passed,
including no-JavaScript fallbacks. Browser tests require access to the existing
D3 CDN resource; optional fonts/images may load separately.

---

# Network, History, Catalogue and copy — Tasks 6–8 — 2026-11-06

Completed on `alfi`, preserving the existing Tasks 1–5 work. Tasks 9–10 remain
pending; route migration and the broader validation checklist are outside this
pass. Served the static repository at `http://127.0.0.1:8765/` and exercised
headless Chrome with Playwright.

| Scenario | Observed result |
| --- | --- |
| Network entry and scope | Direct entry uses the 1,000-title catalogue sample. A saved three-movie, 60-dust context defaults to Current dust and reports `35 of 60 works`. The graph's work IDs come from the displayed set, not the legacy Top 20. An empty filtered dust set stays empty. |
| Local controls | Search, Catalogue / Current dust, and all node-type toggles update only Network. Saved dust state and catalogue filters are unchanged. Search-to-empty and all-types-off show concise empty states. The 35-work popularity cap, 12-main-character credit sample, and link-width saturation are disclosed. |
| Evidence and motion | Actor, character, work, and edge inspection work with Enter; focus shows exact counts and relationship evidence. Characters remain work-scoped. Actor profiles include the active scope beyond the 35 rendered works. Drag and zoom work; reduced motion starts with a settled layout. |
| Return to dust | Movies, 60 displayed IDs, scores, filters, two-title comparison and scroll position restore after visiting Network and Full Catalogue. |
| Full Catalogue | Direct entry and old `?mode=matches` URLs use the full loaded sample before catalogue filters. No movie banner or KPI/insight wall. Search is visible; advanced filters are compact. Sort, 25-row pagination, row details, and shortlist controls work. Comparison is automatic, inline, retained through filtering, and independent of dust selection. Individual removal and Clear work. |
| History | All six eras, source links, annual posters, period rankings, sticky archive and timeline remain. Year 1995, modern-era navigation, return to 1963, and poster details work. Current-popularity sampling caveat sits beside the initial archive. Cover, repeated reading prompts, and movie detours are omitted. Mobile retains period coverage. |
| Layout and copy | Reviewed 1440×900, 1280×720 and 390×844. No page-wide overflow. Catalogue/ranking overflow is confined to named table regions. Supporting charts have one title and one short encoding/coverage note. Methods, freshness and cache details are collapsed; TMDB logo and attribution remain. |
| Failure and compatibility | Denied storage keeps Network usable in Catalogue scope and Full Catalogue usable with a brief persistence notice. Legacy chart adapters still render, including empty Reception without an unsupported correlation. Unique DOM IDs and freshness targets were checked. |

Before/after screenshots used the same default scopes at 1440×900: Inception
with 60 dusts; Catalogue Network; History at 1963; unfiltered 1,000-title
Catalogue. An indicative interface text audit (excluding tables, selected-title
content, credits and era narrative, and counting only one choice for closed
select controls) fell from about 181 to 99 words for the main view, 135 to 48
for Network, 167 to 60 for History, and 181 to 34 for Catalogue. These are
approximate copy checks, not a formal usability study; the main view approaches
the halving target while retaining essential encodings. History's narrative was
reviewed separately: six repeated reading prompts and redundant sample-reading
paragraphs were removed; milestones and their sources remain.

Captures are retained in the session artifact folder:
`~/.codex/visualizations/2026/11/06/01a1b03c-c9fc-7f71-ac0f-c503164e42f1/tasks-6-8/`.

Automated results: **103 Node tests and 19 Python tests passed**; `git diff
--check` passed. Graph semantics tests now load the extracted implementation;
focused scope tests cover normalized joins, missing metadata, direct fallback,
read-only session access and filtered-to-empty behavior. Existing expectations
for removed banners, generated journey copy, KPI walls and movie-scoped
Catalogue comparison were updated to the Tasks 6–8 behavior.

```sh
node --test tests/*.test.cjs
/opt/anaconda3/bin/python -m unittest discover -s tests -p 'test_*.py'
git diff --check
```

---

# Scrolling analysis and direct comparison — Tasks 4–5 — 2026-11-06

Completed on `alfi`, building on Tasks 1–3. Tasks 6–10 remain pending.
The static repository was served at `http://127.0.0.1:8765/` and exercised in
headless Chrome with Playwright, including reduced motion and a touch context.

| Scenario | Observed result |
| --- | --- |
| Main flow | Movie search adds magnets directly. Normal scrolling reaches the displayed-dust connection map, the 1,000-record similarity ranking, Genres, Release years, Studios, Studio × genre, and Reception. No continuation or chart-unlock action. |
| Ranking and scope | Each of three movie sorts and average sort reset pagination to rank 1 while preserving dust IDs, exact scores, selections and magnet positions. Removing the sorted movie falls back to average. The map uses its stated strongest/weakest displayed-set subset; selected-movie links receive emphasis. |
| Direct selection | Enter/Space on dots, map nodes and scatterplot marks toggles the same selection. Three selected dots produce nine links with three movies. A fourth attempt retains all three titles and announces the limit. Map and scatterplot keyboard focus survives updates. |
| Inline evidence | One title shows metadata and all active-movie scores. Two/three titles immediately compare format/year, episodes, runtime, AniList score, status, each movie's cosine score and their arithmetic mean on aligned common scales. Synopsis/tags and sampled Japanese cast are collapsed until requested. |
| Outside ranking rows | A row outside the displayed dusts opens separate score/metadata evidence alongside the existing comparison. Dust IDs, selected IDs and analytical revision are unchanged. Closing this inspection preserves the comparison. |
| Filtering and highlights | Genre, year, studio and occupied heatmap marks narrow the shared field without refilling candidates. Reset restores the original candidates. Selection highlights appear in the field, map, scatterplot and ranking where the selected titles are present. |
| Explicit removal | Re-selecting a title removes it; inline Remove and Clear selection work. Background clicks, magnet dragging and Reset positions retain the comparison. Selection does not force-scroll. |
| Session restoration | Reload and Full Catalogue → Back preserve the multi-title selection and dust state. Catalogue selection remains independent. |
| Loading failures | A metadata HTTP 503 leaves 60 dots and the complete ranking available; details show Unknown and unavailable charts have coverage notices. A matrix HTTP 503 shows no invented dots/ranking; Retry restores the field. |
| Empty/count states | Removing all magnets hides details and empties the field. Search can add a magnet again. The 30/60/90 controls produce those candidate counts. |
| Layout/touch | Checked 1440×900, 1280×720 and 390×844. Comparison is in document flow, with table overflow confined to its named horizontal region; no page-wide overflow. Phone taps add/remove titles without forced scrolling. White outlines retain the underlying movie/genre colors. |

Automated results: **99 Node tests and 19 Python tests passed**.

```sh
node --test tests/*.test.cjs
/opt/anaconda3/bin/python -m unittest discover -s tests -p 'test_*.py'
```

`tests/dust-selection.test.cjs` covers toggle/cap behavior without score or
membership changes, shared comparison scales, every movie's signed score,
Unknown metadata, empty details and independent outside-row inspection.
The previous background-clear assertion now verifies that incidental clicks
preserve selection. Existing score, geometry, scope, graph and history checks
continue to pass. `git diff --check` also passes.

These are developer checks, not a recruited first-time-user study. Earlier
verification entries below describe the UI as it existed at their dates.

---

# Navigation and viewport verification — Task 1 — 2026-11-06

Completed on `alfi`, preserving the existing Tasks 2–3 context and chart work.
Served the repository root at `http://127.0.0.1:8765/` and exercised actual Chrome
with Playwright. The layout also passed the existing tests listed below.

| Scenario | Observed result |
| --- | --- |
| Root / old entry pages | Root opens the dust field immediately with 60 dots and an Example-labelled Inception magnet. Introduction and single-movie recommendation entry pages forward to Dust & Magnet. No confirmation step. |
| Four destinations | Every view uses Dust & Magnet, History, Network, and Full Catalogue in one native disclosure. The summary names the active view. No left rail or reserved column remains. |
| Keyboard / dismissal | Arrow keys, Home/End, Tab, Enter and Escape work. Escape restores summary focus. Clicking outside or leaving the disclosure closes it. Visible focus is retained. |
| Browser history | Following the four destinations, Back, and Forward restore the correct page and label. Returning to dust restores all three magnets, the same displayed IDs, and the selected anime. |
| Contextual controls | Dot count, reset, suggestions, and main filters live under Field options. Movie chips remove magnets directly. Search stays next to the field. History has only its historical controls; Network has name search and node-type toggles. |
| Details | No empty detail column. Keyboard dot selection shows details below the field, with no forced scrolling. The selected-title cue also sits below the field, preserving its height. |
| Scope isolation | Three magnets drive 60 dots. Catalogue search persists through Network; Network neither inherits nor overwrites that search. Its collaboration graph renders from the catalogue sample even after a previous movie session. |
| Mobile | 390×844: search/options and removable magnets remain usable, no page-wide horizontal overflow, and the document scrolls normally. Switching to 90 dots and removing a magnet works. |
| Existing analysis | Similarity map, ranking, Content, Creators and Reception remain mounted below the field. Candidate balancing, scores and geometry are unchanged. |

Measured occupied area, including the field's essential scope, legend, and
encoding note, **against the entire first viewport (including the header)**:

| Viewport | Field bounds (x, y, width, height) | Visible viewport area | SVG plot size |
| --- | --- | --- | --- |
| 1440×900 | 16, 116, 1408, 772 | **83.9%** | 1386×704 |
| 1280×720 | 16, 116, 1248, 592 | **80.2%** | 1226×524 |

Measured with one and three magnets; the unselected field bounds are identical.
Separately, the visual review checked data ink: the large introductory heading,
rail, task guidance, picker card, and empty detail panel no longer displace the
plot. Only compact search/magnet controls, scope, movie-color legend, and one
encoding/interaction note remain above or within it. Marks and exact-score
interactions remain readable. Mark coverage varies with the existing magnet
geometry; a single magnet still gathers the intentionally compact cloud.

Automated results: **96 Node tests and 19 Python tests passed**. Node checks now
cover the four-destination contract, default/deployment-prefix routing, native
disclosure keyboard behavior, and contextual controls. Existing context, score,
geometry, network, historical-data, and comparison checks remain. Python route
checks cover root, legacy entry pages, Network and published resources without
upstream calls. Python checks used `/opt/anaconda3/bin/python` with the existing
backend dependencies installed.

```sh
node --test tests/*.test.cjs
python -m unittest discover -s tests -p 'test_*.py'
```

This completes Task 1 only. Network dust/catalogue scope switching, automatic
multi-title comparison, and further chart redesign remain later tasks. Earlier
verification records below describe the UI at the time they were conducted.

---

# Dust context and chart extraction verification — 2026-11-06

Tasks 2–3 were checked on `alfi` using the published datasets and a local static
server before the Task 1 navigation update described above.
Open `http://localhost:8765/frontend/dust-magnet/index.html` after serving the
repository root with `python3 -m http.server 8765`.

| Scenario | Observed result |
| --- | --- |
| Shared membership | Inception + Interstellar + The Matrix produce 60 candidates. The field, connection map's labelled displayed-set subset, and genre/year/studio/heatmap/scatter charts use the shared displayed IDs. |
| Full corpus | Ranking contains 1,000 records, independent of filtering. Per-movie and average sorts retain dust membership and selection; sorting resets its page. Removing the active movie sort falls back to average. |
| Direct chart filters | Keyboard genre selection narrows the field and other charts without refilling. Heatmap selection sets both studio and genre. A nonexistent title produces zero dusts; Reset filters restores the same candidates. |
| Counts and selection | 30/60/90 choices produce those candidate counts. Selection does not change overview scope. Reset positions retains selection; a selected title leaving the displayed set produces an accessible notice. Hover and keyboard magnet moves do not change analytical membership/revision. |
| Persistence and isolation | A catalogue visit, separate catalogue search, return to dust, and reload restore the dust movies, filters, selection and scroll. One measured restoration was exactly 4,673px before and after navigation. Main filters never inherit the catalogue search. |
| Deferred charts | Scroll through all mounted chart containers. Each renders on approach; hidden updates clear previous marks and retain the latest context. Stable chart extents prevent scroll restoration from shifting as deferred charts render. |
| Partial failure | Injected HTTP 503 for dashboard metadata leaves 60 dusts and exact similarity evidence usable, with unavailable notes below. Matrix failure yields a concise retry state without invented dusts. Denied session storage preserves in-memory use and shows a persistence notice. |
| Legacy adapters | Introduction, Content, Creators, Reception, Explorer and Movie → Anime still render. Explorer shortlist, comparison, sorting and pagination work with its extracted table. |
| Desktop and mobile | Browser checks at 1440×900, 1280×720 and 390×844 found no page-wide overflow. Heatmap and connection-map overflow stays inside named keyboard-focusable chart regions. Keyboard selection and reduced motion were exercised. Movie colors remain distinct after replacing and returning to magnets. |

Automated results: **95 Node tests and 19 Python tests passed**. Commands:

```sh
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Python checks used an isolated temporary environment with
`backend/requirements.txt` installed. The new `dust-context.test.cjs` covers the
real 997-of-1,000 metadata join, missing values, candidate/filter/selection
boundaries, stable signed-score ranking, storage failures, delayed metadata on
restore, independent resource caches, and lazy renderer lifecycle. Existing dust
geometry, recommendation, graph and historical-data checks remain intact.

This is developer verification, not a first-time-user study or completion of
Tasks 4–10. The current UI still selects one anime at a time; automatic
multi-title comparison belongs to Task 5. The shared store supports selection
arrays for that work. See `frontend/common/README.md` for the instance contracts.

---

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


## Playground side panels and selection update — 2026-11-06

The current layout supersedes the earlier above-field controls and background-click
behavior recorded above. Movie search, removable magnets and Field options occupy
the left panel. The right panel follows the latest selected dust, with its catalogue
banner/cover, movie cosine scores, genres, synopsis, tags and sampled Japanese cast.
Both panels scroll away above the analysis; the comparison below omits long text.
On mobile the controls, field and focus panel stack without document overflow.

Verified all 86 Node tests and the Chrome/Playwright browser suite. Browser checks
cover three-decimal dust tooltips, left/field/right placement, focus images, three
successive empty-field clicks removing selections in reverse order, fallback focus,
magnet/outside-click preservation, panel scroll behavior, and the existing desktop,
mobile, touch, navigation, persistence, chart scope and failure-state scenarios.
