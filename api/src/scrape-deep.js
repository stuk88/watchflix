import axios from 'axios';
import * as cheerio from 'cheerio';
import config from './config.js';
import { fetchRatings } from './services/omdb.js';
import db from './db.js';

// ============================================================
// Deep Scrape: 20 pages per genre from 123movies + YTS torrents
// Run: node api/src/scrape-deep.js
// ============================================================

const BASE = config.sources.movies123;
const YTS_API = config.sources.ytsApi;
const PAGES_PER_GENRE = 20;
const DELAY = 250; // ms between OMDb calls

const GENRES_123 = [
  'action', 'adventure', 'animation', 'biography', 'comedy', 'crime',
  'documentary', 'drama', 'family', 'fantasy', 'history', 'horror',
  'music', 'mystery', 'romance', 'sci-fi', 'thriller', 'war', 'western',
];

const GENRES_YTS = [
  'action', 'adventure', 'animation', 'biography', 'comedy', 'crime',
  'documentary', 'drama', 'family', 'fantasy', 'history', 'horror',
  'music', 'mystery', 'romance', 'sci-fi', 'thriller', 'war', 'western',
];

function cleanTitle(raw) {
  return raw
    .replace(/\s*[-–—]\s*Season\s*\d+.*/i, '')
    .replace(/\s*Season\s*\d+.*/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url)
  VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url)
`);

const insertTorrentStmt = db.prepare(`
  INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, torrent_magnet, torrent_quality)
  VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @torrent_magnet, @torrent_quality)
`);

const updateTo123 = db.prepare(`
  UPDATE movies SET source = 'both', source_url = @source_url WHERE imdb_id = @imdb_id AND source = 'torrent'
`);

const updateToTorrent = db.prepare(`
  UPDATE movies SET source = 'both', torrent_magnet = @torrent_magnet, torrent_quality = @torrent_quality
  WHERE imdb_id = @imdb_id AND source = '123movies'
`);

let totalSaved = 0;
let totalSkipped = 0;
let totalDuplicates = 0;

// ============================================================
// 123Movies genre scraper
// ============================================================
async function scrape123Genre(genre, pages) {
  let saved = 0;
  console.log(`\n[123movies] 🎬 Genre: ${genre} (${pages} pages)`);

  for (let page = 1; page <= pages; page++) {
    try {
      const url = `${BASE}/genre/${genre}/?page=${page}`;
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });

      const $ = cheerio.load(html);
      const items = [];
      $('a.poster[title]').each((_, el) => {
        const rawTitle = $(el).attr('title');
        const href = $(el).attr('href');
        if (rawTitle && href) {
          items.push({ rawTitle, href: href.startsWith('http') ? href : `${BASE}${href}` });
        }
      });

      if (items.length === 0) {
        console.log(`  Page ${page}: empty, stopping genre`);
        break;
      }

      let pageSaved = 0;
      for (const { rawTitle, href } of items) {
        const title = cleanTitle(rawTitle);
        if (!title) continue;

        // Quick duplicate check by URL
        const existingUrl = db.prepare('SELECT id FROM movies WHERE source_url = ?').get(href);
        if (existingUrl) { totalDuplicates++; continue; }

        const ratings = await fetchRatings(title);
        if (!ratings || !ratings.imdb_id) { totalSkipped++; continue; }
        if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) { totalSkipped++; continue; }

        const existingImdb = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(ratings.imdb_id);
        if (existingImdb) {
          if (existingImdb.source === 'torrent') {
            updateTo123.run({ imdb_id: ratings.imdb_id, source_url: href });
          }
          totalDuplicates++;
          continue;
        }

        insertStmt.run({ ...ratings, source: '123movies', source_url: href });
        saved++;
        pageSaved++;

        await new Promise(r => setTimeout(r, DELAY));
      }

      process.stdout.write(`  Page ${page}/${pages}: ${items.length} found, ${pageSaved} saved\r`);
    } catch (err) {
      console.error(`  Page ${page} error: ${err.message}`);
    }
  }

  console.log(`  ✅ ${genre}: saved ${saved} movies`);
  totalSaved += saved;
  return saved;
}

// ============================================================
// YTS torrent genre scraper
// ============================================================
async function scrapeYtsGenre(genre, pages) {
  let saved = 0;
  console.log(`\n[torrents] 🧲 Genre: ${genre} (${pages} pages)`);

  for (let page = 1; page <= pages; page++) {
    try {
      const { data } = await axios.get(`${YTS_API}/list_movies.json`, {
        params: {
          page,
          limit: 50,
          genre,
          sort_by: 'rating',
          order_by: 'desc',
          minimum_rating: config.minImdbRating,
        },
        timeout: 15000,
      });

      const movies = data?.data?.movies;
      if (!movies || !movies.length) {
        console.log(`  Page ${page}: empty, stopping genre`);
        break;
      }

      let pageSaved = 0;
      for (const movie of movies) {
        if (!movie.imdb_code) continue;

        const torrents = movie.torrents || [];
        const best = torrents.find(t => t.quality === '1080p')
          || torrents.find(t => t.quality === '720p')
          || torrents[0];
        if (!best) continue;

        const magnet = `magnet:?xt=urn:btih:${best.hash}&dn=${encodeURIComponent(movie.title)}&tr=udp://tracker.opentrackr.org:1337&tr=udp://tracker.openbittorrent.com:80&tr=udp://open.stealth.si:80&tr=udp://tracker.torrent.eu.org:451`;

        const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(movie.imdb_code);
        if (existing) {
          if (existing.source === '123movies') {
            updateToTorrent.run({ imdb_id: movie.imdb_code, torrent_magnet: magnet, torrent_quality: best.quality });
          }
          totalDuplicates++;
          continue;
        }

        // Fetch OMDb for full metadata
        const ratings = await fetchRatings(movie.title, movie.year);

        if (ratings && ratings.imdb_id) {
          if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) { totalSkipped++; continue; }
          insertTorrentStmt.run({
            ...ratings,
            poster: ratings.poster || movie.large_cover_image,
            source: 'torrent',
            torrent_magnet: magnet,
            torrent_quality: best.quality,
          });
        } else {
          if (movie.rating < config.minImdbRating) { totalSkipped++; continue; }
          insertTorrentStmt.run({
            title: movie.title,
            year: movie.year,
            imdb_id: movie.imdb_code,
            imdb_rating: movie.rating,
            rt_rating: null,
            meta_rating: null,
            poster: movie.large_cover_image || movie.medium_cover_image,
            plot: movie.synopsis || movie.description_full || null,
            genre: (movie.genres || []).join(', '),
            runtime: movie.runtime ? `${movie.runtime} min` : null,
            director: null,
            actors: null,
            source: 'torrent',
            torrent_magnet: magnet,
            torrent_quality: best.quality,
          });
        }

        saved++;
        pageSaved++;
        await new Promise(r => setTimeout(r, DELAY));
      }

      process.stdout.write(`  Page ${page}/${pages}: ${movies.length} found, ${pageSaved} saved\r`);
    } catch (err) {
      console.error(`  Page ${page} error: ${err.message}`);
    }
  }

  console.log(`  ✅ ${genre}: saved ${saved} movies`);
  totalSaved += saved;
  return saved;
}

// ============================================================
// Main
// ============================================================
async function main() {
  const startTime = Date.now();
  const startCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('═══════════════════════════════════════════════');
  console.log('  🎬 WATCHFLIX DEEP SCRAPE');
  console.log(`  ${GENRES_YTS.length} genres × ${PAGES_PER_GENRE} pages each`);
  console.log(`  Sources: 123movies + YTS torrents`);
  console.log(`  Min IMDb rating: ${config.minImdbRating}`);
  console.log(`  DB currently has: ${startCount} movies`);
  console.log('═══════════════════════════════════════════════');

  // Phase 1: YTS Torrents (has better API, faster)
  console.log('\n\n📡 PHASE 1: YTS Torrents\n');
  for (const genre of GENRES_YTS) {
    await scrapeYtsGenre(genre, PAGES_PER_GENRE);
  }

  // Phase 2: 123movies
  console.log('\n\n📡 PHASE 2: 123Movies\n');
  for (const genre of GENRES_123) {
    await scrape123Genre(genre, PAGES_PER_GENRE);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const endCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  ✅ DEEP SCRAPE COMPLETE');
  console.log(`  Time: ${elapsed} minutes`);
  console.log(`  New movies saved: ${totalSaved}`);
  console.log(`  Skipped (low rating / not found): ${totalSkipped}`);
  console.log(`  Duplicates: ${totalDuplicates}`);
  console.log(`  DB total: ${startCount} → ${endCount}`);
  console.log('═══════════════════════════════════════════════');

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('deep-scrape', totalSaved);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
