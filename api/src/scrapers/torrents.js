import axios from 'axios';
import config from '../config.js';
import { fetchRatings } from '../services/omdb.js';
import db from '../db.js';

const YTS_API = 'https://yts.torrentbay.st/api/v2';
const TPB_API = 'https://apibay.org';

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337',
  'udp://tracker.openbittorrent.com:80',
  'udp://open.stealth.si:80',
  'udp://tracker.torrent.eu.org:451',
  'udp://tracker.coppersurfer.tk:6969',
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

function makeMagnet(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${TRACKERS}`;
}

function detectQuality(name) {
  if (/2160p|4k/i.test(name)) return '4K';
  if (/1080p/i.test(name)) return '1080p';
  if (/720p/i.test(name)) return '720p';
  if (/480p/i.test(name)) return '480p';
  return 'unknown';
}

// Extract clean movie title + year from torrent name
function parseTorrentName(name) {
  // "Inception (2010) 1080p BrRip..." or "Inception.2010.1080p..."
  const m = name.match(/^(.+?)[.\s(]+(\d{4})[).\s]/);
  if (m) {
    const title = m[1].replace(/\./g, ' ').trim();
    return { title, year: parseInt(m[2]) };
  }
  // fallback: just take everything before quality indicator
  const m2 = name.match(/^(.+?)\s*(1080p|720p|2160p|4k|480p|BrRip|BluRay|WEB)/i);
  if (m2) {
    const title = m2[1].replace(/\./g, ' ').trim();
    return { title, year: null };
  }
  return { title: name.replace(/\./g, ' ').trim(), year: null };
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, torrent_magnet, torrent_quality)
  VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @torrent_magnet, @torrent_quality)
`);

const updateStmt = db.prepare(`
  UPDATE movies SET source = 'both', torrent_magnet = @torrent_magnet, torrent_quality = @torrent_quality
  WHERE imdb_id = @imdb_id AND source = '123movies'
`);

// ============================================================
// YTS Scraper (mirror)
// ============================================================
export async function scrapeTorrentsYTS(pages = 3, genre = null) {
  const label = genre ? `YTS/${genre}` : 'YTS';
  console.log(`[torrents] Scraping ${label} (${pages} pages)...`);
  let saved = 0;

  for (let page = 1; page <= pages; page++) {
    try {
      const params = {
        page,
        limit: 50,
        sort_by: 'date_added',
        order_by: 'desc',
        minimum_rating: config.minImdbRating,
      };
      if (genre) params.genre = genre;

      const { data } = await axios.get(`${YTS_API}/list_movies.json`, { params, timeout: 15000 });

      const movies = data?.data?.movies;
      if (!movies || !movies.length) break;

      for (const movie of movies) {
        if (!movie.imdb_code) continue;

        const torrents = movie.torrents || [];
        const best = torrents.find(t => t.quality === '1080p')
          || torrents.find(t => t.quality === '720p')
          || torrents[0];
        if (!best) continue;
        if (!best.seeds || best.seeds === 0) continue;

        const magnet = makeMagnet(best.hash, movie.title);

        const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(movie.imdb_code);
        if (existing) {
          if (existing.source === '123movies') {
            updateStmt.run({ imdb_id: movie.imdb_code, torrent_magnet: magnet, torrent_quality: best.quality });
          }
          continue;
        }

        // Use YTS data directly — skip OMDb to save API quota
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
      }

      process.stdout.write(`  [${label}] Page ${page}/${pages}: ${movies.length} found\r`);
    } catch (err) {
      console.error(`  [${label}] Page ${page} error: ${err.message}`);
    }
  }

  console.log(`  [${label}] ✅ Saved ${saved} movies`);
  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run(`yts-${genre || 'all'}`, saved);
  return saved;
}

// ============================================================
// TPB (The Pirate Bay) Scraper via apibay.org
// ============================================================
export async function scrapeTorrentsTPB(searchTerms) {
  console.log(`[torrents] Scraping TPB for ${searchTerms.length} search terms...`);
  let saved = 0;

  for (const term of searchTerms) {
    try {
      // cat=207 = HD Movies
      const { data } = await axios.get(`${TPB_API}/q.php`, {
        params: { q: term, cat: '207' },
        timeout: 15000,
      });

      if (!Array.isArray(data) || (data.length === 1 && data[0].name === 'No results returned')) continue;

      // Filter: seeders > 5, size > 500MB
      const good = data.filter(t =>
        parseInt(t.seeders) > 5 &&
        parseInt(t.size) > 500 * 1024 * 1024 &&
        t.info_hash && t.info_hash !== '0000000000000000000000000000000000000000'
      );

      for (const torrent of good.slice(0, 3)) { // top 3 per search
        const { title, year } = parseTorrentName(torrent.name);
        if (!title) continue;

        const quality = detectQuality(torrent.name);
        const magnet = makeMagnet(torrent.info_hash, torrent.name);

        const ratings = await fetchRatings(title, year);
        if (!ratings || !ratings.imdb_id) continue;
        if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) continue;

        const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(ratings.imdb_id);
        if (existing) {
          if (existing.source === '123movies') {
            updateStmt.run({ imdb_id: ratings.imdb_id, torrent_magnet: magnet, torrent_quality: quality });
          }
          continue;
        }

        insertStmt.run({ ...ratings, source: 'torrent', torrent_magnet: magnet, torrent_quality: quality });
        saved++;
        await new Promise(r => setTimeout(r, 200));
      }

      process.stdout.write(`  [TPB] "${term}": ${good.length} quality results\r`);
    } catch (err) {
      console.error(`  [TPB] "${term}" error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`  [TPB] ✅ Saved ${saved} movies`);
  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('tpb', saved);
  return saved;
}

// ============================================================
// TPB: Browse top movies (preloaded popular searches)
// ============================================================
export async function scrapeTorrentsTPBTop() {
  const categories = ['top100:207', 'top100:201']; // HD Movies, Movies
  console.log('[torrents] Scraping TPB top lists...');
  let saved = 0;

  for (const cat of categories) {
    try {
      const { data } = await axios.get(`${TPB_API}/precompiled/data_${cat.replace(':', '_')}.json`, { timeout: 15000 });

      if (!Array.isArray(data)) continue;

      for (const torrent of data) {
        if (!torrent.info_hash || torrent.info_hash === '0000000000000000000000000000000000000000') continue;
        if (parseInt(torrent.seeders) < 5) continue;

        const { title, year } = parseTorrentName(torrent.name);
        if (!title) continue;

        const quality = detectQuality(torrent.name);
        const magnet = makeMagnet(torrent.info_hash, torrent.name);

        const ratings = await fetchRatings(title, year);
        if (!ratings || !ratings.imdb_id) continue;
        if (!ratings.imdb_rating || ratings.imdb_rating < config.minImdbRating) continue;

        const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(ratings.imdb_id);
        if (existing) {
          if (existing.source === '123movies') {
            updateStmt.run({ imdb_id: ratings.imdb_id, torrent_magnet: magnet, torrent_quality: quality });
          }
          continue;
        }

        insertStmt.run({ ...ratings, source: 'torrent', torrent_magnet: magnet, torrent_quality: quality });
        saved++;
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`  [TPB top] ${cat} error: ${err.message}`);
    }
  }

  console.log(`  [TPB top] ✅ Saved ${saved} movies`);
  db.prepare('INSERT INTO scrape_log (source, count) VALUES (?, ?)').run('tpb-top', saved);
  return saved;
}

// Combined scrape for scheduler
export async function scrapeTorrents(pages = 3) {
  let total = 0;
  total += await scrapeTorrentsYTS(pages);
  total += await scrapeTorrentsTPBTop();
  return total;
}
