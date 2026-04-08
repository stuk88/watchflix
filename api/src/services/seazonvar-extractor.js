import { chromium } from 'playwright-core';
import db from '../db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache: movieId -> { streamUrl, expiry }
const cache = new Map();
const CACHE_TTL = 20 * 60 * 1000; // 20 min

/**
 * Check whether Seazonvar (seasonvar.org) is currently online.
 * The site has been showing "Сайт временно отключен" (site temporarily disabled)
 * since at least early 2026. This probe detects that offline page.
 *
 * Returns true if the site appears functional, false otherwise.
 */
async function isSeazonvarOnline() {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    await page.goto('https://seasonvar.org', { waitUntil: 'domcontentloaded', timeout: 15000 });

    const isOffline = await page.evaluate(() => {
      const title = document.title || '';
      const body = document.body?.innerText || '';
      return title.includes('отключен') || body.includes('временно отключен');
    });

    await page.close();
    await context.close();
    await browser.close();

    return !isOffline;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    // Network error or timeout also means inaccessible
    return false;
  }
}

/**
 * Extract HLS stream URL from a Seazonvar series page via Playwright.
 * Returns { streamUrl, title } or throws.
 *
 * STATUS (April 2026): Seazonvar is offline ("Сайт временно отключен").
 * The extraction logic below is a scaffold ready for when the site returns.
 * Until then, the function throws an informative error.
 */
export async function extractSeazonvarStream(movieId) {
  const cached = cache.get(movieId);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT source_url, title, type, season, episode FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');
  if (!movie.source_url) throw new Error('No source URL');

  console.log(`[seazonvar-extractor] Extracting stream for "${movie.title}" from ${movie.source_url}`);

  // Check site availability before launching a full browser session
  const online = await isSeazonvarOnline();
  if (!online) {
    throw new Error(
      'Seazonvar is currently unavailable (site displays "temporarily disabled"). ' +
      'The extractor is ready and will work once the site comes back online.'
    );
  }

  // ---- Live extraction logic (runs only when site is back online) ----
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    await page.goto(movie.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Seazonvar embeds a player via an iframe or direct <video> element.
    // If this is a specific episode, navigate to the correct season/episode.
    if (movie.type === 'series' && movie.season && movie.episode) {
      try {
        // Seazonvar uses season tabs and episode list items
        const seasonTab = await page.$(`.tabs-b a[data-season="${movie.season}"], .pgs-s498 a:has-text("${movie.season}")`);
        if (seasonTab) {
          await seasonTab.click();
          await page.waitForTimeout(1500);
        }
        const episodeLink = await page.$(`.ep${movie.episode}, a:has-text("${movie.episode} серия")`);
        if (episodeLink) {
          await episodeLink.click();
          await page.waitForTimeout(2000);
        }
      } catch (err) {
        console.log(`[seazonvar-extractor] Episode selection failed (S${movie.season}E${movie.episode}):`, err.message);
      }
    }

    // Intercept network requests to catch the HLS manifest
    let hlsUrl = null;

    // Method 1: Check for .m3u8 in existing network activity via page evaluation
    hlsUrl = await page.evaluate(() => {
      // Check for video element with HLS src
      const video = document.querySelector('video');
      if (video?.src && video.src.includes('.m3u8')) return video.src;

      // Check the player iframe
      const iframe = document.querySelector('#player iframe, .player iframe, iframe[src*="season"]');
      if (iframe?.src) return iframe.src;

      // Check for direct source elements
      const source = document.querySelector('video source[src*=".m3u8"]');
      if (source?.src) return source.src;

      return video?.src || null;
    });

    // Method 2: If no direct URL found, click play and listen for network requests
    if (!hlsUrl) {
      const m3u8Promise = page.waitForResponse(
        resp => resp.url().includes('.m3u8') && resp.status() === 200,
        { timeout: 10000 }
      ).catch(() => null);

      // Try clicking a play button
      const playBtn = await page.$('.play-btn, .btn-play, .player-play, [class*="play"]');
      if (playBtn) {
        await playBtn.click();
        const m3u8Response = await m3u8Promise;
        if (m3u8Response) {
          hlsUrl = m3u8Response.url();
        }
      }
    }

    await page.close();
    await context.close();
    await browser.close();

    if (!hlsUrl) throw new Error('Could not extract stream URL from Seazonvar');

    const result = { streamUrl: hlsUrl, title: movie.title, expiry: Date.now() + CACHE_TTL };
    cache.set(movieId, result);
    console.log(`[seazonvar-extractor] Got stream: ${hlsUrl.substring(0, 80)}...`);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}
