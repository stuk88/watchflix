import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';
import { fetchRatings } from '../services/omdb.js';
import db from '../db.js';

const BASE = config.sources.movies123;

function cleanTitle(raw) {
  return raw
    .replace(/\s*[-–—]\s*Season\s*\d+.*/i, '')
    .replace(/\s*Season\s*\d+.*/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
}

export async function scrape123Movies(pages = 3) {
  console.log(`[123movies] Scraping ${pages} pages...`);
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url)
    VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url)
  `);

  // Update source if movie exists from torrent
  const updateStmt = db.prepare(`
    UPDATE movies SET source = 'both', source_url = @source_url WHERE imdb_id = @imdb_id AND source = 'torrent'
  `);

  for (let page = 1; page <= pages; page++) {
    try {
      const url = page === 1 ? `${BASE}/home` : `${BASE}/home?page=${page}`;
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });

      const $ = cheerio.load(html);
      const titles = [];

      $('a.poster[title]').each((_, el) => {
        const rawTitle = $(el).attr('title');
        const href = $(el).attr('href');
        if (rawTitle && href) {
          titles.push({ rawTitle, href: href.startsWith('http') ? href : `${BASE}${href}` });
        }
      });

      console.log(`[123movies] Page ${page}: found ${titles.length} titles`);

      for (const { rawTitle, href } of titles) {
        const title = cleanTitle(rawTitle);
        if (!title) continue;

        // Check if already in DB
        const existing = db.prepare('SELECT id FROM movies WHERE title = ? AND source_url = ?').get(title, href);
        if (existing) continue;

        const ratings = await fetchRatings(title);
        if (!ratings) continue;
        if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) continue;

        const existing2 = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(ratings.imdb_id);
        if (existing2) {
          if (existing2.source === 'torrent') {
            updateStmt.run({ imdb_id: ratings.imdb_id, source_url: href });
          }
          continue;
        }

        insertStmt.run({
          ...ratings,
          source: '123movies',
          source_url: href,
        });
        saved++;

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[123movies] Error on page ${page}:`, err.message);
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('123movies', saved);
  console.log(`[123movies] Done. Saved ${saved} new movies.`);
  return saved;
}
