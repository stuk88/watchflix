import { Router } from 'express';
import axios from 'axios';
import db from '../db.js';
import config, { isAllowedProxyUrl } from '../config.js';
import { makeMagnet } from '../scrapers/torrents.js';
import { getVideoFile, getStats, destroyTorrent, getFileInfo, saveToOffline, cancelSave } from '../services/streamer.js';
import { extractEmbedUrl, getAvailableServers } from '../services/stream-extractor.js';
import { fetchSubtitles, fetchSubtitlesByFilename, fetchAndConvertSubtitle, srtToVtt } from '../services/subtitles.js';
import { getCriticScores } from '../services/review-scraper-lite.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

const router = Router();

// List movies with pagination, sort, filter
router.get('/', (req, res) => {
  const {
    page = 1,
    limit = 40,
    sort = 'added_at',
    order = 'desc',
    genre,
    country,
    source,
    min_rating,
    search,
    favorites,
    show_hidden,
    only_hidden,
    type = 'all',
    language,
    rating_provider = 'imdb',
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [];
  const params = {};

  if (genre) {
    conditions.push("genre LIKE @genre");
    params.genre = `%${genre}%`;
  }
  if (country) {
    conditions.push("country LIKE @country");
    params.country = `%${country}%`;
  }
  if (source && source !== 'all') {
    if (source === 'both') {
      conditions.push("(source = @source OR source = 'both')");
    } else {
      conditions.push("(source = @source OR source = 'both')");
    }
    params.source = source;
  }
  if (min_rating) {
    const ratingFilterMap = {
      imdb: "(imdb_rating >= @min_rating OR (imdb_rating IS NULL AND source IN ('hdrezka','filmix','seazonvar')))",
      rt: "(CAST(REPLACE(rt_rating, '%', '') AS REAL) >= @min_rating OR (rt_rating IS NULL AND source IN ('hdrezka','filmix','seazonvar')))",
      meta: "(meta_rating >= @min_rating OR (meta_rating IS NULL AND source IN ('hdrezka','filmix','seazonvar')))",
    };
    conditions.push(ratingFilterMap[rating_provider] || ratingFilterMap.imdb);
    params.min_rating = parseFloat(min_rating);
  }
  if (search) {
    conditions.push("(title LIKE @search OR title_en LIKE @search OR actors LIKE @search OR director LIKE @search)");
    params.search = `%${search}%`;
  }
  if (language && language !== 'all') {
    conditions.push("COALESCE(language, 'en') = @language");
    params.language = language;
  }
  if (favorites === '1') {
    conditions.push("is_favorite = 1");
  }

  // Always exclude hidden unless explicitly requested
  if (only_hidden === '1') {
    conditions.push("is_hidden = 1");
  } else if (show_hidden !== '1') {
    conditions.push("is_hidden = 0");
  }

  // Type filter: show movies, series (one row per show), or all
  let typeCondition;
  if (type === 'movie') {
    typeCondition = "m.type != 'series'";
  } else if (type === 'series') {
    typeCondition = "m.type = 'series' AND sr.rep_id IS NOT NULL";
  } else {
    // Default 'all': show movies + one representative row per series
    typeCondition = "(m.type != 'series' OR sr.rep_id IS NOT NULL)";
  }

  const allConditions = [typeCondition, ...conditions];
  const where = `WHERE ${allConditions.join(' AND ')}`;

  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  let sortExpr;
  if (sort === 'rating') {
    const ratingSortMap = {
      imdb: 'm.imdb_rating',
      rt: "CAST(REPLACE(m.rt_rating, '%', '') AS REAL)",
      meta: 'm.meta_rating',
    };
    sortExpr = ratingSortMap[rating_provider] || 'm.imdb_rating';
  } else {
    const allowedSorts = { added_at: 'm.added_at', title: 'm.title', year: 'm.year' };
    sortExpr = allowedSorts[sort] || 'm.added_at';
  }

  // CTE groups series by series_imdb_id, keeping MIN(id) as the representative row
  const cte = `WITH series_reps AS (
    SELECT MIN(id) as rep_id FROM movies WHERE type = 'series' GROUP BY COALESCE(series_imdb_id, CAST(id AS TEXT))
  )`;
  const fromJoin = `FROM movies m LEFT JOIN series_reps sr ON m.id = sr.rep_id`;
  const episodeCount = `CASE WHEN m.type = 'series' THEN (SELECT COUNT(*) FROM movies mc WHERE mc.series_imdb_id = m.series_imdb_id) ELSE NULL END as episode_count`;

  const total = db.prepare(`${cte} SELECT COUNT(*) as c ${fromJoin} ${where}`).get(params).c;
  const movies = db.prepare(
    `${cte} SELECT m.*, ${episodeCount} ${fromJoin} ${where} ORDER BY ${sortExpr} ${sortOrder} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: parseInt(limit), offset });

  res.json({
    movies,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
  });
});

// Distinct countries for filter dropdown
router.get('/countries', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT country FROM movies WHERE country IS NOT NULL AND country != ''"
  ).all();
  const countrySet = new Set();
  for (const row of rows) {
    for (const c of row.country.split(',')) {
      const trimmed = c.trim();
      if (trimmed) countrySet.add(trimmed);
    }
  }
  const countries = [...countrySet].sort();
  res.json({ countries });
});

// Get single movie
router.get('/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
});

// Get all episodes for the series that movie :id belongs to
router.get('/:id/episodes', (req, res) => {
  const movie = db.prepare('SELECT series_imdb_id FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  if (!movie.series_imdb_id) return res.status(400).json({ error: 'Not a series episode' });

  const episodes = db.prepare(
    'SELECT * FROM movies WHERE series_imdb_id = ? ORDER BY season ASC, episode ASC'
  ).all(movie.series_imdb_id);

  // Group by season
  const seasons = {};
  for (const ep of episodes) {
    const s = ep.season || 1;
    if (!seasons[s]) seasons[s] = [];
    seasons[s].push(ep);
  }

  res.json({ seasons, totalEpisodes: episodes.length });
});

// Toggle favorite
router.patch('/:id/favorite', (req, res) => {
  const movie = db.prepare('SELECT id, imdb_id, is_favorite FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const newVal = movie.is_favorite ? 0 : 1;
  db.prepare('UPDATE movies SET is_favorite = ? WHERE id = ?').run(newVal, movie.id);
  if (movie.imdb_id) {
    db.prepare(`
      INSERT INTO user_preferences (imdb_id, is_favorite) VALUES (?, ?)
      ON CONFLICT(imdb_id) DO UPDATE SET is_favorite = excluded.is_favorite, updated_at = CURRENT_TIMESTAMP
    `).run(movie.imdb_id, newVal);
  }
  res.json({ id: movie.id, is_favorite: newVal });
});

// Toggle hidden
router.patch('/:id/hide', (req, res) => {
  const movie = db.prepare('SELECT id, imdb_id, is_hidden FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const newVal = movie.is_hidden ? 0 : 1;
  db.prepare('UPDATE movies SET is_hidden = ? WHERE id = ?').run(newVal, movie.id);
  if (movie.imdb_id) {
    db.prepare(`
      INSERT INTO user_preferences (imdb_id, is_hidden) VALUES (?, ?)
      ON CONFLICT(imdb_id) DO UPDATE SET is_hidden = excluded.is_hidden, updated_at = CURRENT_TIMESTAMP
    `).run(movie.imdb_id, newVal);
  }
  res.json({ id: movie.id, is_hidden: newVal });
});

// Update last watched
router.patch('/:id/watched', (req, res) => {
  db.prepare('UPDATE movies SET last_watched = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Update magnet (used when switching to alt source)
router.patch('/:id/magnet', (req, res) => {
  const { torrent_magnet, torrent_quality } = req.body;
  if (!torrent_magnet) return res.status(400).json({ error: 'Missing torrent_magnet' });
  db.prepare('UPDATE movies SET torrent_magnet = ?, torrent_quality = ? WHERE id = ?')
    .run(torrent_magnet, torrent_quality || null, req.params.id);
  res.json({ ok: true });
});

// Get alternative torrent sources (fallback when 0 peers)
router.get('/:id/alt-sources', async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const alternatives = [];

  // Search YTS by imdb_id
  if (movie.imdb_id) {
    try {
      const { data } = await axios.get('https://yts.torrentbay.st/api/v2/list_movies.json', {
        params: { query_term: movie.imdb_id, limit: 10 },
        timeout: 10000,
      });
      const movies = data?.data?.movies || [];
      for (const m of movies) {
        for (const t of (m.torrents || [])) {
          if (!t.seeds || t.seeds === 0) continue;
          alternatives.push({
            source: 'yts',
            magnet: makeMagnet(t.hash, m.title),
            quality: t.quality || 'unknown',
            seeds: t.seeds,
            size: t.size || '',
          });
        }
      }
    } catch (err) {
      console.error('[alt-sources] YTS error:', err.message);
    }
  }

  // Search TPB by title+year
  const query = [movie.title, movie.year].filter(Boolean).join(' ');
  try {
    const { data } = await axios.get('https://apibay.org/q.php', {
      params: { q: query, cat: '207' },
      timeout: 10000,
    });
    if (Array.isArray(data) && !(data.length === 1 && data[0].name === 'No results returned')) {
      const good = data.filter(t =>
        parseInt(t.seeders) > 5 &&
        t.info_hash && t.info_hash !== '0000000000000000000000000000000000000000'
      );
      for (const t of good.slice(0, 5)) {
        const quality = /2160p|4k/i.test(t.name) ? '4K'
          : /1080p/i.test(t.name) ? '1080p'
          : /720p/i.test(t.name) ? '720p'
          : /480p/i.test(t.name) ? '480p' : 'unknown';
        const sizeBytes = parseInt(t.size) || 0;
        const sizeStr = sizeBytes > 1e9
          ? `${(sizeBytes / 1e9).toFixed(1)} GB`
          : sizeBytes > 1e6
          ? `${(sizeBytes / 1e6).toFixed(0)} MB` : '';
        alternatives.push({
          source: 'tpb',
          magnet: makeMagnet(t.info_hash, t.name),
          quality,
          seeds: parseInt(t.seeders),
          size: sizeStr,
        });
      }
    }
  } catch (err) {
    console.error('[alt-sources] TPB error:', err.message);
  }

  // Search TorrentCSV by title+year
  try {
    const csvQuery = [movie.title, movie.year].filter(Boolean).join(' ');
    const { data } = await axios.get('https://torrents-csv.com/service/search', {
      params: { q: csvQuery, size: 15 },
      timeout: 10000,
    });
    const torrents = data?.torrents || [];
    for (const t of torrents) {
      if (!t.infohash || !t.seeders || t.seeders < 3) continue;
      // Skip tiny files (< 300MB) and non-video (soundtracks, subs-only)
      if (t.size_bytes < 300000000) continue;
      const quality = /2160p|4k/i.test(t.name) ? '4K'
        : /1080p/i.test(t.name) ? '1080p'
        : /720p/i.test(t.name) ? '720p'
        : /480p/i.test(t.name) ? '480p' : 'unknown';
      const sizeStr = t.size_bytes > 1e9
        ? `${(t.size_bytes / 1e9).toFixed(1)} GB`
        : `${(t.size_bytes / 1e6).toFixed(0)} MB`;
      alternatives.push({
        source: 'csv',
        magnet: makeMagnet(t.infohash, t.name),
        quality,
        seeds: t.seeders,
        size: sizeStr,
      });
    }
  } catch (err) {
    console.error('[alt-sources] TorrentCSV error:', err.message);
  }

  if (alternatives.length === 0) {
    return res.json({ alternatives: [], dead: true });
  }

  // Deduplicate by infohash (keep highest seeds)
  const byHash = new Map();
  for (const alt of alternatives) {
    const hashMatch = alt.magnet.match(/btih:([a-fA-F0-9]+)/i);
    const hash = hashMatch ? hashMatch[1].toUpperCase() : alt.magnet;
    const existing = byHash.get(hash);
    if (!existing || alt.seeds > existing.seeds) {
      byHash.set(hash, alt);
    }
  }

  // Filter out torrents known to be dead
  const deadRows = db.prepare(
    "SELECT infohash FROM dead_torrents WHERE reported_at > datetime('now', '-30 days')"
  ).all();
  const deadSet = new Set(deadRows.map(r => r.infohash));
  const deduped = [...byHash.values()].filter(alt => {
    const hashMatch = alt.magnet.match(/btih:([a-fA-F0-9]+)/i);
    return !hashMatch || !deadSet.has(hashMatch[1].toUpperCase());
  });

  // Sort by seeds descending
  deduped.sort((a, b) => b.seeds - a.seeds);
  res.json({ alternatives: deduped });
});

// Delete a movie from DB
router.delete('/:id', (req, res) => {
  const movie = db.prepare('SELECT id FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  db.prepare('DELETE FROM movies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function serveFileWithRange(filePath, req, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
  const contentType = mimeTypes[ext] || 'video/mp4';
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
  };
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, {
      ...corsHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', () => res.end());
  } else {
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => res.end());
  }
}

// Stream torrent video via server-side WebTorrent (HTTP range support)
router.get('/:id/stream', async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  // Serve from offline storage if available
  if (movie.offline_path && fs.existsSync(movie.offline_path)) {
    return serveFileWithRange(movie.offline_path, req, res);
  }

  if (!movie.torrent_magnet) return res.status(400).json({ error: 'No torrent magnet' });

  try {
    const { file } = await getVideoFile(movie.torrent_magnet);
    const fileSize = file.length;

    // Content-Type based on extension
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeTypes = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
    const contentType = mimeTypes[ext] || 'video/mp4';

    // CORS headers so <video crossorigin="anonymous"> + <track> elements work
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
    };

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        ...corsHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } else {
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      const stream = file.createReadStream();
      stream.pipe(res);
      stream.on('error', () => res.end());
    }
  } catch (err) {
    console.error('[stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Destroy torrent and delete cached files (called when player closes)
router.delete('/:id/stream', (req, res) => {
  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  let destroyed = false;
  if (movie?.torrent_magnet) {
    destroyed = destroyTorrent(movie.torrent_magnet);
  }
  // Clear stream cache for this movie (HLS URLs, embed cache)
  db.prepare('DELETE FROM stream_cache WHERE movie_id = ?').run(req.params.id);
  db.prepare('UPDATE movies SET cached_stream_url = NULL, stream_cached_at = NULL WHERE id = ?').run(req.params.id);
  console.log(`[stream] Cleanup for movie ${req.params.id}: torrent ${destroyed ? 'destroyed' : 'skipped'}, cache cleared`);
  res.json({ ok: true, destroyed });
});

// Clean up cached stream data (called by non-torrent players on close)
router.post('/:id/cleanup-cache', (req, res) => {
  db.prepare('DELETE FROM stream_cache WHERE movie_id = ?').run(req.params.id);
  db.prepare('UPDATE movies SET cached_stream_url = NULL, stream_cached_at = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get torrent streaming stats
router.get('/:id/stream-stats', (req, res) => {
  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  if (!movie?.torrent_magnet) return res.json({ peers: 0 });
  const stats = getStats(movie.torrent_magnet);
  res.json(stats || { peers: 0 });
});

// Critic review scores (LLM-analyzed from professional reviews)
const CRITIC_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCORES_REPO = 'stuk88/watchflix-scores';
const SCORES_RAW_BASE = `https://raw.githubusercontent.com/${SCORES_REPO}/main/scores`;

async function fetchSharedScores(imdbId) {
  try {
    const { data } = await axios.get(`${SCORES_RAW_BASE}/${imdbId}.json`, { timeout: 5000 });
    if (data?.criticScores?.length) return data.criticScores;
  } catch {}
  return null;
}

async function submitSharedScores(imdbId, title, criticScores) {
  const ghToken = config.githubToken;
  if (!ghToken) return;
  try {
    await axios.post(
      `https://api.github.com/repos/${SCORES_REPO}/issues`,
      {
        title: `score: ${imdbId}`,
        body: JSON.stringify({ imdbId, title, criticScores }, null, 2),
      },
      {
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      }
    );
    console.log(`[critic-scores] Submitted ${imdbId} to shared repo`);
  } catch (err) {
    console.error('[critic-scores] GitHub submit failed:', err.message);
  }
}

function upsertLocalScores(movieId, scores) {
  const upsert = db.prepare(`
    INSERT INTO critic_scores (movie_id, source, url, story, acting, direction, cinematography, production_design, editing, sound, emotional_impact, summary, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(movie_id, source) DO UPDATE SET
      url=excluded.url, story=excluded.story, acting=excluded.acting, direction=excluded.direction,
      cinematography=excluded.cinematography, production_design=excluded.production_design,
      editing=excluded.editing, sound=excluded.sound, emotional_impact=excluded.emotional_impact,
      summary=excluded.summary, scraped_at=excluded.scraped_at
  `);
  for (const s of scores) {
    upsert.run(
      movieId, s.source, s.url || '',
      s.scores.story, s.scores.acting, s.scores.direction, s.scores.cinematography,
      s.scores.productionDesign, s.scores.editing, s.scores.sound, s.scores.emotionalImpact,
      s.summary || ''
    );
  }
}

router.get('/:id/critic-scores', async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  // 1. Local SQLite cache
  const cached = db.prepare('SELECT * FROM critic_scores WHERE movie_id = ?').all(movie.id);
  if (cached.length > 0) {
    const freshEnough = cached.every(
      row => Date.now() - new Date(row.scraped_at).getTime() < CRITIC_CACHE_TTL
    );
    if (freshEnough) {
      return res.json({ criticScores: cached.map(rowToScore), fromCache: true });
    }
  }

  const title = movie.title_en || movie.title;
  if (!title) return res.json({ criticScores: [], error: 'No title' });

  // 2. Shared GitHub scores
  if (movie.imdb_id) {
    const shared = await fetchSharedScores(movie.imdb_id);
    if (shared) {
      upsertLocalScores(movie.id, shared);
      const rows = db.prepare('SELECT * FROM critic_scores WHERE movie_id = ?').all(movie.id);
      return res.json({ criticScores: rows.map(rowToScore), fromCache: true, source: 'github' });
    }
  }

  // 3. Scrape fresh
  try {
    const scores = await getCriticScores(title, movie.year);
    upsertLocalScores(movie.id, scores);

    // Share to GitHub (non-blocking)
    if (movie.imdb_id && scores.length > 0) {
      submitSharedScores(movie.imdb_id, title, scores).catch(() => {});
    }

    const updated = db.prepare('SELECT * FROM critic_scores WHERE movie_id = ?').all(movie.id);
    res.json({ criticScores: updated.map(rowToScore), fromCache: false });
  } catch (err) {
    console.error('[critic-scores] Scraping failed:', err.message);
    if (cached.length > 0) {
      return res.json({ criticScores: cached.map(rowToScore), fromCache: true });
    }
    res.status(500).json({ error: 'Failed to fetch critic scores' });
  }
});

function rowToScore(row) {
  return {
    source: row.source,
    url: row.url,
    scores: {
      story: row.story,
      acting: row.acting,
      direction: row.direction,
      cinematography: row.cinematography,
      productionDesign: row.production_design,
      editing: row.editing,
      sound: row.sound,
      emotionalImpact: row.emotional_impact,
    },
    summary: row.summary,
    scrapedAt: row.scraped_at,
  };
}

// Save torrent video to permanent offline storage
router.post('/:id/save-offline', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  if (!movie.torrent_magnet) return res.status(400).json({ error: 'No torrent magnet' });

  if (movie.offline_path && fs.existsSync(movie.offline_path)) {
    return res.json({ status: 'saved' });
  }

  const fileInfo = getFileInfo(movie.torrent_magnet);
  if (!fileInfo) return res.status(400).json({ error: 'No active torrent stream — start streaming first' });

  const ext = path.extname(fileInfo.filename) || '.mp4';
  const destPath = path.join(config.offlineDir, `${movie.id}${ext}`);
  fs.mkdirSync(config.offlineDir, { recursive: true });

  saveToOffline(movie.torrent_magnet, destPath)
    .then(() => {
      db.prepare('UPDATE movies SET offline_path = ? WHERE id = ?').run(destPath, movie.id);
      console.log(`[offline] Saved movie ${movie.id} to ${destPath}`);
    })
    .catch((err) => {
      console.error(`[offline] Save failed for movie ${movie.id}:`, err.message);
      try { fs.unlinkSync(destPath); } catch {}
    });

  res.json({ status: 'saving', size: fileInfo.size });
});

// Delete offline copy of a movie
router.delete('/:id/save-offline', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  if (movie.torrent_magnet) cancelSave(movie.torrent_magnet);

  if (movie.offline_path) {
    try { fs.unlinkSync(movie.offline_path); } catch {}
    db.prepare('UPDATE movies SET offline_path = NULL WHERE id = ?').run(movie.id);
  }
  res.json({ ok: true });
});

// Serve a subtitle file from the torrent as VTT
router.get('/:id/torrent-subtitle/:index', async (req, res) => {
  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  if (!movie?.torrent_magnet) return res.status(400).json({ error: 'No torrent' });

  try {
    const entry = await getVideoFile(movie.torrent_magnet);
    const idx = parseInt(req.params.index);
    const subFile = (entry.subtitleFiles || [])[idx];
    if (!subFile) return res.status(404).json({ error: 'Subtitle file not found' });

    // Read the full subtitle file
    const chunks = [];
    const stream = subFile.createReadStream();
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    let text = Buffer.concat(chunks).toString('utf-8');

    // Convert to VTT if needed
    const ext = subFile.name.split('.').pop().toLowerCase();
    if (ext === 'srt') {
      text = srtToVtt(text);
    } else if (ext !== 'vtt') {
      // For .ass/.ssa/.sub — just serve as-is, frontend won't parse them but at least they're available
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(text);
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('[torrent-subtitle] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Auto-sync subtitle against video audio using ffsubsync
router.post('/:id/subtitle-sync', async (req, res) => {
  const { subtitleUrl } = req.body;
  if (!subtitleUrl) return res.status(400).json({ error: 'Missing subtitleUrl' });

  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  if (!movie?.torrent_magnet) return res.status(400).json({ error: 'No torrent for this movie' });

  const tmpDir = os.tmpdir();
  const subIn = path.join(tmpDir, `sub_in_${req.params.id}_${Date.now()}.srt`);
  const subOut = path.join(tmpDir, `sub_out_${req.params.id}_${Date.now()}.srt`);

  const audioWav = path.join(tmpDir, `audio_${req.params.id}_${Date.now()}.wav`);

  try {
    // Fetch the subtitle content
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    const subUrl = subtitleUrl.startsWith('/') ? `${baseUrl}${subtitleUrl}` : subtitleUrl;
    const { data: vttText } = await (await import('axios')).default.get(subUrl, { responseType: 'text' });

    // ffsubsync works with SRT, convert VTT back to SRT-ish (just write as-is, ffsubsync handles both)
    fs.writeFileSync(subIn, vttText, 'utf-8');

    // ffsubsync cannot read HTTP URLs, so extract audio to a temp WAV first
    const videoUrl = `${baseUrl}/api/movies/${req.params.id}/stream`;
    const ffmpegPath = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
    const ffsubsyncPath = process.env.FFSUBSYNC_PATH || `${os.homedir()}/.local/bin/ffsubsync`;

    console.log('[subtitle-sync] Extracting audio via ffmpeg...');
    await execFileAsync(ffmpegPath, [
      '-i', videoUrl,
      '-vn',           // no video
      '-ac', '1',      // mono
      '-ar', '16000',  // 16kHz (sufficient for speech detection)
      '-t', '600',     // first 10 minutes is enough for sync detection
      '-f', 'wav',
      '-y',            // overwrite if exists
      audioWav,
    ], { timeout: 120000 });

    console.log('[subtitle-sync] Running ffsubsync...');
    const { stdout, stderr } = await execFileAsync(ffsubsyncPath, [
      audioWav,
      '-i', subIn,
      '-o', subOut,
      '--max-offset-seconds', '120',
      '--vad', 'auditok',
    ], { timeout: 120000 });

    console.log('[subtitle-sync] ffsubsync output:', stderr || stdout);

    if (!fs.existsSync(subOut)) {
      throw new Error('ffsubsync did not produce output');
    }

    const syncedText = fs.readFileSync(subOut, 'utf-8');
    const syncedVtt = syncedText.trimStart().startsWith('WEBVTT') ? syncedText : srtToVtt(syncedText);

    // Clean up temp files
    try { fs.unlinkSync(subIn); } catch {}
    try { fs.unlinkSync(subOut); } catch {}
    try { fs.unlinkSync(audioWav); } catch {}

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(syncedVtt);
  } catch (err) {
    console.error('[subtitle-sync] Error:', err.message);
    try { fs.unlinkSync(subIn); } catch {}
    try { fs.unlinkSync(subOut); } catch {}
    try { fs.unlinkSync(audioWav); } catch {}
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

// Whisper-based smart subtitle sync: extract audio snippet, transcribe, fuzzy-match subtitle cues
router.post('/:id/whisper-sync', async (req, res) => {
  const { currentTime, subtitleCues, subtitleLanguage } = req.body;

  if (typeof currentTime !== 'number') {
    return res.status(400).json({ error: 'Missing or invalid currentTime' });
  }
  if (!Array.isArray(subtitleCues) || subtitleCues.length === 0) {
    return res.status(400).json({ error: 'Missing or empty subtitleCues' });
  }
  if (currentTime < 10) {
    return res.status(400).json({ error: 'currentTime too early (< 10s) — not enough audio context' });
  }

  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  if (!movie?.torrent_magnet) return res.status(400).json({ error: 'No torrent for this movie' });

  const tmpDir = os.tmpdir();
  const chunkId = `${req.params.id}_${Date.now()}`;
  const audioWav = path.join(tmpDir, `whisper_chunk_${chunkId}.wav`);
  const whisperJsonFile = path.join(tmpDir, `whisper_chunk_${chunkId}.json`);

  const startTime = Math.max(0, currentTime - 30);
  const audioDuration = 60;

  try {
    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
    const videoUrl = `${baseUrl}/api/movies/${req.params.id}/stream`;
    const ffmpegPath = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
    const whisperPath = process.env.WHISPER_PATH || '/opt/homebrew/bin/whisper';

    console.log(`[whisper-sync] Extracting ${audioDuration}s audio at t=${startTime}s...`);
    await execFileAsync(ffmpegPath, [
      '-ss', String(startTime),
      '-i', videoUrl,
      '-t', String(audioDuration),
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      '-y',
      audioWav,
    ], { timeout: 60000 });

    // Determine if we need translation (subtitle language != spoken language)
    // We'll run Whisper twice if needed: once to detect language, then with --task translate
    const subLangLabel = (subtitleLanguage || 'English').toLowerCase();
    const langLabelToCode = { english: 'en', japanese: 'ja', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', chinese: 'zh', korean: 'ko', arabic: 'ar', russian: 'ru', hebrew: 'he', dutch: 'nl', polish: 'pl', turkish: 'tr', swedish: 'sv', norwegian: 'no', danish: 'da', finnish: 'fi', czech: 'cs', romanian: 'ro', hungarian: 'hu', greek: 'el', thai: 'th', vietnamese: 'vi', indonesian: 'id', malay: 'ms', hindi: 'hi' };
    const subLangCode = langLabelToCode[subLangLabel] || subLangLabel;

    // Use --task translate to get English output from any language (Whisper translates to English natively)
    // If subtitles are in English, this gives us a direct match
    // If subtitles are non-English, we do normal transcription and match in the original language
    const useTranslate = subLangCode === 'en';

    console.log(`[whisper-sync] Running Whisper ${useTranslate ? 'translate (→ English)' : 'transcribe'} on 1 minute chunk...`);
    await execFileAsync(whisperPath, [
      audioWav,
      '--model', 'base',
      ...(useTranslate ? ['--task', 'translate'] : []),
      '--output_format', 'json',
      '--output_dir', tmpDir,
    ], { timeout: 120000 });

    if (!fs.existsSync(whisperJsonFile)) {
      throw new Error('Whisper did not produce output JSON');
    }

    const whisperResult = JSON.parse(fs.readFileSync(whisperJsonFile, 'utf-8'));
    const whisperSegments = whisperResult.segments || [];
    const detectedLanguage = whisperResult.language || 'en';

    if (whisperSegments.length === 0) {
      return res.status(422).json({ error: 'No speech detected in audio snippet' });
    }

    // Combine all whisper segments into one transcript with timestamps
    const whisperTranscript = whisperSegments.map(s => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    const fullWhisperText = whisperTranscript.map(s => s.text).join(' ');
    console.log(`[whisper-sync] Detected language: ${detectedLanguage}, transcript: "${fullWhisperText.substring(0, 100)}..."`);

    // Map common language labels to ISO codes for comparison
        // Whisper already translates to English via --task translate when needed
    // No external API calls required

    // Normalize text for fuzzy matching
    function normalizeText(text) {
      return text.toLowerCase().replace(/[^a-z0-9\s\u0080-\uffff]/g, '').replace(/\s+/g, ' ').trim();
    }

    function wordOverlapScore(a, b) {
      const wordsA = a.split(' ').filter(Boolean);
      const wordsB = new Set(b.split(' ').filter(Boolean));
      if (wordsA.length === 0 || wordsB.size === 0) return 0;
      const overlap = wordsA.filter(w => wordsB.has(w)).length;
      return overlap / Math.max(wordsA.length, wordsB.size);
    }

    // Find best-matching (segment, subtitleCue) pair
    let bestScore = 0;
    let bestSegment = null;
    let bestSubCue = null;

    for (const seg of whisperTranscript) {
      const normSeg = normalizeText(seg.text);
      for (const cue of subtitleCues) {
        const normCue = normalizeText(cue.text);
        const score = wordOverlapScore(normSeg, normCue);
        if (score > bestScore) {
          bestScore = score;
          bestSegment = seg;
          bestSubCue = cue;
        }
      }
    }

    if (!bestSegment || bestScore < 0.2) {
      return res.status(422).json({ 
        error: `No subtitle match found (best score: ${bestScore.toFixed(2)})`,
        whisperText: fullWhisperText.substring(0, 200),
        detectedLanguage,
      });
    }

    // Calculate offset
    const spokenAtVideoTime = startTime + bestSegment.start;
    const offset = spokenAtVideoTime - bestSubCue.start;

    console.log(`[whisper-sync] Match: "${bestSegment.text}" → "${bestSubCue.text}" | offset=${offset.toFixed(2)}s confidence=${bestScore.toFixed(2)}`);

    res.json({
      offset: Math.round(offset * 10) / 10,
      confidence: Math.round(bestScore * 100) / 100,
      whisperText: fullWhisperText.substring(0, 200),
      matchedCue: bestSubCue.text,
      matchedCueTime: bestSubCue.start,
      detectedLanguage,
      usedTranslation: useTranslate,
    });
  } catch (err) {
    console.error('[whisper-sync] Error:', err.message);
    res.status(500).json({ error: `Whisper sync failed: ${err.message}` });
  } finally {
    try { fs.unlinkSync(audioWav); } catch {}
    try { fs.unlinkSync(whisperJsonFile); } catch {}
  }
});

// ============================================================
// Hdrezka Stream Extraction
// ============================================================

router.get('/:id/hdrezka-stream', async (req, res) => {
  try {
    // Check DB cache first
    const cached = db.prepare('SELECT cached_stream_url, stream_cached_at, title FROM movies WHERE id = ?').get(req.params.id);
    if (cached?.cached_stream_url) {
      return res.json({ streamUrl: cached.cached_stream_url, title: cached.title, cached: true });
    }
    const { extractHdrezkaStream } = await import('../services/hdrezka-extractor.js');
    const result = await extractHdrezkaStream(req.params.id);
    // Store in DB
    db.prepare('UPDATE movies SET cached_stream_url = ?, stream_cached_at = ? WHERE id = ?')
      .run(result.streamUrl, Date.now(), req.params.id);
    res.json({ streamUrl: result.streamUrl, title: result.title });
  } catch (err) {
    console.error('[hdrezka-stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Filmix Stream Extraction
// ============================================================

router.get('/:id/filmix-stream', async (req, res) => {
  try {
    const cached = db.prepare('SELECT cached_stream_url, stream_cached_at, title FROM movies WHERE id = ?').get(req.params.id);
    if (cached?.cached_stream_url) {
      return res.json({ streamUrl: cached.cached_stream_url, title: cached.title, cached: true });
    }
    const { extractFilmixStream } = await import('../services/filmix-extractor.js');
    const result = await extractFilmixStream(req.params.id);
    db.prepare('UPDATE movies SET cached_stream_url = ?, stream_cached_at = ? WHERE id = ?')
      .run(result.streamUrl, Date.now(), req.params.id);
    res.json({ streamUrl: result.streamUrl, title: result.title });
  } catch (err) {
    console.error('[filmix-stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Seazonvar Stream Extraction
// ============================================================

router.get('/:id/seazonvar-stream', async (req, res) => {
  try {
    const { extractSeazonvarStream } = await import('../services/seazonvar-extractor.js');
    const result = await extractSeazonvarStream(req.params.id);
    res.json({ streamUrl: result.streamUrl, title: result.title });
  } catch (err) {
    console.error('[seazonvar-stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 123movies Embed Player
// ============================================================

// Get embed iframe URL from 123movies (same iframe the site loads)
router.get('/:id/123embed', async (req, res) => {
  const server = parseInt(req.query.server) || 2;

  try {
    const result = await extractEmbedUrl(req.params.id, server);
    res.json({
      embedUrl: result.embedUrl,
      server: result.server,
      servers: getAvailableServers(),
    });
  } catch (err) {
    console.error('[123embed] Extraction error:', err.message);
    if (err.message === 'Movie not found') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to extract embed: ' + err.message });
  }
});

// Get available subtitle tracks for a movie (from OpenSubtitles by IMDB ID)
router.get('/:id/subtitles', async (req, res) => {
  try {
    const movie = db.prepare('SELECT imdb_id FROM movies WHERE id = ?').get(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });

    const tracks = req.query.filename
      ? await fetchSubtitlesByFilename(req.params.id, req.query.filename)
      : await fetchSubtitles(req.params.id);

    // Return tracks with proxied URLs to avoid CORS issues
    const proxied = tracks.map((t) => ({
      language: t.language,
      label: t.label,
      files: t.files.map(f => ({
        filename: f.filename,
        url: `/api/movies/${req.params.id}/subtitle-proxy?url=${encodeURIComponent(f.url)}`,
        downloads: f.downloads,
      })),
    }));

    res.json({ tracks: proxied });
  } catch (err) {
    console.error('[subtitles] Route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Proxy external subtitle files, converting SRT/SRT.GZ to VTT on the fly
router.get('/:id/subtitle-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  if (!isAllowedProxyUrl(url)) {
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch {}
    console.error('[subtitle-proxy] Blocked SSRF attempt to:', hostname || url.substring(0, 60));
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const vttText = await fetchAndConvertSubtitle(url);
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(vttText);
  } catch (err) {
    console.error('[subtitle-proxy] Error:', err.message);
    res.status(502).json({ error: 'Subtitle fetch failed: ' + err.message });
  }
});

export default router;
