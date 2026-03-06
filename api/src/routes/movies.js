import { Router } from 'express';
import db from '../db.js';

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

// Update last watched
router.patch('/:id/watched', (req, res) => {
  db.prepare('UPDATE movies SET last_watched = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
