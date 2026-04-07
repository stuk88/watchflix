import { chromium } from 'playwright-core';
import db from '../db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache: movieId -> { streamUrl, expiry }
const cache = new Map();
const CACHE_TTL = 20 * 60 * 1000; // 20 min

/**
 * Extract HLS stream URL from a Hdrezka movie/series page via Playwright.
 * Returns { streamUrl, title } or throws.
 */
export async function extractHdrezkaStream(movieId) {
  const cached = cache.get(movieId);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT source_url, title, type, season, episode FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');
  if (!movie.source_url) throw new Error('No source URL');

  console.log(`[hdrezka-extractor] Extracting stream for "${movie.title}" from ${movie.source_url}`);

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

    // If this is a specific episode, click the right season/episode
    if (movie.type === 'series' && movie.season && movie.episode) {
      try {
        // Click season tab
        const seasonTab = await page.$(`.b-simple_season__item[data-tab_id="${movie.season}"]`);
        if (seasonTab) {
          await seasonTab.click();
          await page.waitForTimeout(1000);
        }
        // Click episode
        const episodeTab = await page.$(`.b-simple_episodes__list li[data-season_id="${movie.season}"][data-episode_id="${movie.episode}"]`);
        if (episodeTab) {
          await episodeTab.click();
          await page.waitForTimeout(2000);
        }
      } catch (err) {
        console.log(`[hdrezka-extractor] Episode selection failed (S${movie.season}E${movie.episode}):`, err.message);
      }
    }

    // Extract the video source — Hdrezka loads an HLS stream into the player
    const streamUrl = await page.evaluate(() => {
      // Check for video element with HLS src
      const video = document.querySelector('video');
      if (video?.src && video.src.includes('.m3u8')) return video.src;

      // Check for CDN player data attributes
      const player = document.querySelector('#cdnplayer, .b-player');
      if (!player) return null;

      // The stream URL is often in the video element after player initialization
      const iframe = player.querySelector('iframe');
      if (iframe?.src) return iframe.src;

      // Check for direct video source
      const source = player.querySelector('source');
      if (source?.src) return source.src;

      return video?.src || null;
    });

    await page.close();
    await context.close();
    await browser.close();

    if (!streamUrl) throw new Error('Could not extract stream URL');

    const result = { streamUrl, title: movie.title, expiry: Date.now() + CACHE_TTL };
    cache.set(movieId, result);
    console.log(`[hdrezka-extractor] Got stream: ${streamUrl.substring(0, 80)}...`);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}
