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
 * Fetch the detail page of a series and extract season/episode info.
 */
async function fetchSeriesEpisodes(seriesUrl) {
  try {
    const { data: html } = await axios.get(seriesUrl, {
      timeout: 15000,
      headers: { 'User-Agent': UA },
    });
    const $ = cheerio.load(html);
    const episodes = [];

    // Look for season/episode selectors
    const seasonEls = $('.seasons-list li, .season-tab, [data-season]');
    if (seasonEls.length > 0) {
      seasonEls.each((_, sEl) => {
        const seasonNum = parseInt($(sEl).attr('data-season') || $(sEl).text().match(/(\d+)/)?.[1]) || 1;
        const epEls = $(`.episodes-list[data-season="${seasonNum}"] li, .episode-item[data-season="${seasonNum}"]`);
        if (epEls.length > 0) {
          epEls.each((__, eEl) => {
            const epNum = parseInt($(eEl).attr('data-episode') || $(eEl).text().match(/(\d+)/)?.[1]) || 1;
            const epTitle = $(eEl).text().trim() || null;
            episodes.push({ season: seasonNum, episode: epNum, episode_title: epTitle });
          });
        } else {
          episodes.push({ season: seasonNum, episode: 1, episode_title: `Season ${seasonNum}` });
        }
      });
    } else {
      // Try generic episode links
      const epLinks = $('a[href*="episode"], .episode, .seria');
      epLinks.each((_, el) => {
        const text = $(el).text().trim();
        const epMatch = text.match(/(\d+)/);
        if (epMatch) {
          episodes.push({ season: 1, episode: parseInt(epMatch[1]), episode_title: text });
        }
      });
    }

    return episodes;
  } catch (err) {
    console.error(`[seazonvar] Failed to fetch episodes from ${seriesUrl}:`, err.message);
    return [];
  }
}

/**
 * Scrape Seazonvar pages. All items treated as series with episode grouping.
 */
export async function scrapeSeazonvar(pages = 3) {
  console.log(`[seazonvar] Scraping ${pages} pages...`);
  let saved = 0;

  const insertEpisodeStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type, series_imdb_id, season, episode, episode_title)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type, @series_imdb_id, @season, @episode, @episode_title)
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

      $('.shortstory, .item, .b-content__inline_item').each((_, el) => {
        const linkEl = $(el).find('a.title, .shortstory-title a, .b-content__inline_item-link a, a[href*="/serial/"]').first();
        if (!linkEl.length) {
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
          items.push({ title, year, url: fullUrl, poster: fullPoster, genre });
        }
      });

      console.log(`[seazonvar] Page ${page}: found ${items.length} titles`);

      for (const item of items) {
        const seriesId = `seazonvar:${item.url}`;

        const existingEp = db.prepare(
          'SELECT id FROM movies WHERE series_imdb_id = ? LIMIT 1'
        ).get(seriesId);
        if (existingEp) continue;

        // Fetch episode list from detail page
        const episodes = await fetchSeriesEpisodes(item.url);

        if (episodes.length > 0) {
          for (const ep of episodes) {
            insertEpisodeStmt.run({
              title: item.title,
              year: item.year,
              poster: item.poster,
              genre: item.genre,
              source: 'seazonvar',
              source_url: item.url,
              language: 'ru',
              type: 'series',
              series_imdb_id: seriesId,
              season: ep.season,
              episode: ep.episode,
              episode_title: ep.episode_title,
            });
            saved++;
          }
        } else {
          // No episodes found — store as single series entry
          insertEpisodeStmt.run({
            title: item.title,
            year: item.year,
            poster: item.poster,
            genre: item.genre,
            source: 'seazonvar',
            source_url: item.url,
            language: 'ru',
            type: 'series',
            series_imdb_id: seriesId,
            season: 1,
            episode: null,
            episode_title: null,
          });
          saved++;
        }

        await new Promise(r => setTimeout(r, 300));
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[seazonvar] Error on page ${page}:`, err.message);
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('seazonvar', saved);
  console.log(`[seazonvar] Done. Saved ${saved} new entries.`);
  return saved;
}
