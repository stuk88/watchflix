import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '..', 'data');
mkdirSync(dbDir, { recursive: true });

const db = new Database(join(dbDir, 'watchflix.db'));
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

// Migration: add language column
try {
  db.exec(`ALTER TABLE movies ADD COLUMN language TEXT DEFAULT 'en'`);
} catch (e) {
  // Column already exists
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_language ON movies(language)`);

// Migration: add title_en column for original/English title
try {
  db.exec(`ALTER TABLE movies ADD COLUMN title_en TEXT`);
} catch (e) {
  // Column already exists
}

// Migration: add cached stream URL columns
try {
  db.exec(`ALTER TABLE movies ADD COLUMN cached_stream_url TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE movies ADD COLUMN stream_cached_at INTEGER`);
} catch (e) {}

export default db;
