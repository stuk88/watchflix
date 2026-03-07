import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Inline cleanTitle (same logic as scrape-deep.js)
function cleanTitle(raw) {
  return raw
    .replace(/\s*-?\s*Season\s*\d+/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
}

function parseSeasonNumber(rawTitle) {
  const match = rawTitle.match(/Season\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

// OmdbThrottler test (inline)
class OmdbThrottler {
  constructor(rpm, fetchFn) {
    this.queue = [];
    this.rpm = rpm;
    this.running = false;
    this.fetchFn = fetchFn;
  }
  enqueue(title) {
    return new Promise((resolve) => {
      this.queue.push({ title, resolve });
      if (!this.running) this._process();
    });
  }
  async _process() {
    this.running = true;
    while (this.queue.length) {
      const { title, resolve } = this.queue.shift();
      try { resolve(await this.fetchFn(title)); }
      catch { resolve(null); }
      await new Promise(r => setTimeout(r, Math.ceil(1000 / this.rpm)));
    }
    this.running = false;
  }
}

describe('cleanTitle', () => {
  it('strips season info', () => {
    assert.equal(cleanTitle('Monarch: Legacy of Monsters - Season 2'), 'Monarch: Legacy of Monsters');
    assert.equal(cleanTitle('Grey\'s Anatomy Season 22'), 'Grey\'s Anatomy');
  });
  it('strips year suffix', () => {
    assert.equal(cleanTitle('Trade Secret (2025)'), 'Trade Secret');
  });
  it('leaves clean titles alone', () => {
    assert.equal(cleanTitle('Inception'), 'Inception');
  });
});

describe('parseSeasonNumber', () => {
  it('extracts season number', () => {
    assert.equal(parseSeasonNumber('Monarch - Season 2'), 2);
    assert.equal(parseSeasonNumber('Show Season 10'), 10);
  });
  it('defaults to 1 when no season', () => {
    assert.equal(parseSeasonNumber('Inception'), 1);
  });
});

describe('OmdbThrottler', () => {
  it('processes queue in order with mock fetchFn', async () => {
    const calls = [];
    const throttler = new OmdbThrottler(100, async (title) => {
      calls.push(title);
      return { imdb_id: `tt${calls.length}`, imdb_rating: '7.5' };
    });

    const [r1, r2] = await Promise.all([
      throttler.enqueue('Movie A'),
      throttler.enqueue('Movie B'),
    ]);

    assert.deepEqual(calls, ['Movie A', 'Movie B']);
    assert.equal(r1.imdb_id, 'tt1');
    assert.equal(r2.imdb_id, 'tt2');
  });

  it('returns null on fetch error', async () => {
    const throttler = new OmdbThrottler(100, async () => { throw new Error('fail'); });
    const result = await throttler.enqueue('Bad Movie');
    assert.equal(result, null);
  });
});

describe('DB insert statements', () => {
  let testDb;

  it('setup in-memory DB with movies schema', () => {
    testDb = new Database(':memory:');
    testDb.exec(`
      CREATE TABLE movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, year TEXT, imdb_id TEXT UNIQUE, imdb_rating REAL,
        rt_rating TEXT, meta_rating TEXT, poster TEXT, plot TEXT,
        genre TEXT, runtime TEXT, director TEXT, actors TEXT,
        source TEXT, source_url TEXT, tmdb_id INTEGER,
        type TEXT DEFAULT 'movie', season INTEGER, episode INTEGER,
        episode_title TEXT, series_imdb_id TEXT
      )
    `);
  });

  it('inserts a movie row', () => {
    const stmt = testDb.prepare(`INSERT OR IGNORE INTO movies
      (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run('Inception', '2010', 'tt1375666', 8.8, '87%', '74', '', '', 'Sci-Fi', '148 min', 'Nolan', 'DiCaprio', '123movies', 'https://example.com/inception');
    const row = testDb.prepare('SELECT * FROM movies WHERE imdb_id = ?').get('tt1375666');
    assert.equal(row.title, 'Inception');
    assert.equal(row.type, 'movie');
    assert.equal(row.season, null);
  });

  it('inserts series episode rows with NULL imdb_id', () => {
    const stmt = testDb.prepare(`INSERT INTO movies
      (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url, type, season, episode, episode_title, series_imdb_id)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'series', ?, ?, ?, ?)`);
    stmt.run('Monarch', '2024', 7.5, '', '', '', '', 'Sci-Fi', '', '', '', '123movies', 'https://example.com/monarch', 2, 1, 'Episode 1', 'tt17220216');
    stmt.run('Monarch', '2024', 7.5, '', '', '', '', 'Sci-Fi', '', '', '', '123movies', 'https://example.com/monarch', 2, 2, 'Episode 2', 'tt17220216');

    const episodes = testDb.prepare('SELECT * FROM movies WHERE series_imdb_id = ?').all('tt17220216');
    assert.equal(episodes.length, 2);
    assert.equal(episodes[0].type, 'series');
    assert.equal(episodes[0].season, 2);
    assert.equal(episodes[0].episode, 1);
    assert.equal(episodes[1].episode, 2);
    assert.equal(episodes[0].imdb_id, null);
  });

  it('embed extraction skips rows with existing tmdb_id', () => {
    // Insert movie with tmdb_id already set
    testDb.prepare(`INSERT OR IGNORE INTO movies (title, imdb_id, source, source_url, tmdb_id) VALUES (?, ?, ?, ?, ?)`)
      .run('Has TMDB', 'tt9999999', '123movies', 'https://example.com/has-tmdb', 12345);
    // Insert movie without tmdb_id
    testDb.prepare(`INSERT OR IGNORE INTO movies (title, imdb_id, source, source_url) VALUES (?, ?, ?, ?)`)
      .run('No TMDB', 'tt8888888', '123movies', 'https://example.com/no-tmdb');

    // Query that embed extraction would use — GROUP BY source_url to dedup episodes
    const needExtraction = testDb.prepare(`
      SELECT source_url, MIN(id) as id, type, series_imdb_id
      FROM movies
      WHERE source IN ('123movies', 'both')
        AND tmdb_id IS NULL
        AND source_url IS NOT NULL
      GROUP BY source_url
    `).all();

    // Should be 3: Inception (no tmdb) + Monarch series (1 group) + No TMDB movie
    assert.equal(needExtraction.length, 3);
    const titles = needExtraction.map(r => testDb.prepare('SELECT title FROM movies WHERE id = ?').get(r.id).title);
    assert.ok(titles.includes('No TMDB'));
    assert.ok(titles.includes('Monarch'));
    assert.ok(titles.includes('Inception'));
  });

  it('updates tmdb_id for all episodes via series_imdb_id', () => {
    testDb.prepare('UPDATE movies SET tmdb_id = ? WHERE series_imdb_id = ? AND tmdb_id IS NULL')
      .run(99999, 'tt17220216');
    const episodes = testDb.prepare('SELECT tmdb_id FROM movies WHERE series_imdb_id = ?').all('tt17220216');
    assert.ok(episodes.every(e => e.tmdb_id === 99999));
  });
});
