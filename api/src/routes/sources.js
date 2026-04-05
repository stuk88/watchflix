import { Router } from 'express';
import { scrape123Movies } from '../scrapers/123movies.js';
import { scrapeTorrents } from '../scrapers/torrents.js';
import { scrapeHdrezka } from '../scrapers/hdrezka.js';
import { scrapeSeazonvar } from '../scrapers/seazonvar.js';
import { scrapeFilmix } from '../scrapers/filmix.js';
import { runFullScrape } from '../services/scheduler.js';
import db from '../db.js';

const router = Router();
let scraping = false;

router.post('/all', async (req, res) => {
  if (scraping) return res.status(409).json({ error: 'Scrape already in progress' });
  scraping = true;
  try {
    const result = await runFullScrape();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

router.post('/123movies', async (req, res) => {
  if (scraping) return res.status(409).json({ error: 'Scrape already in progress' });
  scraping = true;
  try {
    const count = await scrape123Movies(req.body?.pages || 3);
    res.json({ ok: true, saved: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

router.post('/torrents', async (req, res) => {
  if (scraping) return res.status(409).json({ error: 'Scrape already in progress' });
  scraping = true;
  try {
    const count = await scrapeTorrents(req.body?.pages || 3);
    res.json({ ok: true, saved: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

// Scrape all Russian sources
router.post('/russian', async (req, res) => {
  if (scraping) return res.status(409).json({ error: 'Scrape already in progress' });
  scraping = true;
  try {
    const pages = req.body?.pages || 3;
    const [hdrezka, seazonvar, filmix] = await Promise.allSettled([
      scrapeHdrezka(pages),
      scrapeSeazonvar(pages),
      scrapeFilmix(pages),
    ]);
    res.json({
      ok: true,
      hdrezka: hdrezka.status === 'fulfilled' ? hdrezka.value : 0,
      seazonvar: seazonvar.status === 'fulfilled' ? seazonvar.value : 0,
      filmix: filmix.status === 'fulfilled' ? filmix.value : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    scraping = false;
  }
});

router.get('/status', (req, res) => {
  const lastScrape = db.prepare('SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 1').get();
  const totalMovies = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;
  res.json({ scraping, lastScrape, totalMovies });
});

export default router;
