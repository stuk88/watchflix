import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import config from '../config.js';
import db from '../db.js';

const BASE = config.sources.filmix;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Filmix uses windows-1251 encoding — fetch as buffer and decode
async function fetchFilmixPage(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': UA },
    responseType: 'arraybuffer',
  });
  return iconv.decode(Buffer.from(data), 'win1251');
}

/**
 * Search Filmix for a query string. Returns array of { title, year, url, poster, type }.
 */
export async function searchFilmix(query) {
  const results = [];
  try {
    const html = await fetchFilmixPage(`${BASE}/search/${encodeURIComponent(query)}`);

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

// Filmix's PlayerJS handles seasons/episodes within its own UI.
// No per-episode scraping needed — single entry per title suffices.

/**
 * Scrape Filmix pages. Movies and series stored as single entries.
 */
export async function scrapeFilmix(pages = 3) {
  console.log(`[filmix] Scraping ${pages} pages...`);
  let saved = 0;

  const insertMovieStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  // Filmix uses different URL patterns for listing vs pagination
  const categories = [
    { list: '/filmy/', paged: '/film/pages/', isSeries: false },
    { list: '/serialy/', paged: '/seria/pages/', isSeries: true },
  ];

  for (const { list, paged, isSeries } of categories) {
    for (let page = 1; page <= pages; page++) {
      try {
        const url = page === 1 ? `${BASE}${list}` : `${BASE}${paged}${page}/`;
        const html = await fetchFilmixPage(url);

        const $ = cheerio.load(html);
        const items = [];

        $('.shortstory, .poster-tooltip, .film-poster').each((_, el) => {
          // Find the movie page link (class "watch" or link with numeric ID in path)
          let linkEl = $(el).find('a.watch, a[href*="/film/"][href*="-v-"], a[href*="/seria/"][href*="-v-"]').first();
          if (!linkEl.length) {
            linkEl = $(el).find('a[href]').filter((__, a) => {
              const h = $(a).attr('href') || '';
              return /\/\d+/.test(h) && !/thumbs|posters|\.(jpg|png|gif)/i.test(h);
            }).first();
          }
          if (!linkEl.length) return;
          const href = linkEl.attr('href') || '';
          if (!href) return;
          const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;

          let title = (linkEl.attr('title') || $(el).find('.name, .shortstory-title').text() || linkEl.text() || '').trim();
          // Clean up " смотреть онлайн" suffix and year from title
          title = title.replace(/,?\s*\d{4}\s*смотреть онлайн$/i, '').replace(/\s*смотреть онлайн$/i, '').trim();
          const poster = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
          const fullPoster = poster.startsWith('http') ? poster : (poster ? `${BASE}${poster}` : '');

          const infoText = $(el).text();
          const yearMatch = infoText.match(/(\d{4})/);
          const year = yearMatch ? parseInt(yearMatch[1]) : null;

          const genreEl = $(el).find('.genre, .category, .item-info');
          const genre = genreEl.text().trim().split(',').slice(0, 3).join(', ');

          if (title && href) {
            items.push({ title, year, url: fullUrl, poster: fullPoster, genre });
          }
        });

        console.log(`[filmix] ${list} page ${page}: found ${items.length} titles`);

        for (const item of items) {
          const existing = db.prepare(
            'SELECT id FROM movies WHERE source = ? AND source_url = ?'
          ).get('filmix', item.url);
          if (existing) continue;

          // Filmix's PJS player handles season/episode selection internally,
          // so we store one entry per title. type is set by category.
          insertMovieStmt.run({
            title: item.title,
            year: item.year,
            poster: item.poster,
            genre: item.genre,
            source: 'filmix',
            source_url: item.url,
            language: 'ru',
            type: isSeries ? 'series' : 'movie',
          });
          saved++;
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[filmix] Error on ${list} page ${page}:`, err.message);
      }
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('filmix', saved);
  console.log(`[filmix] Done. Saved ${saved} new entries.`);
  return saved;
}
