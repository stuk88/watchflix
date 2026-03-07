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

function parseSeasonNumber(rawTitle) {
  const match = rawTitle.match(/Season\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Fetch the series page and return an array of episode numbers found in ul.episodes.
 * Each episode link has id="ep-N" where N is the episode number.
 */
export async function fetchEpisodes(seriesUrl) {
  try {
    const { data: html } = await axios.get(seriesUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    const $ = cheerio.load(html);
    const episodes = [];
    $('ul.episodes li a.episode').each((_, el) => {
      const id = $(el).attr('id') || '';           // e.g. "ep-1"
      const title = $(el).attr('title') || '';      // e.g. "Episode 1"
      const epMatch = id.match(/ep-(\d+)/i);
      if (epMatch) {
        episodes.push({
          episode: parseInt(epMatch[1], 10),
          episode_title: title || null,
        });
      }
    });
    return episodes;
  } catch (err) {
    console.error(`[123movies] Failed to fetch episodes from ${seriesUrl}:`, err.message);
    return [];
  }
}

export async function scrape123Movies(pages = 3) {
  console.log(`[123movies] Scraping ${pages} pages...`);
  let saved = 0;

  const insertMovieStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url, type)
    VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url, @type)
  `);

  const insertEpisodeStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, series_imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, source_url, type, season, episode, episode_title)
    VALUES (@title, @year, @series_imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @source_url, @type, @season, @episode, @episode_title)
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
      const items = [];

      // Each .item contains an a.poster and a .meta with optional <i class="type">TV</i>
      $('.item').each((_, el) => {
        const posterEl = $(el).find('a.poster[title]');
        const rawTitle = posterEl.attr('title');
        const href = posterEl.attr('href');
        if (!rawTitle || !href) return;

        const typeText = $(el).find('i.type').text().trim().toUpperCase();
        const isTv = typeText === 'TV';

        items.push({
          rawTitle,
          href: href.startsWith('http') ? href : `${BASE}${href}`,
          isTv,
        });
      });

      console.log(`[123movies] Page ${page}: found ${items.length} titles`);

      for (const { rawTitle, href, isTv } of items) {
        const title = cleanTitle(rawTitle);
        if (!title) continue;

        if (isTv) {
          const season = parseSeasonNumber(rawTitle);

          // Check if all episodes of this season are already in DB
          const existingEp = db.prepare(
            'SELECT id FROM movies WHERE title = ? AND source_url = ? AND type = ? AND season = ?'
          ).get(title, href, 'series', season);
          if (existingEp) continue;

          const ratings = await fetchRatings(title, 'series');
          if (!ratings) continue;
          if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) continue;

          // Fetch the episode list from the series page
          const episodes = await fetchEpisodes(href);
          if (episodes.length === 0) {
            // No episode list found – store as a single series entry without episode number
            const existing2 = db.prepare('SELECT id FROM movies WHERE series_imdb_id = ? AND season = ? AND episode IS NULL').get(ratings.imdb_id, season);
            if (!existing2) {
              insertEpisodeStmt.run({
                ...ratings,
                series_imdb_id: ratings.imdb_id,
                imdb_id: undefined,
                source: '123movies',
                source_url: href,
                type: 'series',
                season,
                episode: null,
                episode_title: null,
              });
              saved++;
            }
          } else {
            for (const ep of episodes) {
              const existingEpRow = db.prepare(
                'SELECT id FROM movies WHERE series_imdb_id = ? AND season = ? AND episode = ?'
              ).get(ratings.imdb_id, season, ep.episode);
              if (existingEpRow) continue;

              insertEpisodeStmt.run({
                ...ratings,
                series_imdb_id: ratings.imdb_id,
                imdb_id: undefined,
                source: '123movies',
                source_url: href,
                type: 'series',
                season,
                episode: ep.episode,
                episode_title: ep.episode_title,
              });
              saved++;
            }
          }
        } else {
          // Movie
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

          insertMovieStmt.run({
            ...ratings,
            source: '123movies',
            source_url: href,
            type: 'movie',
          });
          saved++;
        }

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
