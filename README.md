# Anime Industry Atlas

An interactive data-visualization project exploring anime titles, genres,
studios, audience scores, popularity, release history, and Japanese
voice-actor collaboration networks.

## Project summary

Anime Industry Atlas is a coordinated multiple-view visualization system.

The Python/Flask backend:

- Requests data from the AniList GraphQL API.
- Retrieves a popularity-sorted sample of non-adult anime.
- Cleans and normalizes the API response.
- Creates studio, genre, timeline, and network summaries.
- Constructs a weighted voice-actor co-starring network.
- Caches processed results to reduce API traffic.
- Retries temporary API failures.
- Handles rate-limit responses.
- Falls back to stale cache data when AniList is unavailable.
- Serves the frontend and API from the same origin.

The D3.js frontend provides:

- Global coordinated filters.
- Summary KPI cards.
- Automatically generated observations.
- Score-versus-popularity bubble scatterplot.
- Genre ranking chart with multiple metrics.
- Historical release-year timeline.
- Studio performance chart.
- Studio–genre specialization heatmap.
- Zoomable and draggable voice-actor network.
- Sortable anime explorer.
- Details-on-demand side panel.
- Responsive layout and accessible labels.

## Analytical questions

The system investigates ten questions:

1. Which anime combine high ratings with large popularity?
2. Are the most popular anime also the highest rated?
3. Which genres appear most frequently in the sample?
4. Which recurring genres receive the strongest average ratings?
5. How have sampled title counts and scores changed over release years?
6. Which studios combine audience reach with strong ratings?
7. Which studios appear to specialize in specific genres?
8. Which Japanese voice actors appear in the most sampled anime?
9. Which voice actors repeatedly co-star?
10. How do format, year, genre, studio, score, and text filters change the story?

## Visual encodings

### Score-versus-popularity scatterplot

- X position: AniList popularity on a logarithmic scale.
- Y position: average AniList score.
- Bubble area: number of favourites.
- Color: primary genre.
- Dashed line: linear trend using log-transformed popularity.

### Genre chart

- Y position: genre.
- Bar length: selected metric.
- Color: genre identity.
- Interaction: clicking a bar applies a global genre filter.

### Timeline

- X position: release year.
- Bar height: number of sampled titles.
- Line position: average score for the year.

### Studio performance chart

- Y position: studio.
- X position: average score.
- Circle size: number of sampled titles.
- Circle color: dominant genre.
- Studio order: total popularity.
- Interaction: clicking a studio applies a global studio filter.

### Studio–genre heatmap

- Rows: studios.
- Columns: genres.
- Cell color intensity: number of matching titles.
- Interaction: clicking a cell filters by both studio and genre.

### Voice-actor network

- Node: Japanese voice actor.
- Node size: number of filtered anime appearances.
- Node color: dominant genre among represented titles.
- Link: two actors performing main roles in the same anime.
- Link width: number of shared anime.
- Interactions: zoom, pan, drag, search, link threshold, and actor selection.

## Important methodological limitation

The project retrieves anime using AniList's `POPULARITY_DESC` ordering.

Therefore, the dataset is a sample of highly visible anime and is not:

- A random sample.
- A complete census of anime.
- A representative sample of obscure or historical productions.
- Sufficient by itself for causal claims about the entire anime industry.

This limitation is intentionally displayed in the dashboard. Clearly stating
sampling assumptions is important for responsible data visualization.

## Installation

### 1. Install Python

Use Python 3.10 or newer.

Check your installation:

```bash
python --version