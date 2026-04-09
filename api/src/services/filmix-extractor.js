import { chromium } from 'playwright-core';
import db from '../db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache: movieId -> { streamUrl, title, expiry }
const cache = new Map();
const CACHE_TTL = 20 * 60 * 1000; // 20 min

// Preferred quality order (highest first). Non-PRO accounts are limited to 480p
// but we still attempt higher in case the session has access.
const QUALITY_PREFERENCE = ['1080p', '720p', '480p'];

/**
 * Extract a direct MP4 stream URL from a Filmix movie page via Playwright.
 *
 * Filmix uses an inline PJS player that loads an MP4 from werkecdn.me.
 * The player-data API returns an obfuscated payload, but the simplest
 * extraction is to read `video.src` from the DOM after the player inits.
 *
 * Returns { streamUrl, title } or throws.
 */
export async function extractFilmixStream(movieId) {
  const cached = cache.get(movieId);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT source_url, title, type, season, episode FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');
  if (!movie.source_url) throw new Error('No source URL');

  console.log(`[filmix-extractor] Extracting stream for "${movie.title}" from ${movie.source_url}`);

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
    await page.waitForTimeout(4000); // PJS player needs time to initialize

    // If this is a specific episode, select the right season/episode via the translation selector
    if (movie.type === 'series' && movie.season && movie.episode) {
      try {
        // Filmix uses a playlist within the PJS player for series episodes
        const playlistItem = await page.$(`#player_playlist pjsdiv[data-season="${movie.season}"][data-episode="${movie.episode}"]`);
        if (playlistItem) {
          await playlistItem.click();
          await page.waitForTimeout(2000);
        }
      } catch (err) {
        console.log(`[filmix-extractor] Episode selection failed (S${movie.season}E${movie.episode}):`, err.message);
      }
    }

    // Try to select the highest available quality
    await selectBestQuality(page);

    // Extract the video source URL from the DOM
    const streamUrl = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video?.src || video?.currentSrc || null;
    });

    await page.close();
    await context.close();
    await browser.close();

    if (!streamUrl) throw new Error('Could not extract stream URL from Filmix');

    const result = { streamUrl, title: movie.title, expiry: Date.now() + CACHE_TTL };
    cache.set(movieId, result);
    console.log(`[filmix-extractor] Got stream: ${streamUrl.substring(0, 100)}...`);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Attempt to select the best available video quality in the PJS player.
 * Opens the settings menu and clicks the highest quality option found.
 */
async function selectBestQuality(page) {
  try {
    // Click the quality/settings menu to expand it
    const qualityMenu = await page.$('#player_settings pjsdiv[fid="1"]');
    if (!qualityMenu) return;

    await qualityMenu.click();
    await page.waitForTimeout(500);

    // Look for quality option items and click the best one
    for (const quality of QUALITY_PREFERENCE) {
      const selected = await page.evaluate((q) => {
        const items = document.querySelectorAll('#player_settings pjsdiv');
        for (const el of items) {
          const text = el.textContent.trim();
          // Match exact quality label (e.g. "1080p", "720p")
          if (text === q && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        return false;
      }, quality);

      if (selected) {
        console.log(`[filmix-extractor] Selected quality: ${quality}`);
        await page.waitForTimeout(2000); // Wait for player to reload with new quality
        return;
      }
    }

    console.log('[filmix-extractor] No quality selector found, using default');
  } catch (err) {
    console.log('[filmix-extractor] Quality selection failed:', err.message);
  }
}
