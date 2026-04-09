/**
 * Batch extract stream URLs for all Russian movies using Playwright.
 * Uses parallel browser tabs for efficiency.
 *
 * Run: node api/batch-extract-streams.mjs [--concurrency=5] [--source=hdrezka|filmix]
 */
import { chromium } from 'playwright-core';
import db from './src/db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const args = process.argv.slice(2);
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1]) || 5;
const SOURCE_FILTER = args.find(a => a.startsWith('--source='))?.split('=')[1] || null;

const updateStmt = db.prepare('UPDATE movies SET cached_stream_url = ?, stream_cached_at = ? WHERE id = ?');

async function extractStreamFromPage(page, movie) {
  try {
    await page.goto(movie.source_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    // For series with specific episodes, click the right one
    if (movie.type === 'series' && movie.season && movie.episode) {
      try {
        const seasonTab = await page.$(`.b-simple_season__item[data-tab_id="${movie.season}"]`);
        if (seasonTab) { await seasonTab.click(); await page.waitForTimeout(1000); }
        const epTab = await page.$(`.b-simple_episodes__list li[data-season_id="${movie.season}"][data-episode_id="${movie.episode}"]`);
        if (epTab) { await epTab.click(); await page.waitForTimeout(2000); }
      } catch {}
    }

    const streamUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (video?.src && (video.src.includes('.m3u8') || video.src.includes('.mp4'))) return video.src;
      const source = document.querySelector('video source');
      if (source?.src) return source.src;
      return video?.src || null;
    });

    return streamUrl;
  } catch (err) {
    return null;
  }
}

async function run() {
  // Get all Russian movies without cached stream URLs
  let sourceCondition = "source IN ('hdrezka', 'filmix')";
  if (SOURCE_FILTER) sourceCondition = `source = '${SOURCE_FILTER}'`;

  const movies = db.prepare(`
    SELECT DISTINCT id, title, source, source_url, type, season, episode
    FROM movies
    WHERE ${sourceCondition}
    AND source_url IS NOT NULL
    AND (cached_stream_url IS NULL OR cached_stream_url = '')
    ORDER BY source, added_at DESC
  `).all();

  // For series with same source_url, only extract once (episodes share the page)
  const uniqueByUrl = new Map();
  for (const m of movies) {
    if (!uniqueByUrl.has(m.source_url)) {
      uniqueByUrl.set(m.source_url, m);
    }
  }
  const uniqueMovies = [...uniqueByUrl.values()];

  console.log(`Batch stream extraction: ${uniqueMovies.length} unique pages (${movies.length} total movies)`);
  console.log(`Concurrency: ${CONCURRENCY} | Source: ${SOURCE_FILTER || 'all'}\n`);

  if (uniqueMovies.length === 0) {
    console.log('Nothing to extract.');
    return;
  }

  const browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  let extracted = 0, failed = 0, total = uniqueMovies.length;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < uniqueMovies.length; i += CONCURRENCY) {
    const batch = uniqueMovies.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (movie) => {
        const context = await browser.newContext({ userAgent: UA });
        const page = await context.newPage();
        const streamUrl = await extractStreamFromPage(page, movie);
        await page.close();
        await context.close();
        return { movie, streamUrl };
      })
    );

    const now = Date.now();
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.streamUrl) {
        const { movie, streamUrl } = r.value;
        // Update all movies with same source_url
        const siblings = db.prepare('SELECT id FROM movies WHERE source_url = ? AND source = ?').all(movie.source_url, movie.source);
        for (const s of siblings) {
          updateStmt.run(streamUrl, now, s.id);
        }
        extracted++;
      } else {
        failed++;
      }
    }

    const done = Math.min(i + CONCURRENCY, total);
    if (done % 50 === 0 || done === total) {
      console.log(`${done}/${total} | extracted: ${extracted} | failed: ${failed}`);
    }
  }

  await browser.close();

  const cachedCount = db.prepare("SELECT COUNT(*) as c FROM movies WHERE cached_stream_url IS NOT NULL AND cached_stream_url != ''").get().c;
  console.log(`\nDone. Cached streams in DB: ${cachedCount}`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
