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

      const yearMatch = infoText.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

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
 * Fetch the detail page of a series and extract season/episode info.
 * Hdrezka uses translator-based tabs; episodes listed under .b-simple_episodes__list
 */
async function fetchSeriesEpisodes(seriesUrl) {
  try {
    const { data: html } = await axios.get(seriesUrl, {
      timeout: 15000,
      headers: { 'User-Agent': UA },
    });
    const $ = cheerio.load(html);
    const episodes = [];

    // Hdrezka lists seasons in #simple-seasons-tabs or .b-simple_season__list
    const seasonEls = $('.b-simple_season__list li, #simple-seasons-tabs li');
    if (seasonEls.length > 0) {
      // Has explicit season tabs — episodes are listed per season
      seasonEls.each((_, sEl) => {
        const seasonNum = parseInt($(sEl).attr('data-tab_id') || $(sEl).text().match(/(\d+)/)?.[1]) || 1;
        // Episodes for this season
        const epEls = $(`.b-simple_episodes__list[id*="simple-episodes-list-${seasonNum}"] li, .b-simple_episodes__list li[data-season_id="${seasonNum}"]`);
        if (epEls.length > 0) {
          epEls.each((__, eEl) => {
            const epNum = parseInt($(eEl).attr('data-episode_id') || $(eEl).text().match(/(\d+)/)?.[1]) || 1;
            const epTitle = $(eEl).text().trim() || null;
            episodes.push({ season: seasonNum, episode: epNum, episode_title: epTitle });
          });
        } else {
          // No per-episode breakdown; add season as single entry
          episodes.push({ season: seasonNum, episode: 1, episode_title: `Season ${seasonNum}` });
        }
      });
    } else {
      // No season tabs — try finding episodes directly
      const epEls = $('.b-simple_episodes__list li');
      if (epEls.length > 0) {
        epEls.each((_, eEl) => {
          const epNum = parseInt($(eEl).attr('data-episode_id') || $(eEl).text().match(/(\d+)/)?.[1]) || 1;
          const epTitle = $(eEl).text().trim() || null;
          episodes.push({ season: 1, episode: epNum, episode_title: epTitle });
        });
      }
    }

    return episodes;
  } catch (err) {
    console.error(`[hdrezka] Failed to fetch episodes from ${seriesUrl}:`, err.message);
    return [];
  }
}

/**
 * Scrape Hdrezka pages. Series are stored with episode rows grouped by series_imdb_id.
 */
export async function scrapeHdrezka(pages = 3) {
  console.log(`[hdrezka] Scraping ${pages} pages...`);
  let saved = 0;

  const insertMovieStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type)
  `);

  const insertEpisodeStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, poster, genre, source, source_url, language, type, series_imdb_id, season, episode, episode_title)
    VALUES (@title, @year, @poster, @genre, @source, @source_url, @language, @type, @series_imdb_id, @season, @episode, @episode_title)
  `);

  const categories = ['/films/', '/series/', '/cartoons/'];

  for (const category of categories) {
    const isSeries = category.includes('series');

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

          const parts = infoText.split(',').map(s => s.trim());
          const genre = parts.length > 2 ? parts.slice(2).join(', ') : '';

          if (title && href) {
            items.push({ title, year, href, poster, genre });
          }
        });

        console.log(`[hdrezka] ${category} page ${page}: found ${items.length} titles`);

        for (const item of items) {
          if (isSeries) {
            // Use source_url as series grouping key (no IMDB ID for Russian sources)
            const seriesId = `hdrezka:${item.href}`;

            const existingEp = db.prepare(
              'SELECT id FROM movies WHERE series_imdb_id = ? LIMIT 1'
            ).get(seriesId);
            if (existingEp) continue;

            // Fetch episode list from detail page
            const episodes = await fetchSeriesEpisodes(item.href);

            if (episodes.length > 0) {
              for (const ep of episodes) {
                insertEpisodeStmt.run({
                  title: item.title,
                  year: item.year,
                  poster: item.poster,
                  genre: item.genre,
                  source: 'hdrezka',
                  source_url: item.href,
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
                source: 'hdrezka',
                source_url: item.href,
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
            // Movie
            const existing = db.prepare(
              'SELECT id FROM movies WHERE title = ? AND source = ? AND source_url = ?'
            ).get(item.title, 'hdrezka', item.href);
            if (existing) continue;

            insertMovieStmt.run({
              title: item.title,
              year: item.year,
              poster: item.poster,
              genre: item.genre,
              source: 'hdrezka',
              source_url: item.href,
              language: 'ru',
              type: 'movie',
            });
            saved++;
          }
        }

        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[hdrezka] Error on ${category} page ${page}:`, err.message);
      }
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('hdrezka', saved);
  console.log(`[hdrezka] Done. Saved ${saved} new entries.`);
  return saved;
}
