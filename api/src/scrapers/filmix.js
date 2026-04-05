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

    // Filmix typically shows seasons as tabs and episodes as lists
    const seasonEls = $('.seasons-list li, .player-season-tab, [data-season], .season-item');
    if (seasonEls.length > 0) {
      seasonEls.each((_, sEl) => {
        const seasonNum = parseInt($(sEl).attr('data-season') || $(sEl).attr('data-id') || $(sEl).text().match(/(\d+)/)?.[1]) || 1;
        const epEls = $(`.episodes-list[data-season="${seasonNum}"] li, .episode-item[data-season="${seasonNum}"], .player-episode-list[data-season="${seasonNum}"] li`);
        if (epEls.length > 0) {
          epEls.each((__, eEl) => {
            const epNum = parseInt($(eEl).attr('data-episode') || $(eEl).attr('data-id') || $(eEl).text().match(/(\d+)/)?.[1]) || 1;
            const epTitle = $(eEl).text().trim() || null;
            episodes.push({ season: seasonNum, episode: epNum, episode_title: epTitle });
          });
        } else {
          episodes.push({ season: seasonNum, episode: 1, episode_title: `Season ${seasonNum}` });
        }
      });
    } else {
      // Try generic episode selectors
      const epEls = $('.episode, .seria, [data-episode]');
      epEls.each((_, el) => {
        const epNum = parseInt($(el).attr('data-episode') || $(el).text().match(/(\d+)/)?.[1]) || 1;
        const epTitle = $(el).text().trim() || null;
        episodes.push({ season: 1, episode: epNum, episode_title: epTitle });
      });
    }

    return episodes;
  } catch (err) {
    console.error(`[filmix] Failed to fetch episodes from ${seriesUrl}:`, err.message);
    return [];
  }
}

/**
 * Scrape Filmix pages. Series are stored with episode rows grouped by series_imdb_id.
 */
export async function scrapeFilmix(pages = 3) {
  console.log(`[filmix] Scraping ${pages} pages...`);
  let saved = 0;

  const insertMovieStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  const insertEpisodeStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type, series_imdb_id, season, episode, episode_title)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type, @series_imdb_id, @season, @episode, @episode_title)
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
        const { data: html } = await axios.get(url, {
          timeout: 15000,
          headers: { 'User-Agent': UA },
        });

        const $ = cheerio.load(html);
        const items = [];

        $('.poster-tooltip, .shortstory, .film-poster').each((_, el) => {
          const linkEl = $(el).is('a') ? $(el) : $(el).closest('a[href]').length ? $(el).closest('a[href]') : $(el).find('a[href]').first();
          const href = linkEl.attr('href') || '';
          // Only accept links with numeric IDs (actual movie/series pages)
          if (!href || !/\/\d+/.test(href)) return;
          const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;

          const title = (linkEl.attr('title') || $(el).find('.name, .shortstory-title').text() || linkEl.text() || '').trim();
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
          if (isSeries) {
            const seriesId = `filmix:${item.url}`;

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
                  source: 'filmix',
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
              insertEpisodeStmt.run({
                title: item.title,
                year: item.year,
                poster: item.poster,
                genre: item.genre,
                source: 'filmix',
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
          } else {
            const existing = db.prepare(
              'SELECT id FROM movies WHERE title = ? AND source = ? AND source_url = ?'
            ).get(item.title, 'filmix', item.url);
            if (existing) continue;

            insertMovieStmt.run({
              title: item.title,
              year: item.year,
              poster: item.poster,
              genre: item.genre,
              source: 'filmix',
              source_url: item.url,
              language: 'ru',
              type: 'movie',
            });
            saved++;
          }
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
