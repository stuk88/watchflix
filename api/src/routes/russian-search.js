import { Router } from 'express';
import { searchHdrezka } from '../scrapers/hdrezka.js';
import { searchSeazonvar } from '../scrapers/seazonvar.js';
import { searchFilmix } from '../scrapers/filmix.js';
import db from '../db.js';

const router = Router();

// Search all Russian sources in parallel
router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query too short (min 2 chars)' });
  }

  const query = q.trim();
  console.log(`[russian-search] Searching: "${query}"`);

  // Search all three sources in parallel
  const [hdrezkaResults, seazonvarResults, filmixResults] = await Promise.allSettled([
    searchHdrezka(query),
    searchSeazonvar(query),
    searchFilmix(query),
  ]);

  const results = [
    ...(hdrezkaResults.status === 'fulfilled' ? hdrezkaResults.value : []),
    ...(seazonvarResults.status === 'fulfilled' ? seazonvarResults.value : []),
    ...(filmixResults.status === 'fulfilled' ? filmixResults.value : []),
  ];

  // Check which are already in library
  const enriched = results.map(r => {
    const existing = db.prepare(
      'SELECT id FROM movies WHERE source_url = ? AND source = ?'
    ).get(r.url, r.source);
    return { ...r, inLibrary: !!existing, libraryId: existing?.id || null };
  });

  res.json({ results: enriched, total: enriched.length });
});

// Add a Russian search result to the library
router.post('/add', (req, res) => {
  const { title, year, url, poster, type, source } = req.body;
  if (!title || !url || !source) {
    return res.status(400).json({ error: 'Missing required fields: title, url, source' });
  }

  const validSources = ['hdrezka', 'seazonvar', 'filmix'];
  if (!validSources.includes(source)) {
    return res.status(400).json({ error: 'Invalid source' });
  }

  // Check if already exists
  const existing = db.prepare('SELECT id FROM movies WHERE source_url = ? AND source = ?').get(url, source);
  if (existing) {
    return res.json({ id: existing.id, alreadyExists: true });
  }

  const result = db.prepare(`
    INSERT INTO movies (title, year, poster, source, source_url, language, type)
    VALUES (@title, @year, @poster, @source, @source_url, @language, @type)
  `).run({
    title,
    year: year || null,
    poster: poster || null,
    source,
    source_url: url,
    language: 'ru',
    type: type || 'movie',
  });

  res.json({ id: result.lastInsertRowid, alreadyExists: false });
});

export default router;
