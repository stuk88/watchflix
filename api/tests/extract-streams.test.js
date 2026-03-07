import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  SERVERS,
  CACHE_TTL_MS,
  getMoviesToExtract,
  getCachedStream,
  isCacheValid,
  saveCacheHit,
  saveCacheError,
  extractAllStreams,
} from '../src/extract-streams.js';

// ============================================================
// Helpers: set up an in-memory DB with required schema
// ============================================================

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER,
      imdb_id TEXT UNIQUE,
      source TEXT,
      source_url TEXT,
      tmdb_id TEXT,
      type TEXT DEFAULT 'movie',
      season INTEGER,
      episode INTEGER,
      series_imdb_id TEXT
    );

    CREATE TABLE stream_cache (
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
  return db;
}

function seedMovies(db) {
  db.prepare(`INSERT INTO movies (title, source, tmdb_id, type) VALUES (?, '123movies', 11111, 'movie')`).run('Movie A');
  db.prepare(`INSERT INTO movies (title, source, tmdb_id, type) VALUES (?, 'both', 22222, 'movie')`).run('Movie B');
  // TV series episode — should NOT be included
  db.prepare(`INSERT INTO movies (title, source, tmdb_id, type, season, episode, series_imdb_id) VALUES (?, '123movies', 33333, 'series', 1, 1, 'tt1234567')`).run('Show C');
  // Movie without tmdb_id — should NOT be included
  db.prepare(`INSERT INTO movies (title, source, type) VALUES (?, '123movies', 'movie')`).run('No TMDB Movie');
  // Torrent-only source — should NOT be included
  db.prepare(`INSERT INTO movies (title, source, tmdb_id, type) VALUES (?, 'torrent', 44444, 'movie')`).run('Torrent Only');
}

// ============================================================
// Tests
// ============================================================

describe('stream_cache table schema', () => {
  let db;
  before(() => { db = makeDb(); });

  it('creates stream_cache table', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stream_cache'").get();
    assert.ok(row, 'stream_cache table must exist');
  });

  it('inserts and retrieves a cache row', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO stream_cache (movie_id, server, m3u8_url, subtitle_url, tmdb_id, extracted_at, expires_at, error)
      VALUES (1, 2, 'https://cdn.example.com/stream.m3u8', 'https://cdn.example.com/sub.vtt', 11111, ?, ?, NULL)
    `).run(now, now + CACHE_TTL_MS);

    const cached = db.prepare('SELECT * FROM stream_cache WHERE movie_id = 1 AND server = 2').get();
    assert.equal(cached.m3u8_url, 'https://cdn.example.com/stream.m3u8');
    assert.equal(cached.subtitle_url, 'https://cdn.example.com/sub.vtt');
    assert.equal(cached.tmdb_id, 11111);
    assert.equal(cached.error, null);
    assert.ok(cached.expires_at > now);
  });

  it('PRIMARY KEY (movie_id, server) enforces uniqueness via INSERT OR REPLACE', () => {
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO stream_cache (movie_id, server, m3u8_url, subtitle_url, tmdb_id, extracted_at, expires_at, error)
      VALUES (1, 2, 'https://cdn.example.com/new.m3u8', NULL, 11111, ?, ?, NULL)
    `).run(now, now + CACHE_TTL_MS);

    const rows = db.prepare('SELECT * FROM stream_cache WHERE movie_id = 1 AND server = 2').all();
    assert.equal(rows.length, 1, 'should have only one row per (movie_id, server)');
    assert.equal(rows[0].m3u8_url, 'https://cdn.example.com/new.m3u8');
  });
});

describe('getCachedStream', () => {
  let db;
  before(() => {
    db = makeDb();
    const now = Date.now();
    db.prepare(`
      INSERT INTO stream_cache (movie_id, server, m3u8_url, subtitle_url, tmdb_id, extracted_at, expires_at, error)
      VALUES (10, 1, 'https://cdn.example.com/m.m3u8', NULL, 99, ?, ?, NULL)
    `).run(now, now + CACHE_TTL_MS);
  });

  it('returns row when cache entry exists', () => {
    const row = getCachedStream(10, 1, db);
    assert.ok(row);
    assert.equal(row.m3u8_url, 'https://cdn.example.com/m.m3u8');
  });

  it('returns null when no entry exists', () => {
    const row = getCachedStream(10, 2, db);
    assert.equal(row, null);
  });
});

describe('isCacheValid', () => {
  const futureRow = { expires_at: Date.now() + 10000, error: null };
  const expiredRow = { expires_at: Date.now() - 1, error: null };
  const errorRow = { expires_at: Date.now() + 10000, error: 'something failed' };

  it('returns true for a valid non-expired row', () => {
    assert.equal(isCacheValid(futureRow), true);
  });

  it('returns false for an expired row', () => {
    assert.equal(isCacheValid(expiredRow), false);
  });

  it('returns false for a row with an error', () => {
    assert.equal(isCacheValid(errorRow), false);
  });

  it('returns false for null', () => {
    assert.equal(isCacheValid(null), false);
  });
});

describe('saveCacheHit', () => {
  let db;
  before(() => { db = makeDb(); });

  it('inserts a successful stream cache entry', () => {
    const now = Date.now();
    saveCacheHit(42, 2, { m3u8: 'https://cdn.example.com/test.m3u8', subtitles: 'https://cdn.example.com/subs.vtt', tmdbId: 77777 }, db, now);
    const row = db.prepare('SELECT * FROM stream_cache WHERE movie_id = 42 AND server = 2').get();
    assert.ok(row);
    assert.equal(row.m3u8_url, 'https://cdn.example.com/test.m3u8');
    assert.equal(row.subtitle_url, 'https://cdn.example.com/subs.vtt');
    assert.equal(row.tmdb_id, 77777);
    assert.equal(row.error, null);
    assert.equal(row.extracted_at, now);
    assert.equal(row.expires_at, now + CACHE_TTL_MS);
  });

  it('replaces existing row on second call', () => {
    const now = Date.now() + 1000;
    saveCacheHit(42, 2, { m3u8: 'https://cdn.example.com/updated.m3u8', subtitles: null, tmdbId: 77777 }, db, now);
    const rows = db.prepare('SELECT * FROM stream_cache WHERE movie_id = 42 AND server = 2').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].m3u8_url, 'https://cdn.example.com/updated.m3u8');
  });
});

describe('saveCacheError', () => {
  let db;
  before(() => { db = makeDb(); });

  it('inserts an error row with null m3u8', () => {
    const now = Date.now();
    saveCacheError(99, 5, 'Connection timed out', db, now);
    const row = db.prepare('SELECT * FROM stream_cache WHERE movie_id = 99 AND server = 5').get();
    assert.ok(row);
    assert.equal(row.error, 'Connection timed out');
    assert.equal(row.m3u8_url, null);
    assert.equal(row.expires_at, now + CACHE_TTL_MS);
  });
});

describe('getMoviesToExtract', () => {
  let db;
  before(() => {
    db = makeDb();
    seedMovies(db);
  });

  it('returns only 123movies/both movies with tmdb_id and type=movie', () => {
    const movies = getMoviesToExtract(db);
    assert.equal(movies.length, 2);
    const titles = movies.map(m => m.title);
    assert.ok(titles.includes('Movie A'));
    assert.ok(titles.includes('Movie B'));
  });

  it('excludes series episodes', () => {
    const movies = getMoviesToExtract(db);
    assert.ok(!movies.find(m => m.title === 'Show C'));
  });

  it('excludes movies without tmdb_id', () => {
    const movies = getMoviesToExtract(db);
    assert.ok(!movies.find(m => m.title === 'No TMDB Movie'));
  });

  it('excludes torrent-only movies', () => {
    const movies = getMoviesToExtract(db);
    assert.ok(!movies.find(m => m.title === 'Torrent Only'));
  });
});

describe('extractAllStreams', () => {
  let db;

  before(() => {
    db = makeDb();
    seedMovies(db);
  });

  it('calls extractFn for each movie × server combination', async () => {
    const calls = [];
    const mockExtract = async (movieId, server) => {
      calls.push({ movieId, server });
      return { m3u8: `https://cdn.example.com/${movieId}-${server}.m3u8`, subtitles: null, tmdbId: 11111 };
    };

    await extractAllStreams({ extractFn: mockExtract, maxConcurrent: 3, database: db });

    // 2 movies × 3 servers = 6 calls
    assert.equal(calls.length, 6);
    const servers = [...new Set(calls.map(c => c.server))].sort();
    assert.deepEqual(servers, SERVERS);
  });

  it('saves successful results to stream_cache', () => {
    const rows = db.prepare('SELECT * FROM stream_cache WHERE error IS NULL').all();
    assert.equal(rows.length, 6);
  });

  it('skips already-cached entries on second run', async () => {
    const calls = [];
    const mockExtract = async (movieId, server) => {
      calls.push({ movieId, server });
      return { m3u8: 'https://cdn.example.com/x.m3u8', subtitles: null, tmdbId: 11111 };
    };

    const result = await extractAllStreams({ extractFn: mockExtract, maxConcurrent: 2, database: db });
    assert.equal(calls.length, 0, 'should not call extractor when all entries are cached');
    assert.equal(result.total, 0);
  });

  it('saves error rows and reports failed count', async () => {
    const db2 = makeDb();
    seedMovies(db2);

    const mockExtract = async () => { throw new Error('timeout'); };
    const result = await extractAllStreams({ extractFn: mockExtract, maxConcurrent: 2, database: db2 });

    assert.equal(result.failed, 6);
    assert.equal(result.succeeded, 0);

    const errorRows = db2.prepare('SELECT * FROM stream_cache WHERE error IS NOT NULL').all();
    assert.equal(errorRows.length, 6);
    assert.equal(errorRows[0].error, 'timeout');
  });

  it('skips error-cached entries on subsequent run (no immediate retry)', async () => {
    const db3 = makeDb();
    seedMovies(db3);

    // First run: all fail
    await extractAllStreams({ extractFn: async () => { throw new Error('fail'); }, maxConcurrent: 2, database: db3 });

    // Second run: should skip them (error entries are cached)
    const calls = [];
    const result = await extractAllStreams({
      extractFn: async (id, srv) => { calls.push({ id, srv }); return { m3u8: 'x', subtitles: null, tmdbId: 1 }; },
      maxConcurrent: 2,
      database: db3,
    });

    assert.equal(calls.length, 0, 'error entries should be treated as cached (no retry within TTL)');
    assert.equal(result.total, 0);
  });
});
