import { openDatabase } from './db/index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = process.env.CAPACITOR_NODEJS_DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(dbDir, { recursive: true });

const db = await openDatabase(join(dbDir, 'watchflix.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
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
    source TEXT,
    source_url TEXT,
    torrent_magnet TEXT,
    torrent_quality TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_favorite INTEGER DEFAULT 0,
    last_watched DATETIME,
    tmdb_id TEXT,
    is_hidden INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_imdb_rating ON movies(imdb_rating);
  CREATE INDEX IF NOT EXISTS idx_title ON movies(title);
  CREATE INDEX IF NOT EXISTS idx_genre ON movies(genre);
  CREATE INDEX IF NOT EXISTS idx_imdb_id ON movies(imdb_id);

  CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stream_cache (
    movie_id INTEGER NOT NULL,
    server INTEGER NOT NULL,
    m3u8_url TEXT,
    subtitle_url TEXT,
    tmdb_id INTEGER,
    extracted_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    error TEXT,
    PRIMARY KEY (movie_id, server)
  );
`);

// Persistent user preferences keyed by imdb_id (survives movie deletion/re-scrape)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    imdb_id TEXT PRIMARY KEY,
    is_favorite INTEGER DEFAULT 0,
    is_hidden INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Backfill existing favorites/hidden into user_preferences
db.exec(`
  INSERT OR IGNORE INTO user_preferences (imdb_id, is_favorite, is_hidden)
  SELECT imdb_id, is_favorite, is_hidden FROM movies
  WHERE imdb_id IS NOT NULL AND (is_favorite = 1 OR is_hidden = 1);
`);

// Trigger: auto-apply saved preferences when a movie is inserted
db.exec(`
  CREATE TRIGGER IF NOT EXISTS apply_user_prefs AFTER INSERT ON movies
  WHEN NEW.imdb_id IS NOT NULL
  BEGIN
    UPDATE movies SET
      is_favorite = COALESCE((SELECT is_favorite FROM user_preferences WHERE imdb_id = NEW.imdb_id), 0),
      is_hidden = COALESCE((SELECT is_hidden FROM user_preferences WHERE imdb_id = NEW.imdb_id), 0)
    WHERE id = NEW.id;
  END;
`);

// Migration: add series/episode columns (needed for Russian sources)
try { db.exec(`ALTER TABLE movies ADD COLUMN type TEXT DEFAULT 'movie'`); } catch (e) {}
try { db.exec(`ALTER TABLE movies ADD COLUMN series_imdb_id TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE movies ADD COLUMN season INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE movies ADD COLUMN episode INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE movies ADD COLUMN episode_title TEXT`); } catch (e) {}

db.exec(`CREATE INDEX IF NOT EXISTS idx_series_imdb_id ON movies(series_imdb_id)`);

// Migration: add language column
try {
  db.exec(`ALTER TABLE movies ADD COLUMN language TEXT DEFAULT 'en'`);
} catch (e) {}

db.exec(`CREATE INDEX IF NOT EXISTS idx_language ON movies(language)`);

// Migration: add title_en column for original/English title
try {
  db.exec(`ALTER TABLE movies ADD COLUMN title_en TEXT`);
} catch (e) {
  // Column already exists
}

// Migration: add offline_path column for saved-to-disk movies
try {
  db.exec(`ALTER TABLE movies ADD COLUMN offline_path TEXT`);
} catch (e) {}

// Migration: add cached stream URL columns
try {
  db.exec(`ALTER TABLE movies ADD COLUMN cached_stream_url TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE movies ADD COLUMN stream_cached_at INTEGER`);
} catch (e) {}

// Migration: add country column
try {
  db.exec(`ALTER TABLE movies ADD COLUMN country TEXT`);
} catch (e) {}

// Blacklist for torrents confirmed to have no real seeds
db.exec(`
  CREATE TABLE IF NOT EXISTS dead_torrents (
    infohash TEXT PRIMARY KEY,
    name TEXT,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    fail_count INTEGER DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_dead_reported ON dead_torrents(reported_at);
`);

// Critic review scores (LLM-analyzed from professional reviews)
db.exec(`
  CREATE TABLE IF NOT EXISTS critic_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    story REAL,
    acting REAL,
    direction REAL,
    cinematography REAL,
    production_design REAL,
    editing REAL,
    sound REAL,
    emotional_impact REAL,
    summary TEXT,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(movie_id, source)
  );
  CREATE INDEX IF NOT EXISTS idx_critic_movie ON critic_scores(movie_id);
`);

export default db;
