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
      const match = url.match(/(?:embos\.net|vsembed\.ru|(?:new\.)?vidnest\.fun)\/(?:movie|tv|embed\/(?:movie|tv))\/?\??(?:mid=)?(\d{3,})/);
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
 * Extract HLS stream URL via embos.net (the 123movies embed hub).
 * Flow: IMDB ID → TMDB ID → embos.net/movie/?mid={tmdb_id} → click server tab → intercept m3u8
 *
 * embos.net hosts multiple server tabs (data-id: 1, 2, 5), each loading a different
 * embed provider in an iframe. We click the requested server tab and intercept the
 * resulting m3u8 URL from network traffic.
 */
export async function extractStreamUrl(movieId, server = 2) {
  const cacheKey = `${movieId}:${server}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT imdb_id, series_imdb_id, source_url, title, year, type, season, episode FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');

  // Step 1: Get TMDB ID
  const tmdbId = await getTmdbId(movie.imdb_id, movie.source_url);
  if (!tmdbId) {
    const isTv = /season/i.test(movie.source_url || '') || /season/i.test(movie.title || '');
    if (isTv) throw new Error(`TV shows not fully supported: could not resolve TMDB ID for "${movie.title}"`);
    throw new Error('Could not resolve TMDB ID for ' + movie.title);
  }

  // Detect TV show by type column (preferred) or fallback to regex on source_url/title
  const isTvShow = movie.type === 'series' || /season/i.test(movie.source_url || '') || /season/i.test(movie.title || '');

  // Use season/episode from DB columns if available, otherwise parse from source_url
  let season, episode;
  if (movie.season != null) {
    season = movie.season;
    episode = movie.episode ?? 1;
  } else {
    const seasonMatch = (movie.source_url || '').match(/season[- ]?(\d+)/i);
    season = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
    episode = 1; // Default to episode 1 for legacy rows
  }

  if (isTvShow) {
    console.log(`[extractor] TV show detected — season ${season}, episode ${episode}`);
  }

  console.log(`[extractor] Streaming ${movie.title} (TMDB: ${tmdbId}, server: ${server})`);

  // Step 2: Load embos.net and select the requested server tab, then intercept m3u8
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-features=IsolateOrigins,site-per-process'],
    });

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });

    const page = await ctx.newPage();
    let m3u8Url = null;
    let subtitleUrl = null;

    // Intercept request URLs for direct .m3u8 hits across all frames
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if ((url.includes('.m3u8') || (url.includes('/hls/') && !url.includes('.js'))) && url.startsWith('http')) {
        if (!m3u8Url || url.includes('index.m3u8') || url.includes('master')) {
          m3u8Url = url;
          console.log(`[extractor] ✅ m3u8 (route): ${url.substring(0, 120)}`);
        }
      }
      if (url.includes('.vtt') || url.includes('/sub/') || url.includes('/captions/')) {
        subtitleUrl = url;
      }
      await route.continue();
    });

    // Also scan response bodies for m3u8 URLs (some providers embed them in JSON/JS)
    page.on('response', async (response) => {
      if (m3u8Url) return;
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('javascript') || url.includes('/api/') || url.includes('/decrypt')) {
        try {
          const text = await response.text();
          const m3u8Match = text.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
          if (m3u8Match) {
            m3u8Url = m3u8Match[0];
            console.log(`[extractor] ✅ m3u8 (response body): ${m3u8Url.substring(0, 120)}`);
          }
          if (!subtitleUrl) {
            const vttMatch = text.match(/https?:\/\/[^\s"'\\]+\.vtt[^\s"'\\]*/);
            if (vttMatch) subtitleUrl = vttMatch[0];
          }
        } catch (_) {}
      }
    });

    const embosUrl = isTvShow
      ? `https://embos.net/tv/?mid=${tmdbId}&season=${season}&episode=${episode}`
      : `https://embos.net/movie/?mid=${tmdbId}`;
    await page.goto(embosUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
      referer: movie.source_url || 'https://123movies.ai/',
    });

    // Give the page a moment to render server tabs
    await page.waitForTimeout(1500);

    // Click the server tab matching the requested server (data-id attribute)
    const tabClicked = await page.click(`[data-id="${server}"]`, { timeout: 5000 }).then(() => true).catch(() => false);
    if (tabClicked) {
      console.log(`[extractor] Clicked server tab data-id="${server}"`);
    } else {
      console.warn(`[extractor] Server tab data-id="${server}" not found, using default`);
    }

    // Wait for m3u8 interception (up to 25s)
    for (let i = 0; i < 25 && !m3u8Url; i++) {
      await page.waitForTimeout(1000);
    }

    await browser.close();

    if (!m3u8Url) throw new Error(`Could not extract stream URL from embos.net (server ${server})`);

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
