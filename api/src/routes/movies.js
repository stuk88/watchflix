import { Router } from 'express';
import axios from 'axios';
import db from '../db.js';
import { makeMagnet } from '../scrapers/torrents.js';
import { getVideoFile, getStats } from '../services/streamer.js';
import { extractStreamUrl, getAvailableServers } from '../services/stream-extractor.js';
import { fetchSubtitles, fetchSubtitlesByFilename, fetchAndConvertSubtitle } from '../services/subtitles.js';

const router = Router();

// List movies with pagination, sort, filter
router.get('/', (req, res) => {
  const {
    page = 1,
    limit = 40,
    sort = 'added_at',
    order = 'desc',
    genre,
    source,
    min_rating,
    search,
    favorites,
    show_hidden,
    only_hidden,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [];
  const params = {};

  if (genre) {
    conditions.push("genre LIKE @genre");
    params.genre = `%${genre}%`;
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
    conditions.push("imdb_rating >= @min_rating");
    params.min_rating = parseFloat(min_rating);
  }
  if (search) {
    conditions.push("(title LIKE @search OR actors LIKE @search OR director LIKE @search)");
    params.search = `%${search}%`;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const allowedSorts = ['added_at', 'imdb_rating', 'title', 'year'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'added_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) as c FROM movies ${where}`).get(params).c;
  const movies = db.prepare(
    `SELECT * FROM movies ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: parseInt(limit), offset });

  res.json({
    movies,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
  });
});

// Get single movie
router.get('/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
});

// Toggle favorite
router.patch('/:id/favorite', (req, res) => {
  const movie = db.prepare('SELECT id, is_favorite FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const newVal = movie.is_favorite ? 0 : 1;
  db.prepare('UPDATE movies SET is_favorite = ? WHERE id = ?').run(newVal, movie.id);
  res.json({ id: movie.id, is_favorite: newVal });
});

// Toggle hidden
router.patch('/:id/hide', (req, res) => {
  const movie = db.prepare('SELECT id, is_hidden FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const newVal = movie.is_hidden ? 0 : 1;
  db.prepare('UPDATE movies SET is_hidden = ? WHERE id = ?').run(newVal, movie.id);
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
  const deduped = [...byHash.values()];

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

// Stream torrent video via server-side WebTorrent (HTTP range support)
router.get('/:id/stream', async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  if (!movie.torrent_magnet) return res.status(400).json({ error: 'No torrent magnet' });

  try {
    const { file } = await getVideoFile(movie.torrent_magnet);
    const fileSize = file.length;

    // Content-Type based on extension
    const ext = file.name.split('.').pop().toLowerCase();
    const mimeTypes = { mp4: 'video/mp4', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
    const contentType = mimeTypes[ext] || 'video/mp4';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
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

// Get torrent streaming stats
router.get('/:id/stream-stats', (req, res) => {
  const movie = db.prepare('SELECT torrent_magnet FROM movies WHERE id = ?').get(req.params.id);
  if (!movie?.torrent_magnet) return res.json({ peers: 0 });
  const stats = getStats(movie.torrent_magnet);
  res.json(stats || { peers: 0 });
});

// ============================================================
// 123movies Direct Streaming (HLS extraction)
// ============================================================

// Get HLS stream URL from 123movies embed
router.get('/:id/123stream', async (req, res) => {
  const server = parseInt(req.query.server) || 2;

  try {
    const result = await extractStreamUrl(req.params.id, server);
    res.json({
      m3u8: `/api/movies/${req.params.id}/123proxy?url=${encodeURIComponent(result.m3u8)}`,
      subtitles: result.subtitles,
      servers: getAvailableServers(),
    });
  } catch (err) {
    console.error('[123stream] Extraction error:', err.message);
    res.status(500).json({ error: 'Failed to extract stream: ' + err.message });
  }
});

// Proxy HLS playlist/segments (avoid CORS issues)
router.get('/:id/123proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  // Reject non-HTTP URLs early to avoid cryptic "Invalid URL" errors
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.error('[123proxy] Invalid URL (not http/https):', url.substring(0, 100));
    return res.status(400).json({ error: 'Invalid URL: must be http(s)' });
  }

  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://embos.net/',
        'Origin': 'https://embos.net',
      },
    });

    // Set appropriate content type
    const contentType = url.includes('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : url.includes('.ts')
        ? 'video/mp2t'
        : response.headers['content-type'] || 'application/octet-stream';

    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');

    // For m3u8 playlists, rewrite segment URLs to go through our proxy
    if (url.includes('.m3u8')) {
      let playlist = Buffer.from(response.data).toString('utf8');
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

      // Rewrite relative URLs in the playlist
      playlist = playlist.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
        const absoluteUrl = match.startsWith('http') ? match : baseUrl + match;
        return `/api/movies/${req.params.id}/123proxy?url=${encodeURIComponent(absoluteUrl)}`;
      });

      // Also rewrite .m3u8 references (for multi-quality master playlists)
      playlist = playlist.replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
        const absoluteUrl = match.startsWith('http') ? match : baseUrl + match;
        return `/api/movies/${req.params.id}/123proxy?url=${encodeURIComponent(absoluteUrl)}`;
      });

      res.send(playlist);
    } else {
      res.send(Buffer.from(response.data));
    }
  } catch (err) {
    console.error('[123proxy] Error:', err.message);
    res.status(502).json({ error: 'Proxy fetch failed' });
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
      url: `/api/movies/${req.params.id}/subtitle-proxy?url=${encodeURIComponent(t.url)}`,
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
