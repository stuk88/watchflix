import axios from 'axios';
import config from '../config.js';
import { fetchRatings } from '../services/omdb.js';
import db from '../db.js';

const YTS_API = config.sources.ytsApi;

export async function scrapeTorrents(pages = 3) {
  console.log(`[torrents] Scraping YTS (${pages} pages)...`);
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, torrent_magnet, torrent_quality)
    VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @torrent_magnet, @torrent_quality)
  `);

  const updateStmt = db.prepare(`
    UPDATE movies SET source = 'both', torrent_magnet = @torrent_magnet, torrent_quality = @torrent_quality
    WHERE imdb_id = @imdb_id AND source = '123movies'
  `);

  for (let page = 1; page <= pages; page++) {
    try {
      const { data } = await axios.get(`${YTS_API}/list_movies.json`, {
        params: {
          page,
          limit: 50,
          sort_by: 'date_added',
          order_by: 'desc',
          minimum_rating: config.minImdbRating,
        },
        timeout: 15000,
      });

      const movies = data?.data?.movies;
      if (!movies || !movies.length) {
        console.log(`[torrents] Page ${page}: no movies`);
        break;
      }

      console.log(`[torrents] Page ${page}: found ${movies.length} movies`);

      for (const movie of movies) {
        if (!movie.imdb_code) continue;

        // Pick best torrent (prefer 1080p)
        const torrents = movie.torrents || [];
        const best = torrents.find(t => t.quality === '1080p')
          || torrents.find(t => t.quality === '720p')
          || torrents[0];

        if (!best) continue;

        const magnet = `magnet:?xt=urn:btih:${best.hash}&dn=${encodeURIComponent(movie.title)}&tr=udp://tracker.opentrackr.org:1337&tr=udp://tracker.openbittorrent.com:80&tr=udp://open.stealth.si:80&tr=udp://tracker.torrent.eu.org:451`;

        // Check existing
        const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(movie.imdb_code);
        if (existing) {
          if (existing.source === '123movies') {
            updateStmt.run({ imdb_id: movie.imdb_code, torrent_magnet: magnet, torrent_quality: best.quality });
          }
          continue;
        }

        // Fetch full ratings from OMDb
        const ratings = await fetchRatings(movie.title, movie.year);
        if (!ratings) {
          // Use YTS data as fallback
          if (movie.rating < config.minImdbRating) continue;

          insertStmt.run({
            title: movie.title,
            year: movie.year,
            imdb_id: movie.imdb_code,
            imdb_rating: movie.rating,
            rt_rating: null,
            meta_rating: null,
            poster: movie.large_cover_image || movie.medium_cover_image,
            plot: movie.synopsis || movie.description_full || null,
            genre: (movie.genres || []).join(', '),
            runtime: movie.runtime ? `${movie.runtime} min` : null,
            director: null,
            actors: null,
            source: 'torrent',
            torrent_magnet: magnet,
            torrent_quality: best.quality,
          });
          saved++;
          continue;
        }

        if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) continue;

        insertStmt.run({
          ...ratings,
          poster: ratings.poster || movie.large_cover_image,
          source: 'torrent',
          torrent_magnet: magnet,
          torrent_quality: best.quality,
        });
        saved++;

        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[torrents] Error on page ${page}:`, err.message);
    }
  }

  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('torrent', saved);
  console.log(`[torrents] Done. Saved ${saved} new movies.`);
  return saved;
}
