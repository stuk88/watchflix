import axios from 'axios';
import * as cheerio from 'cheerio';
import config from './config.js';
import { fetchRatings } from './services/omdb.js';
import { scrapeTorrentsYTS, scrapeTorrentsTPB, scrapeTorrentsTPBTop } from './scrapers/torrents.js';
import db from './db.js';

// ============================================================
// Deep Scrape: 20 pages per genre from 123movies + YTS + TPB
// Run: node api/src/scrape-deep.js
// ============================================================

const BASE = config.sources.movies123;
const PAGES_PER_GENRE = 20;
const DELAY = 250;

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

// Popular movie searches for TPB
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

const updateTo123 = db.prepare(`
  UPDATE movies SET source = 'both', source_url = @source_url WHERE imdb_id = @imdb_id AND source = 'torrent'
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
// Main
// ============================================================
async function main() {
  const startTime = Date.now();
  const startCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('═══════════════════════════════════════════════');
  console.log('  🎬 WATCHFLIX DEEP SCRAPE');
  console.log(`  Sources: YTS (${GENRES_YTS.length} genres × ${PAGES_PER_GENRE}p) + TPB (${TPB_SEARCHES.length} searches + top lists) + 123movies (${GENRES_123.length} genres × ${PAGES_PER_GENRE}p)`);
  console.log(`  Min IMDb rating: ${config.minImdbRating}`);
  console.log(`  DB currently has: ${startCount} movies`);
  console.log('═══════════════════════════════════════════════');

  // Phase 1: YTS Torrents (per genre)
  console.log('\n\n📡 PHASE 1: YTS Torrents (by genre)\n');
  let ytsSaved = 0;
  for (const genre of GENRES_YTS) {
    ytsSaved += await scrapeTorrentsYTS(PAGES_PER_GENRE, genre);
  }

  // Phase 2: TPB Top Lists
  console.log('\n\n📡 PHASE 2: TPB Top Movies\n');
  const tpbTopSaved = await scrapeTorrentsTPBTop();

  // Phase 3: TPB Search
  console.log('\n\n📡 PHASE 3: TPB Search Queries\n');
  const tpbSearchSaved = await scrapeTorrentsTPB(TPB_SEARCHES);

  // Phase 4: 123movies
  console.log('\n\n📡 PHASE 4: 123Movies (by genre)\n');
  for (const genre of GENRES_123) {
    await scrape123Genre(genre, PAGES_PER_GENRE);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const endCount = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;

  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  ✅ DEEP SCRAPE COMPLETE');
  console.log(`  Time: ${elapsed} minutes`);
  console.log(`  YTS: ${ytsSaved} | TPB Top: ${tpbTopSaved} | TPB Search: ${tpbSearchSaved} | 123movies: ${totalSaved}`);
  console.log(`  Skipped (low rating / not found): ${totalSkipped}`);
  console.log(`  Duplicates: ${totalDuplicates}`);
  console.log(`  DB total: ${startCount} → ${endCount} (+${endCount - startCount})`);
  console.log('═══════════════════════════════════════════════');

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('deep-scrape', endCount - startCount);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
