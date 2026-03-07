import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import config from './config.js';
import { fetchRatings } from './services/omdb.js';
import { scrapeTorrentsYTS, scrapeTorrentsTPB, scrapeTorrentsTPBTop } from './scrapers/torrents.js';
import { fetchEpisodes } from './scrapers/123movies.js';
import { extractTmdbFrom123 } from './services/stream-extractor.js';
import db from './db.js';

// ============================================================
// Deep Scrape: Parallel genres, throttled OMDb
// Run: node api/src/scrape-deep.js
// ============================================================

const BASE = config.sources.movies123;
const PAGES_PER_GENRE = 20;
const PARALLEL_GENRES = 5;  // genres scraped in parallel
const OMDB_RPM = 15;        // OMDb requests per second (safe under 1000/day if run < 1hr)

const GENRES = [
  'action', 'adventure', 'animation', 'biography', 'comedy', 'crime',
  'documentary', 'drama', 'family', 'fantasy', 'history', 'horror',
  'music', 'mystery', 'romance', 'sci-fi', 'thriller', 'war', 'western',
];

const TPB_SEARCHES = [
  '2026 1080p', '2025 1080p', '2024 1080p', '2023 1080p',
  'marvel 1080p', 'dc 1080p', 'pixar 1080p', 'nolan 1080p',
  'tarantino 1080p', 'scorsese 1080p', 'spielberg 1080p',
  'best drama 1080p', 'best thriller 1080p', 'best horror 1080p',
  'best comedy 1080p', 'best action 1080p', 'best sci-fi 1080p',
  'oscar 1080p', 'award 1080p',
  'avengers 1080p', 'batman 1080p', 'star wars 1080p',
  'john wick 1080p', 'fast furious 1080p', 'mission impossible 1080p',
  'james bond 1080p', 'harry potter 1080p', 'lord of the rings 1080p',
  'the godfather', 'pulp fiction', 'fight club', 'inception',
  'interstellar', 'the dark knight', 'forrest gump', 'the matrix',
  'gladiator', 'the shawshank redemption', 'goodfellas',
  'no country for old men', 'there will be blood', 'the departed',
  'parasite 1080p', 'everything everywhere 1080p', 'oppenheimer 1080p',
  'dune 1080p', 'barbie 1080p', 'killers flower moon 1080p',
];

// ============================================================
// Throttled OMDb queue (single global queue, rate-limited)
// ============================================================
export class OmdbThrottler {
  constructor(rps, fetchFn = fetchRatings) {
    this.interval = 1000 / rps;
    this.queue = [];
    this.running = false;
    this.totalCalls = 0;
    this.fetchFn = fetchFn;
  }

  request(title, year) {
    return new Promise((resolve) => {
      this.queue.push({ title, year, resolve });
      this._process();
    });
  }

  async _process() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const { title, year, resolve } = this.queue.shift();
      const result = await this.fetchFn(title, year);
      this.totalCalls++;
      resolve(result);
      await new Promise(r => setTimeout(r, this.interval));
    }
    this.running = false;
  }
}

const omdb = new OmdbThrottler(OMDB_RPM);

// ============================================================
// Stats
// ============================================================
let stats = { saved: 0, skipped: 0, duplicates: 0 };

export function cleanTitle(raw) {
  return raw
    .replace(/\s*[-–—]\s*Season\s*\d+.*/i, '')
    .replace(/\s*Season\s*\d+.*/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
}

function parseSeasonNumber(rawTitle) {
  const match = rawTitle.match(/Season\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

// ============================================================
// DB statements
// ============================================================
export const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url)
  VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url)
`);

const updateTo123 = db.prepare(`
  UPDATE movies SET source = 'both', source_url = @source_url WHERE imdb_id = @imdb_id AND source = 'torrent'
`);

export const insertEpisodeStmt = db.prepare(`
  INSERT OR IGNORE INTO movies (title, year, series_imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url, type, season, episode, episode_title)
  VALUES (@title, @year, @series_imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url, @type, @season, @episode, @episode_title)
`);

// ============================================================
// 123Movies: scrape one genre (all pages)
// ============================================================
async function scrape123Genre(genre) {
  let saved = 0;

  for (let page = 1; page <= PAGES_PER_GENRE; page++) {
    try {
      const url = `${BASE}/genre/${genre}/?page=${page}`;
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });

      const $ = cheerio.load(html);
      const items = [];
      // Use .item selector to detect TV shows via <i class="type">TV</i>
      $('.item').each((_, el) => {
        const posterEl = $(el).find('a.poster[title]');
        const rawTitle = posterEl.attr('title');
        const href = posterEl.attr('href');
        if (!rawTitle || !href) return;

        const typeText = $(el).find('i.type').text().trim().toUpperCase();
        const isTv = typeText === 'TV';

        items.push({
          rawTitle,
          href: href.startsWith('http') ? href : `${BASE}${href}`,
          isTv,
        });
      });

      if (items.length === 0) break;

      // Process all items on this page concurrently (OMDb is throttled globally)
      const promises = items.map(async ({ rawTitle, href, isTv }) => {
        const title = cleanTitle(rawTitle);
        if (!title) return;

        if (isTv) {
          const season = parseSeasonNumber(rawTitle);

          const existingEp = db.prepare(
            'SELECT id FROM movies WHERE title = ? AND source_url = ? AND type = ? AND season = ?'
          ).get(title, href, 'series', season);
          if (existingEp) { stats.duplicates++; return; }

          const ratings = await omdb.request(title);
          if (!ratings || !ratings.imdb_id) { stats.skipped++; return; }
          if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) { stats.skipped++; return; }

          const episodes = await fetchEpisodes(href);
          if (episodes.length === 0) {
            const existing2 = db.prepare(
              'SELECT id FROM movies WHERE series_imdb_id = ? AND season = ? AND episode IS NULL'
            ).get(ratings.imdb_id, season);
            if (!existing2) {
              insertEpisodeStmt.run({
                ...ratings,
                series_imdb_id: ratings.imdb_id,
                imdb_id: undefined,
                source: '123movies',
                source_url: href,
                type: 'series',
                season,
                episode: null,
                episode_title: null,
              });
              saved++;
              stats.saved++;
            } else {
              stats.duplicates++;
            }
          } else {
            for (const ep of episodes) {
              const existingEpRow = db.prepare(
                'SELECT id FROM movies WHERE series_imdb_id = ? AND season = ? AND episode = ?'
              ).get(ratings.imdb_id, season, ep.episode);
              if (existingEpRow) { stats.duplicates++; continue; }

              insertEpisodeStmt.run({
                ...ratings,
                series_imdb_id: ratings.imdb_id,
                imdb_id: undefined,
                source: '123movies',
                source_url: href,
                type: 'series',
                season,
                episode: ep.episode,
                episode_title: ep.episode_title,
              });
              saved++;
              stats.saved++;
            }
          }
        } else {
          // Movie
          const existingUrl = db.prepare('SELECT id FROM movies WHERE source_url = ?').get(href);
          if (existingUrl) { stats.duplicates++; return; }

          const ratings = await omdb.request(title);
          if (!ratings || !ratings.imdb_id) { stats.skipped++; return; }
          if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) { stats.skipped++; return; }

          const existingImdb = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(ratings.imdb_id);
          if (existingImdb) {
            if (existingImdb.source === 'torrent') {
              updateTo123.run({ imdb_id: ratings.imdb_id, source_url: href });
            }
            stats.duplicates++;
            return;
          }

          insertStmt.run({ ...ratings, source: '123movies', source_url: href });
          saved++;
          stats.saved++;
        }
      });

      await Promise.all(promises);
      process.stdout.write(`  [123/${genre}] Page ${page}/${PAGES_PER_GENRE}: ${items.length} items | DB +${saved}\r`);
    } catch (err) {
      if (err.message?.includes('401')) { console.error(`\n  ⚠️ OMDb 401 — key limit hit?`); break; }
      // continue on other errors
    }
  }

  console.log(`  ✅ 123/${genre}: +${saved} movies`);
  return saved;
}

// ============================================================
// Run genres in parallel batches
// ============================================================
async function runParallel(genres, fn, label) {
  console.log(`\n${label}: ${genres.length} genres, ${PARALLEL_GENRES} parallel\n`);

  for (let i = 0; i < genres.length; i += PARALLEL_GENRES) {
    const batch = genres.slice(i, i + PARALLEL_GENRES);
    console.log(`  Batch: ${batch.join(', ')}`);
    await Promise.all(batch.map(g => fn(g)));
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  const startTime = Date.now();
  const startCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('═══════════════════════════════════════════════');
  console.log('  🎬 WATCHFLIX DEEP SCRAPE (PARALLEL)');
  console.log(`  ${GENRES.length} genres × ${PAGES_PER_GENRE} pages, ${PARALLEL_GENRES} concurrent`);
  console.log(`  OMDb throttle: ${OMDB_RPM} req/s`);
  console.log(`  Min IMDb: ${config.minImdbRating}`);
  console.log(`  DB: ${startCount} movies`);
  console.log('═══════════════════════════════════════════════');

  // Phase 1: YTS — parallel genres (YTS has its own rate, OMDb throttled)
  await runParallel(GENRES, (genre) => scrapeTorrentsYTS(PAGES_PER_GENRE, genre), '📡 PHASE 1: YTS Torrents');

  // Phase 2: TPB
  console.log('\n📡 PHASE 2: TPB Top + Search\n');
  await scrapeTorrentsTPBTop();
  await scrapeTorrentsTPB(TPB_SEARCHES);

  // Phase 3: 123movies — parallel genres
  await runParallel(GENRES, scrape123Genre, '📡 PHASE 3: 123Movies');

  // Phase 4: Pre-extract TMDB IDs for 123movies entries
  await extractEmbedPhase();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const endCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ DEEP SCRAPE COMPLETE');
  console.log(`  Time: ${elapsed} minutes`);
  console.log(`  Saved: ${stats.saved} | Skipped: ${stats.skipped} | Duplicates: ${stats.duplicates}`);
  console.log(`  OMDb calls: ${omdb.totalCalls}`);
  console.log(`  DB: ${startCount} → ${endCount} (+${endCount - startCount})`);
  console.log('═══════════════════════════════════════════════');

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('deep-scrape', endCount - startCount);
  process.exit(0);
}

// ============================================================
// Phase 4: Pre-extract TMDB IDs for 123movies entries
// ============================================================
export async function extractEmbedPhase(extractFn = extractTmdbFrom123) {
  const MAX_CONCURRENT = 2;

  // One extraction per source page (TV shows share a page across all episodes)
  const rows = db.prepare(`
    SELECT source_url, type, series_imdb_id, MIN(id) as id
    FROM movies
    WHERE (source = '123movies' OR source = 'both')
      AND tmdb_id IS NULL
      AND source_url IS NOT NULL
    GROUP BY source_url
  `).all();

  console.log(`\n📡 PHASE 4: Embed Extraction — ${rows.length} pages to process`);

  let extracted = 0;

  for (let i = 0; i < rows.length; i += MAX_CONCURRENT) {
    const batch = rows.slice(i, i + MAX_CONCURRENT);

    await Promise.all(batch.map(async (row) => {
      try {
        const tmdbId = await extractFn(row.source_url);
        if (!tmdbId) return;

        if (row.type === 'series' && row.series_imdb_id) {
          db.prepare('UPDATE movies SET tmdb_id = ? WHERE series_imdb_id = ? AND tmdb_id IS NULL')
            .run(tmdbId, row.series_imdb_id);
          const titleRow = db.prepare('SELECT title FROM movies WHERE series_imdb_id = ? LIMIT 1').get(row.series_imdb_id);
          console.log(`  ✅ Extracted TMDB for ${titleRow?.title}: ${tmdbId}`);
        } else {
          db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ?').run(tmdbId, row.id);
          const titleRow = db.prepare('SELECT title FROM movies WHERE id = ?').get(row.id);
          console.log(`  ✅ Extracted TMDB for ${titleRow?.title}: ${tmdbId}`);
        }
        extracted++;
      } catch (err) {
        console.error(`  ❌ Failed TMDB extraction for ${row.source_url}:`, err.message);
      }
    }));
  }

  console.log(`  Phase 4 complete: ${extracted} TMDB IDs extracted`);
  return extracted;
}

// Only run main when invoked directly (not imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
