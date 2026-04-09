/**
 * Retry stream extraction with backoff. Checks if Hdrezka is accessible
 * before starting a batch, backs off if blocked.
 *
 * Run: node api/batch-extract-retry.mjs
 */
import { chromium } from 'playwright-core';
import db from './src/db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CONCURRENCY = 5;
const BATCH_SIZE = 50; // extract 50 then pause
const PAUSE_MS = 60_000; // 1 min pause between batches
const BACKOFF_MS = 300_000; // 5 min backoff if blocked

const updateStmt = db.prepare('UPDATE movies SET cached_stream_url = ?, stream_cached_at = ? WHERE id = ?');

async function isAccessible(browser) {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    await page.goto('https://hdrezka.ag/films/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const items = await page.$$('.b-content__inline_item');
    await page.close(); await ctx.close();
    return items.length > 0;
  } catch {
    await page.close().catch(() => {}); await ctx.close().catch(() => {});
    return false;
  }
}

async function extractOne(browser, movie) {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    await page.goto(movie.source_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    if (movie.type === 'series' && movie.season && movie.episode) {
      const sTab = await page.$(`.b-simple_season__item[data-tab_id="${movie.season}"]`);
      if (sTab) { await sTab.click(); await page.waitForTimeout(1000); }
      const eTab = await page.$(`.b-simple_episodes__list li[data-season_id="${movie.season}"][data-episode_id="${movie.episode}"]`);
      if (eTab) { await eTab.click(); await page.waitForTimeout(2000); }
    }
    const url = await page.evaluate(() => {
      const v = document.querySelector('video');
      return (v?.src && (v.src.includes('.m3u8') || v.src.includes('.mp4'))) ? v.src : null;
    });
    await page.close(); await ctx.close();
    return url;
  } catch {
    await page.close().catch(() => {}); await ctx.close().catch(() => {});
    return null;
  }
}

async function run() {
  const browser = await chromium.launch({
    executablePath: BROWSER_PATH, headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  while (true) {
    // Get remaining movies
    const movies = db.prepare(`
      SELECT DISTINCT source_url, MIN(id) as id, title, source, type, season, episode
      FROM movies WHERE source = 'hdrezka' AND source_url IS NOT NULL
      AND (cached_stream_url IS NULL OR cached_stream_url = '')
      GROUP BY source_url LIMIT ?
    `).all(BATCH_SIZE);

    if (movies.length === 0) {
      console.log('All done!');
      break;
    }

    // Check accessibility
    const ok = await isAccessible(browser);
    if (!ok) {
      console.log(`Blocked. Backing off ${BACKOFF_MS/1000}s...`);
      await new Promise(r => setTimeout(r, BACKOFF_MS));
      continue;
    }

    console.log(`Extracting batch of ${movies.length}...`);
    let extracted = 0;

    for (let i = 0; i < movies.length; i += CONCURRENCY) {
      const batch = movies.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(m => extractOne(browser, m)));

      const now = Date.now();
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value) {
          const movie = batch[j];
          const siblings = db.prepare('SELECT id FROM movies WHERE source_url = ? AND source = ?').all(movie.source_url, movie.source);
          for (const s of siblings) updateStmt.run(r.value, now, s.id);
          extracted++;
        }
      }
    }

    const total = db.prepare("SELECT COUNT(*) as c FROM movies WHERE source = 'hdrezka' AND cached_stream_url IS NOT NULL").get().c;
    console.log(`Batch done: +${extracted} | Total cached: ${total} | Pausing ${PAUSE_MS/1000}s...`);
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
