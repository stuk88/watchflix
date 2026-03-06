import { Router } from 'express';
import axios from 'axios';
import db from '../db.js';
import { makeMagnet } from '../scrapers/torrents.js';

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

  if (alternatives.length === 0) {
    return res.json({ alternatives: [], dead: true });
  }

  // Sort by seeds descending
  alternatives.sort((a, b) => b.seeds - a.seeds);
  res.json({ alternatives });
});

// Delete a movie from DB
router.delete('/:id', (req, res) => {
  const movie = db.prepare('SELECT id FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  db.prepare('DELETE FROM movies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
