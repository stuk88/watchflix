import { chromium } from 'playwright-core';
import db from '../db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Cache: movieId -> { m3u8, subtitles, expiry }
const cache = new Map();
const CACHE_TTL = 25 * 60 * 1000; // 25 min (HLS tokens expire)

// Embed URL cache: movieId:server -> { embedUrl, expiry }
const embedCache = new Map();
const EMBED_CACHE_TTL = 20 * 60 * 1000; // 20 min

/**
 * Extract HLS stream URL by loading the 123movies source page directly.
 *
 * Flow: source_url (123movieshd.com) → click server tab (if non-default) →
 *       click #play-now → page builds netoda.tech iframe with encrypted token →
 *       netoda.tech loads one of its embed providers → intercept m3u8 URL
 *
 * This approach works regardless of which embed hub 123movies uses (embos.net
 * was replaced by netoda.tech). The token is generated client-side from the
 * browser's IP, so the same Playwright instance that generates it can load it.
 *
 * Servers correspond to #srv-1, #srv-2 (default), #srv-5 on the 123movies page.
 */
export async function extractStreamUrl(movieId, server = 2) {
  const cacheKey = `${movieId}:${server}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached;

  // Check persistent DB cache before launching a browser
  const dbCached = db.prepare(
    'SELECT m3u8_url, subtitle_url, tmdb_id, expires_at FROM stream_cache WHERE movie_id = ? AND server = ? AND error IS NULL'
  ).get(movieId, server);
  if (dbCached && dbCached.expires_at > Date.now()) {
    const result = { m3u8: dbCached.m3u8_url, subtitles: dbCached.subtitle_url, tmdbId: dbCached.tmdb_id, expiry: dbCached.expires_at };
    cache.set(cacheKey, result);
    console.log(`[extractor] DB cache hit for movie ${movieId} server ${server}`);
    return result;
  }

  const movie = db.prepare('SELECT imdb_id, series_imdb_id, source_url, title, year, type, season, episode, tmdb_id FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');
  if (!movie.source_url) throw new Error(`No source URL stored for "${movie.title}"`);

  const isTvShow = movie.type === 'series';
  const season = movie.season ?? 1;
  const episode = movie.episode ?? 1;

  if (isTvShow) {
    console.log(`[extractor] TV show detected — season ${season}, episode ${episode}`);
  }

  console.log(`[extractor] Streaming "${movie.title}" via 123movies page (server: ${server})`);

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

    // Intercept all requests across all frames — look for m3u8 URLs.
    // Check only the URL path (not query string) to avoid matching JWPlayer analytics
    // pings that embed the stream URL as a query param (e.g. jwpltx.com/ping.gif?...&file=stream.m3u8).
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      try {
        const { pathname } = new URL(url);
        const isM3u8 = pathname.includes('.m3u8') || (pathname.includes('/hls/') && !pathname.includes('.js'));
        if (isM3u8) {
          // Prefer master/index playlists over individual segment playlists
          if (!m3u8Url || pathname.includes('index.m3u8') || pathname.includes('master')) {
            m3u8Url = url;
            console.log(`[extractor] ✅ m3u8 (route): ${url.substring(0, 120)}`);
          }
        }
        if (pathname.includes('.vtt') || pathname.includes('/sub/') || pathname.includes('/captions/')) {
          subtitleUrl = url;
        }
      } catch (_) {}
      await route.continue();
    });

    // Also scan response bodies for m3u8 URLs embedded in JSON/JS API responses
    page.on('response', async (response) => {
      if (m3u8Url) return;
      const url = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('javascript') || url.includes('/api/') || url.includes('/decrypt') || url.includes('/source')) {
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

    // Load the 123movies film/series page
    await page.goto(movie.source_url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    // For non-default servers, click the server tab BEFORE play so the cookie is set
    if (server !== 2) {
      await page.click(`#srv-${server}`, { timeout: 3000 }).catch(() => {
        console.warn(`[extractor] Server tab #srv-${server} not found, using default`);
      });
      await page.waitForTimeout(300);
    }

    // Click the main play button to start playback
    const played = await page.click('#play-now', { timeout: 5000 }).then(() => true).catch((e) => {
      console.warn('[extractor] Could not click #play-now:', e.message);
      return false;
    });

    if (!played) throw new Error(`Play button not found on page: ${movie.source_url}`);

    // For TV episodes, click the specific episode after play starts (episode buttons get click
    // listeners during play-now click, and clicking a different episode calls setSRC again)
    if (isTvShow && movie.episode && movie.episode > 1) {
      await page.waitForTimeout(800);
      await page.click(`#ep-${movie.episode}`, { timeout: 3000 }).catch(() => {
        console.warn(`[extractor] Episode button #ep-${movie.episode} not found, using first episode`);
      });
    }

    // Wait for m3u8 interception (up to 35s — netoda.tech + embed provider chain takes ~10–20s)
    for (let i = 0; i < 35 && !m3u8Url; i++) {
      await page.waitForTimeout(1000);
    }

    await browser.close();

    if (!m3u8Url) throw new Error(`Could not extract stream URL for "${movie.title}" (server ${server})`);

    const result = { m3u8: m3u8Url, subtitles: subtitleUrl, tmdbId: movie.tmdb_id ?? null, expiry: Date.now() + CACHE_TTL };
    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Extract the embed iframe URL from the 123movies page.
 * Navigates to the 123movies page, clicks play, and intercepts the final
 * player URL (vsembed.ru / vidnest.fun / etc.) from the embed chain.
 *
 * Chain: 123movies → netoda.tech → embos.net → vsembed.ru (actual player)
 * All frames load in the same browser context so one request listener catches all.
 */
export async function extractEmbedUrl(movieId, server = 2) {
  const cacheKey = `${movieId}:${server}`;
  const cached = embedCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached;

  const movie = db.prepare('SELECT source_url, title, type, season, episode FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Movie not found');
  if (!movie.source_url) throw new Error(`No source URL stored for "${movie.title}"`);

  const isTvShow = movie.type === 'series';
  console.log(`[embed-extractor] Extracting player for "${movie.title}" server=${server}`);

  // Known final player domains
  const PLAYER_DOMAINS = [
    'vsembed.ru', 'vidnest.fun', 'vidsrc.cc', 'vidlink.pro', 'vidfast.pro',
    'videasy.net', 'vidzee.wtf', 'mcloud.bz', 'rabbitstream.net',
    'megacloud.tv', 'rapid-cloud.co', 'dokicloud.one',
  ];

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
    let embedUrl = null;

    // Listen on ALL requests across ALL frames in this context
    // The full chain (123movies → netoda.tech → embos.net → vsembed.ru) fires in one context
    ctx.on('request', req => {
      if (embedUrl) return;
      const url = req.url();
      if (PLAYER_DOMAINS.some(d => url.includes(d)) &&
          (url.includes('/embed/') || url.includes('/movie/') || url.includes('/watch') || url.includes('mid='))) {
        embedUrl = url;
        console.log(`[embed-extractor] ✅ Player URL: ${url.substring(0, 120)}`);
      }
    });

    await page.goto(movie.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    if (server !== 2) {
      await page.click(`#srv-${server}`, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    await page.click('#play-now', { timeout: 5000 }).catch(e => {
      throw new Error(`Play button not found: ${e.message}`);
    });

    if (isTvShow && movie.episode && movie.episode > 1) {
      await page.waitForTimeout(800);
      await page.click(`#ep-${movie.episode}`, { timeout: 3000 }).catch(() => {});
    }

    // Wait up to 20s for the final player URL to appear
    for (let i = 0; i < 20 && !embedUrl; i++) {
      await page.waitForTimeout(1000);
    }

    await browser.close();

    if (!embedUrl) throw new Error(`Could not extract player URL for "${movie.title}" (server ${server})`);

    const result = { embedUrl, server, expiry: Date.now() + EMBED_CACHE_TTL };
    embedCache.set(cacheKey, result);
    return result;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Extract TMDB ID from a 123movies source page (for metadata enrichment only).
 * Loads the page, clicks play, and looks for TMDB IDs in outgoing request URLs.
 * Note: 123movies now uses netoda.tech as its embed hub; the data-id in the page
 * is a site-specific ID, not a TMDB ID. We try to find it from embed provider URLs.
 */
export async function extractTmdbFrom123(sourceUrl) {
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
      // Match TMDB ID from embed provider URL patterns
      const match = url.match(/(?:embos\.net|vsembed\.ru|(?:new\.)?vidnest\.fun|vidsrc\.cc|vidlink\.pro|vidfast\.pro)\/(?:movie|tv|embed\/(?:movie|tv))\/?\??(?:mid=|id=)?(\d{5,})/);
      if (match && !tmdbId) {
        tmdbId = match[1];
        console.log(`[extractor] Found TMDB ID: ${tmdbId}`);
      }
      await route.continue();
    });

    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.click('#play-now').catch(() => {});

    // Wait up to 20s for TMDB ID to appear in a network request
    for (let i = 0; i < 20 && !tmdbId; i++) {
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

export function getAvailableServers() {
  return [
    { id: 1, name: 'Server 1' },
    { id: 2, name: 'Server 2 (Default)' },
    { id: 5, name: 'Server 3' },
  ];
}
