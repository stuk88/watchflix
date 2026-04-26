import cron from 'node-cron';
import { scrape123Movies } from '../scrapers/123movies.js';
import { scrapeTorrents } from '../scrapers/torrents.js';
import { scrapeHdrezka } from '../scrapers/hdrezka.js';
import { scrapeSeazonvar } from '../scrapers/seazonvar.js';
import { scrapeFilmix } from '../scrapers/filmix.js';
import db from '../db.js';

export function startScheduler() {
  // Check if DB is empty → bootstrap
  const count = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;
  if (count === 0) {
    console.log('[scheduler] DB empty, running initial scrape...');
    runFullScrape();
  }

  // Daily at 3 AM
  cron.schedule('0 3 * * *', () => {
    console.log('[scheduler] Daily scrape starting...');
    runFullScrape();
  });

  console.log('[scheduler] Cron scheduled: daily at 3:00 AM');
}

export async function runFullScrape() {
  try {
    const t1 = await scrapeTorrents(3);
    const t2 = await scrape123Movies(3);

    // Russian sources (run in parallel)
    const [r1, r2, r3] = await Promise.allSettled([
      scrapeHdrezka(3),
      scrapeSeazonvar(3),
      scrapeFilmix(3),
    ]);
    const hdrezka = r1.status === 'fulfilled' ? r1.value : 0;
    const seazonvar = r2.status === 'fulfilled' ? r2.value : 0;
    const filmix = r3.status === 'fulfilled' ? r3.value : 0;

    console.log(`[scheduler] Full scrape done. Torrents: ${t1}, 123movies: ${t2}, Hdrezka: ${hdrezka}, Seazonvar: ${seazonvar}, Filmix: ${filmix}`);
    return { torrents: t1, movies123: t2, hdrezka, seazonvar, filmix };
  } catch (err) {
    console.error('[scheduler] Scrape failed:', err.message);
    throw err;
  }
}
