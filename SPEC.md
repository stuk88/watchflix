# Watchflix - Self-hosted Movie Streaming App

## Overview
A desktop web app (like Popcorn Time) for watching movies online. Combines 123movies scraping + WebTorrent streaming + OMDb ratings. Runs locally.

## Architecture

### Stack
- **API**: Node.js + Express
- **DB**: SQLite (via better-sqlite3) — simple, no setup needed
- **UI**: Vue 3 + Vite (SPA)
- **Torrents**: WebTorrent for in-browser streaming
- **Scraping**: Cheerio + axios for 123movies

### Project Structure
```
watchflix/
├── api/                    # Express backend
│   ├── src/
│   │   ├── index.js        # Express server entry
│   │   ├── db.js           # SQLite setup + migrations
│   │   ├── routes/
│   │   │   ├── movies.js   # CRUD + search endpoints
│   │   │   └── sources.js  # Trigger scraping
│   │   ├── scrapers/
│   │   │   ├── 123movies.js # 123movies scraper
│   │   │   └── torrents.js  # Torrent search (1337x, YTS)
│   │   ├── services/
│   │   │   ├── omdb.js     # OMDb API client
│   │   │   └── scheduler.js # Daily scraping cron
│   │   └── config.js
│   └── package.json
├── ui/                     # Vue 3 frontend
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.js
│   │   ├── router.js
│   │   ├── stores/
│   │   │   └── movies.js   # Pinia store
│   │   ├── views/
│   │   │   ├── Home.vue     # Movie grid (Popcorn Time style)
│   │   │   ├── Movie.vue    # Movie detail + player
│   │   │   └── Favorites.vue
│   │   ├── components/
│   │   │   ├── MovieCard.vue
│   │   │   ├── MovieGrid.vue
│   │   │   ├── TorrentPlayer.vue  # WebTorrent video player
│   │   │   ├── FilterBar.vue
│   │   │   ├── SearchBar.vue
│   │   │   └── RatingBadge.vue
│   │   └── styles/
│   │       └── main.css     # Dark theme, Popcorn Time inspired
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── package.json            # Root with workspaces
└── README.md
```

## Database Schema (SQLite)

```sql
CREATE TABLE movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  year INTEGER,
  imdb_id TEXT UNIQUE,
  imdb_rating REAL,
  rt_rating TEXT,
  meta_rating INTEGER,
  poster TEXT,
  plot TEXT,
  genre TEXT,
  runtime TEXT,
  director TEXT,
  actors TEXT,
  source TEXT,           -- '123movies', 'torrent', 'both'
  source_url TEXT,       -- 123movies watch URL
  torrent_magnet TEXT,   -- magnet link for WebTorrent
  torrent_quality TEXT,  -- '720p', '1080p', '4K'
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_favorite INTEGER DEFAULT 0,
  last_watched DATETIME
);

CREATE INDEX idx_imdb_rating ON movies(imdb_rating);
CREATE INDEX idx_title ON movies(title);
CREATE INDEX idx_genre ON movies(genre);
```

## API Endpoints

- `GET /api/movies` — list movies (pagination, sort, filter by genre/rating/source)
- `GET /api/movies/:id` — single movie details
- `GET /api/movies/search?q=` — search
- `PATCH /api/movies/:id/favorite` — toggle favorite
- `POST /api/scrape/123movies` — trigger 123movies scrape
- `POST /api/scrape/torrents` — trigger torrent search
- `GET /api/stats` — counts, last scrape time

## Scraping Logic

### 123movies Scraper (api/src/scrapers/123movies.js)
- Scrape from `https://ww6.123movieshd.com/home` and pagination
- Extract: title, poster, watch URL from `a.poster[title]` and `a.title[title]` elements
- For each movie, fetch OMDb ratings
- **Only save movies with IMDb rating >= 6.0**
- Store in DB, skip duplicates (by imdb_id)

### Torrent Scraper (api/src/scrapers/torrents.js)
- Search YTS API (https://yts.mx/api/v2/list_movies.json) — has a nice REST API
- Get magnet links, quality info
- Cross-reference with OMDb for ratings
- **Only save movies with IMDb rating >= 6.0**

### Scheduler
- On API startup: run initial scrape if DB is empty
- Daily cron (node-cron): scrape new movies from all sources
- OMDb API key: `b43344b2` (env var OMDB_API_KEY)

## UI Design (Popcorn Time Style)

### Layout
- **Dark theme** — near-black background (#1a1a2e or #111)
- **Top bar**: Logo left, search center, filters right
- **Filter bar**: Genre dropdown, Sort (rating/date/name), Source filter (all/123movies/torrents), Min rating slider
- **Movie grid**: Large poster cards in responsive grid (like Popcorn Time)
  - Poster image fills card
  - On hover: overlay with title, year, rating, genre, play button
  - Rating badge (color-coded: green 7+, orange 5-7, red <5)
- **Movie detail page**: 
  - Large backdrop/poster
  - Title, year, runtime, genre, director, actors
  - Plot description
  - Rating panel (IMDb, RT, Metacritic with bars)
  - Source tabs: "Stream (123movies)" and "Torrent (WebTorrent)"
  - For 123movies: embedded iframe or link
  - For torrents: WebTorrent player (in-browser streaming)
  - Favorite button

### Colors
- Background: #111 / #1a1a2e
- Cards: #1c1c3a
- Accent: #77be41 (green, like the 123movies site)
- Text: #eee / #aaa
- Rating good: #4caf50, mid: #ff9800, bad: #f44336

## WebTorrent Player
- Use `webtorrent` npm package in browser
- Stream magnet links directly in a `<video>` element
- Show download progress, peers, speed
- Subtitles support (OpenSubtitles API) is a nice-to-have but not required

## Running
```bash
# Install
npm install

# Dev (concurrent API + UI)
npm run dev

# API only
npm run dev:api

# UI only  
npm run dev:ui
```

## Key Requirements
1. Movies with IMDb rating < 6.0 are NOT saved
2. Permanent cache — don't re-fetch ratings for known movies
3. Working WebTorrent player for torrent sources
4. 123movies source URLs stored for streaming
5. Responsive Popcorn Time-style dark UI
6. Search, filter by genre/rating/source, sort
7. Favorites system
8. Daily auto-scrape + manual trigger button
