import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';
import db from '../db.js';

const BASE = config.sources.hdrezka;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search Hdrezka for a query string. Returns array of { title, year, url, poster, type }.
 */
export async function searchHdrezka(query) {
  const results = [];
  try {
    const { data: html } = await axios.get(`${BASE}/search/`, {
      params: { do: 'search', subaction: 'search', q: query },
      timeout: 15000,
      headers: { 'User-Agent': UA },
    });

    const $ = cheerio.load(html);

    $('.b-content__inline_item').each((_, el) => {
      const linkEl = $(el).find('.b-content__inline_item-link a');
      const title = linkEl.text().trim();
      const url = linkEl.attr('href') || '';
      const poster = $(el).find('.b-content__inline_item-cover img').attr('src') || '';
      const infoText = $(el).find('.b-content__inline_item-link div').text().trim();

      // Extract year from info text like "2023, Россия, Драма"
      const yearMatch = infoText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      // Detect type from URL pattern
      const type = url.includes('/series/') || url.includes('/cartoons/') ? 'series' : 'movie';

      if (title && url) {
        results.push({ title, year, url, poster, type, source: 'hdrezka' });
      }
    });
  } catch (err) {
    console.error('[hdrezka] Search error:', err.message);
  }
  return results;
}

/**
 * Scrape the Hdrezka homepage and popular/new pages for movies.
 * Saves to DB with language='ru' and source='hdrezka'.
 */
export async function scrapeHdrezka(pages = 3) {
  console.log(`[hdrezka] Scraping ${pages} pages...`);
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  const categories = ['/films/', '/series/', '/cartoons/'];

  for (const category of categories) {
    for (let page = 1; page <= pages; page++) {
      try {
        const url = page === 1 ? `${BASE}${category}` : `${BASE}${category}page/${page}/`;
        const { data: html } = await axios.get(url, {
          timeout: 15000,
          headers: { 'User-Agent': UA },
        });

        const $ = cheerio.load(html);
        const items = [];

        $('.b-content__inline_item').each((_, el) => {
          const linkEl = $(el).find('.b-content__inline_item-link a');
          const title = linkEl.text().trim();
          const href = linkEl.attr('href') || '';
          const poster = $(el).find('.b-content__inline_item-cover img').attr('src') || '';
          const infoText = $(el).find('.b-content__inline_item-link div').text().trim();

          const yearMatch = infoText.match(/(\d{4})/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;

          // Extract genre from info like "2023, Россия, Драма"
          const parts = infoText.split(',').map(s => s.trim());
          const genre = parts.length > 2 ? parts.slice(2).join(', ') : '';

          const type = category.includes('series') ? 'series' :
                       category.includes('cartoons') ? 'movie' : 'movie';

          if (title && href) {
            items.push({ title, year, href, poster, genre, type });
          }
        });

        console.log(`[hdrezka] ${category} page ${page}: found ${items.length} titles`);

        for (const item of items) {
          const existing = db.prepare(
            'SELECT id FROM movies WHERE title = ? AND source = ? AND source_url = ?'
          ).get(item.title, 'hdrezka', item.href);
          if (existing) continue;

          insertStmt.run({
            title: item.title,
            year: item.year,
            poster: item.poster,
            genre: item.genre,
            source: 'hdrezka',
            source_url: item.href,
            language: 'ru',
            type: item.type,
          });
          saved++;
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[hdrezka] Error on ${category} page ${page}:`, err.message);
      }
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('hdrezka', saved);
  console.log(`[hdrezka] Done. Saved ${saved} new titles.`);
  return saved;
}
