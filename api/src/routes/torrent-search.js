import { Router } from 'express';
import axios from 'axios';
import db from '../db.js';
import { makeMagnet } from '../scrapers/torrents.js';
import { fetchRatings } from '../services/omdb.js';

const router = Router();

const YTS_API = 'https://yts.torrentbay.st/api/v2';
const TPB_API = 'https://apibay.org';
const CSV_API = 'https://torrents-csv.com/service/search';

const MIN_SEEDS = 5;
const MIN_SIZE_BYTES = 300 * 1024 * 1024; // 300 MB

function detectQuality(name) {
  if (/2160p|4k/i.test(name)) return '4K';
  if (/1080p/i.test(name)) return '1080p';
  if (/720p/i.test(name)) return '720p';
  if (/480p/i.test(name)) return '480p';
  return 'unknown';
}

function formatSize(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

async function searchYTS(query) {
  try {
    const { data } = await axios.get(`${YTS_API}/list_movies.json`, {
      params: { query_term: query, limit: 20, sort_by: 'seeds', order_by: 'desc' },
      timeout: 10000,
    });
    const movies = data?.data?.movies || [];
    const results = [];
    for (const m of movies) {
      for (const t of (m.torrents || [])) {
        if (!t.seeds || t.seeds < MIN_SEEDS) continue;
        results.push({
          name: `${m.title} (${m.year}) [${t.quality}]`,
          infohash: t.hash.toUpperCase(),
          magnet: makeMagnet(t.hash, m.title),
          quality: t.quality || 'unknown',
          seeds: t.seeds,
          leechers: t.peers || 0,
          size: t.size || '',
          sizeBytes: t.size_bytes || 0,
          source: 'YTS',
          poster: m.medium_cover_image || null,
          year: m.year,
          imdbId: m.imdb_code || null,
          rating: m.rating || null,
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[torrent-search] YTS error:', err.message);
    return [];
  }
}

async function searchTPB(query) {
  try {
    const { data } = await axios.get(`${TPB_API}/q.php`, {
      params: { q: query, cat: '207' },
      timeout: 10000,
    });
    if (!Array.isArray(data) || (data.length === 1 && data[0].name === 'No results returned')) return [];

    return data
      .filter(t =>
        parseInt(t.seeders) >= MIN_SEEDS &&
        parseInt(t.size) >= MIN_SIZE_BYTES &&
        t.info_hash && t.info_hash !== '0000000000000000000000000000000000000000'
      )
      .slice(0, 15)
      .map(t => ({
        name: t.name,
        infohash: t.info_hash.toUpperCase(),
        magnet: makeMagnet(t.info_hash, t.name),
        quality: detectQuality(t.name),
        seeds: parseInt(t.seeders),
        leechers: parseInt(t.leechers) || 0,
        size: formatSize(parseInt(t.size)),
        sizeBytes: parseInt(t.size),
        source: 'TPB',
        poster: null,
        year: null,
        imdbId: null,
        rating: null,
      }));
  } catch (err) {
    console.error('[torrent-search] TPB error:', err.message);
    return [];
  }
}

async function searchCSV(query) {
  try {
    const { data } = await axios.get(CSV_API, {
      params: { q: query, size: 20 },
      timeout: 10000,
    });
    const torrents = data?.torrents || [];
    return torrents
      .filter(t => t.infohash && t.seeders >= MIN_SEEDS && t.size_bytes >= MIN_SIZE_BYTES)
      .map(t => ({
        name: t.name,
        infohash: t.infohash.toUpperCase(),
        magnet: makeMagnet(t.infohash, t.name),
        quality: detectQuality(t.name),
        seeds: t.seeders,
        leechers: t.leechers || 0,
        size: formatSize(t.size_bytes),
        sizeBytes: t.size_bytes,
        source: 'CSV',
        poster: null,
        year: null,
        imdbId: null,
        rating: null,
      }));
  } catch (err) {
    console.error('[torrent-search] CSV error:', err.message);
    return [];
  }
}

// GET /api/torrent-search?q=...
router.get('/', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  const [yts, tpb, csv] = await Promise.all([
    searchYTS(query),
    searchTPB(query),
    searchCSV(query),
  ]);

  const all = [...yts, ...tpb, ...csv];

  // Deduplicate by infohash — keep highest seeds
  const byHash = new Map();
  for (const r of all) {
    const existing = byHash.get(r.infohash);
    if (!existing || r.seeds > existing.seeds) {
      byHash.set(r.infohash, r);
    }
  }

  const results = [...byHash.values()].sort((a, b) => b.seeds - a.seeds);
  res.json({ results, total: results.length });
});

// POST /api/torrent-search/add — add a torrent result to the local library
router.post('/add', async (req, res) => {
  const { magnet, name, quality, infohash } = req.body;
  if (!magnet || !name) return res.status(400).json({ error: 'Missing magnet or name' });

  // Check if already in DB by infohash
  if (infohash) {
    const existing = db.prepare('SELECT id FROM movies WHERE torrent_magnet LIKE ?').get(`%${infohash}%`);
    if (existing) return res.json({ ok: true, movieId: existing.id, existing: true });
  }

  // Parse title + year from torrent name
  let title, year;
  const m = name.match(/^(.+?)[.\s(]+(\d{4})[).\s]/);
  if (m) {
    title = m[1].replace(/\./g, ' ').trim();
    year = parseInt(m[2]);
  } else {
    const m2 = name.match(/^(.+?)\s*(1080p|720p|2160p|4k|480p|BrRip|BluRay|WEB)/i);
    title = m2 ? m2[1].replace(/\./g, ' ').trim() : name.replace(/\./g, ' ').trim();
    year = null;
  }

  // Fetch metadata from OMDb
  const ratings = await fetchRatings(title, year);

  const insertData = {
    title: ratings?.title || title,
    year: ratings?.year || year,
    imdb_id: ratings?.imdb_id || null,
    imdb_rating: ratings?.imdb_rating || null,
    rt_rating: ratings?.rt_rating || null,
    meta_rating: ratings?.meta_rating || null,
    poster: ratings?.poster || null,
    plot: ratings?.plot || null,
    genre: ratings?.genre || null,
    runtime: ratings?.runtime || null,
    director: ratings?.director || null,
    actors: ratings?.actors || null,
    source: 'torrent',
    torrent_magnet: magnet,
    torrent_quality: quality || 'unknown',
  };

  // If we found an imdb_id, check if it already exists
  if (insertData.imdb_id) {
    const existing = db.prepare('SELECT id, source FROM movies WHERE imdb_id = ?').get(insertData.imdb_id);
    if (existing) {
      // Update to add torrent if it was 123movies-only
      if (existing.source === '123movies') {
        db.prepare('UPDATE movies SET source = ?, torrent_magnet = ?, torrent_quality = ? WHERE id = ?')
          .run('both', magnet, quality || 'unknown', existing.id);
      } else if (!db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(existing.id)?.torrent_magnet) {
        db.prepare('UPDATE movies SET torrent_magnet = ?, torrent_quality = ? WHERE id = ?')
          .run(magnet, quality || 'unknown', existing.id);
      }
      return res.json({ ok: true, movieId: existing.id, existing: true });
    }
  }

  const result = db.prepare(`
    INSERT INTO movies (title, year, imdb_id, imdb_rating, rt_rating, meta_rating, poster, plot, genre, runtime, director, actors, source, torrent_magnet, torrent_quality)
    VALUES (@title, @year, @imdb_id, @imdb_rating, @rt_rating, @meta_rating, @poster, @plot, @genre, @runtime, @director, @actors, @source, @torrent_magnet, @torrent_quality)
  `).run(insertData);

  res.json({ ok: true, movieId: result.lastInsertRowid, existing: false });
});

export default router;
