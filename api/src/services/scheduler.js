import cron from 'node-cron';
import { scrape123Movies } from '../scrapers/123movies.js';
import { scrapeTorrents } from '../scrapers/torrents.js';
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
    console.log(`[scheduler] Full scrape done. Torrents: ${t1}, 123movies: ${t2}`);
    return { torrents: t1, movies123: t2 };
  } catch (err) {
    console.error('[scheduler] Scrape failed:', err.message);
    throw err;
  }
}
