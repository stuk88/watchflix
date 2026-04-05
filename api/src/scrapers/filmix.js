import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';
import db from '../db.js';

const BASE = config.sources.filmix;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search Filmix for a query string. Returns array of { title, year, url, poster, type }.
 */
export async function searchFilmix(query) {
  const results = [];
  try {
    const { data: html } = await axios.get(`${BASE}/search/${encodeURIComponent(query)}`, {
      timeout: 15000,
      headers: { 'User-Agent': UA },
    });

    const $ = cheerio.load(html);

    $('.poster, .article-item, .shortstory').each((_, el) => {
      const linkEl = $(el).find('a.poster-link, .article-title a, .shortstory-title a, a[href]').first();
      const title = (linkEl.attr('title') || linkEl.text() || '').trim();
      const url = linkEl.attr('href') || '';
      const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
      const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
      const fullPoster = poster.startsWith('http') ? poster : (poster ? `${BASE}${poster}` : '');

      const infoText = $(el).text();
      const yearMatch = infoText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      // Detect type from URL or tags
      const isSeries = url.includes('/serialy/') || url.includes('/series/') ||
                       $(el).find('.serial-badge, .type').text().toLowerCase().includes('сериал');
      const type = isSeries ? 'series' : 'movie';

      if (title && url) {
        results.push({ title, year, url: fullUrl, poster: fullPoster, type, source: 'filmix' });
      }
    });
  } catch (err) {
    console.error('[filmix] Search error:', err.message);
  }
  return results;
}

/**
 * Scrape Filmix homepage and category pages.
 * Saves to DB with language='ru' and source='filmix'.
 */
export async function scrapeFilmix(pages = 3) {
  console.log(`[filmix] Scraping ${pages} pages...`);
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  const categories = ['/filmy/', '/serialy/', '/mulfilmy/'];

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

        $('.poster, .article-item, .shortstory, .item').each((_, el) => {
          const linkEl = $(el).find('a.poster-link, .article-title a, .shortstory-title a, a[href]').first();
          const title = (linkEl.attr('title') || linkEl.text() || '').trim();
          const href = linkEl.attr('href') || '';
          const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;

          const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
          const fullPoster = poster.startsWith('http') ? poster : (poster ? `${BASE}${poster}` : '');

          const infoText = $(el).text();
          const yearMatch = infoText.match(/(\d{4})/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;

          const genreEl = $(el).find('.genre, .category, .item-info');
          const genre = genreEl.text().trim().split(',').slice(0, 3).join(', ');

          const type = category.includes('serialy') ? 'series' : 'movie';

          if (title && href) {
            items.push({ title, year, url: fullUrl, poster: fullPoster, genre, type });
          }
        });

        console.log(`[filmix] ${category} page ${page}: found ${items.length} titles`);

        for (const item of items) {
          const existing = db.prepare(
            'SELECT id FROM movies WHERE title = ? AND source = ? AND source_url = ?'
          ).get(item.title, 'filmix', item.url);
          if (existing) continue;

          insertStmt.run({
            title: item.title,
            year: item.year,
            poster: item.poster,
            genre: item.genre,
            source: 'filmix',
            source_url: item.url,
            language: 'ru',
            type: item.type,
          });
          saved++;
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[filmix] Error on ${category} page ${page}:`, err.message);
      }
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('filmix', saved);
  console.log(`[filmix] Done. Saved ${saved} new titles.`);
  return saved;
}
