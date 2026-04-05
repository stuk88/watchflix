import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';
import db from '../db.js';

const BASE = config.sources.seazonvar;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search Seazonvar for a query string. Returns array of { title, year, url, poster, type }.
 */
export async function searchSeazonvar(query) {
  const results = [];
  try {
    const { data: html } = await axios.post(`${BASE}/search.php`, `query=${encodeURIComponent(query)}`, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const $ = cheerio.load(html);

    $('.search-results .item, .shortstory').each((_, el) => {
      const linkEl = $(el).find('a.title, .shortstory-title a, a').first();
      const title = linkEl.text().trim();
      const url = linkEl.attr('href') || '';
      const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
      const poster = $(el).find('img').attr('src') || '';
      const fullPoster = poster.startsWith('http') ? poster : `${BASE}${poster}`;

      const infoText = $(el).find('.info, .description, .genre').text().trim();
      const yearMatch = infoText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      if (title && url) {
        results.push({ title, year, url: fullUrl, poster: fullPoster, type: 'series', source: 'seazonvar' });
      }
    });
  } catch (err) {
    console.error('[seazonvar] Search error:', err.message);
  }
  return results;
}

/**
 * Scrape Seazonvar for new series/episodes.
 * Saves to DB with language='ru' and source='seazonvar'.
 */
export async function scrapeSeazonvar(pages = 3) {
  console.log(`[seazonvar] Scraping ${pages} pages...`);
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  for (let page = 1; page <= pages; page++) {
    try {
      const url = page === 1 ? `${BASE}/` : `${BASE}/page/${page}/`;
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': UA },
      });

      const $ = cheerio.load(html);
      const items = [];

      // Seazonvar typically lists series with poster + title + info
      $('.shortstory, .item, .b-content__inline_item').each((_, el) => {
        const linkEl = $(el).find('a.title, .shortstory-title a, .b-content__inline_item-link a, a[href*="/serial/"]').first();
        if (!linkEl.length) {
          // Fallback: find first meaningful link
          const anyLink = $(el).find('a[href]').first();
          if (!anyLink.length) return;
          const href = anyLink.attr('href') || '';
          if (!href.includes(BASE.replace('https://', '').replace('http://', '')) && !href.startsWith('/')) return;
        }

        const title = (linkEl.text() || $(el).find('a').first().text()).trim();
        const href = (linkEl.attr('href') || $(el).find('a').first().attr('href') || '');
        const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;

        const poster = $(el).find('img').attr('src') || '';
        const fullPoster = poster.startsWith('http') ? poster : (poster ? `${BASE}${poster}` : '');

        const infoText = $(el).text();
        const yearMatch = infoText.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : null;

        const genreEl = $(el).find('.genre, .category, .info');
        const genre = genreEl.text().trim().split(',').slice(0, 3).join(', ');

        if (title && href) {
          items.push({ title, year, url: fullUrl, poster: fullPoster, genre, type: 'series' });
        }
      });

      console.log(`[seazonvar] Page ${page}: found ${items.length} titles`);

      for (const item of items) {
        const existing = db.prepare(
          'SELECT id FROM movies WHERE title = ? AND source = ? AND source_url = ?'
        ).get(item.title, 'seazonvar', item.url);
        if (existing) continue;

        insertStmt.run({
          title: item.title,
          year: item.year,
          poster: item.poster,
          genre: item.genre,
          source: 'seazonvar',
          source_url: item.url,
          language: 'ru',
          type: item.type,
        });
        saved++;
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[seazonvar] Error on page ${page}:`, err.message);
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('seazonvar', saved);
  console.log(`[seazonvar] Done. Saved ${saved} new titles.`);
  return saved;
}
