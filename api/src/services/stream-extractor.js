import { chromium } from 'playwright-core';
import axios from 'axios';
import db from '../db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Cache: movieId -> { m3u8, subtitles, expiry }
const cache = new Map();
const CACHE_TTL = 25 * 60 * 1000; // 25 min (HLS tokens expire)

// TMDB ID cache: imdb_id -> tmdb_id (permanent)
const tmdbCache = new Map();

/**
 * Get TMDB ID from IMDB ID.
 * First checks DB, then tries 123movies page intercept, then TMDB search.
 */
async function getTmdbId(imdbId, sourceUrl) {
  if (tmdbCache.has(imdbId)) return tmdbCache.get(imdbId);

  // Check if stored in DB
  const row = db.prepare('SELECT tmdb_id FROM movies WHERE imdb_id = ? AND tmdb_id IS NOT NULL').get(imdbId);
  if (row?.tmdb_id) {
    tmdbCache.set(imdbId, row.tmdb_id);
    return row.tmdb_id;
  }

  // Extract from 123movies embed chain (intercept embos.net/movie/?mid={tmdb_id})
  if (sourceUrl) {
    const tmdbId = await extractTmdbFrom123(sourceUrl);
    if (tmdbId) {
      tmdbCache.set(imdbId, tmdbId);
      // Store in DB for future use
      db.prepare('UPDATE movies SET tmdb_id = ? WHERE imdb_id = ?').run(tmdbId, imdbId);
      return tmdbId;
    }
  }

  return null;
}

/**
 * Quick extraction: load 123movies page just long enough to intercept the TMDB ID.
 */
async function extractTmdbFrom123(sourceUrl) {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-features=IsolateOrigins,site-per-process'],
    });

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });

    const page = await ctx.newPage();
    let tmdbId = null;

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const match = url.match(/(?:embos\.net|vsembed\.ru|vidnest\.fun)\/(?:movie|embed\/movie)\/?\??(?:mid=)?(\d{3,})/);
      if (match && !tmdbId) {
        tmdbId = match[1];
        console.log(`[extractor] Found TMDB ID: ${tmdbId}`);
      }
      await route.continue();
    });

    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.click('#play-now').catch(() => {});

    // Wait up to 15s for TMDB ID
    for (let i = 0; i < 15 && !tmdbId; i++) {
      await page.waitForTimeout(1000);
    }

    await browser.close();
    return tmdbId;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[extractor] TMDB extraction error:', err.message);
    return null;
  }
}

/**
 * Extract HLS stream URL via vidnest.fun (the final player).
 * Flow: IMDB ID → TMDB ID → vidnest.fun/movie/{tmdb_id} → intercept m3u8
 */
export async function extractStreamUrl(movieId, server = 2) {
  const cacheKey = `${movieId}:${server}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT imdb_id, source_url, title, year FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');

  // Step 1: Get TMDB ID
  const tmdbId = await getTmdbId(movie.imdb_id, movie.source_url);
  if (!tmdbId) throw new Error('Could not resolve TMDB ID for ' + movie.title);

  console.log(`[extractor] Streaming ${movie.title} (TMDB: ${tmdbId})`);

  // Step 2: Load vidnest.fun directly and intercept m3u8
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });

    const page = await ctx.newPage();
    let m3u8Url = null;
    let subtitleUrl = null;

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('.m3u8') || (url.includes('/hls/') && !url.includes('.js'))) {
        if (!m3u8Url || url.includes('index.m3u8') || url.includes('master')) {
          m3u8Url = url;
          console.log(`[extractor] ✅ m3u8: ${url.substring(0, 100)}...`);
        }
      }
      if (url.includes('.vtt') || url.includes('/sub/') || url.includes('/captions/')) {
        subtitleUrl = url;
      }
      await route.continue();
    });

    await page.goto(`https://vidnest.fun/movie/${tmdbId}`, {
      waitUntil: 'load',
      timeout: 25000,
      referer: 'https://vsembed.ru/',
    });

    // Wait for m3u8 (usually appears within 5-10s)
    for (let i = 0; i < 20 && !m3u8Url; i++) {
      await page.waitForTimeout(1000);
    }

    await browser.close();

    if (!m3u8Url) throw new Error('Could not extract stream URL from vidnest');

    const result = { m3u8: m3u8Url, subtitles: subtitleUrl, tmdbId, expiry: Date.now() + CACHE_TTL };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

export function getAvailableServers() {
  return [
    { id: 1, name: 'Server 1' },
    { id: 2, name: 'Server 2 (Default)' },
    { id: 5, name: 'Server 3' },
  ];
}
