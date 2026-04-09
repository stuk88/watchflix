/**
 * Integration tests for the Filmix stream extractor.
 *
 * Prerequisites:
 *   - Dev server running at http://localhost:3001
 *   - Database with at least one filmix movie (source = 'filmix')
 *   - Google Chrome installed at the standard macOS path
 *
 * Run:  cd api && node tests/filmix-extractor.test.js
 */
import { chromium } from 'playwright-core';
import assert from 'node:assert';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_URL = 'http://localhost:3001';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Filmix movie ID known to exist in the DB (from initial investigation)
const FILMIX_MOVIE_ID = 18209;

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}  -- ${detail}`);
  }
}

async function main() {
  console.log('=== Filmix Extractor Integration Tests ===\n');

  // -------------------------------------------------------
  // 1. Verify server is up
  // -------------------------------------------------------
  console.log('[1] Server health check');
  try {
    const resp = await fetch(`${BASE_URL}/api/movies/${FILMIX_MOVIE_ID}`);
    const movie = await resp.json();
    report('server responds', resp.ok, `status ${resp.status}`);
    report('movie exists in DB', !!movie?.id, 'no movie returned');
    report('movie is filmix source', movie?.source === 'filmix', `source is ${movie?.source}`);
    report('movie has source_url', !!movie?.source_url, 'no source_url');
  } catch (err) {
    report('server responds', false, err.message);
    console.log('\nServer is not reachable. Aborting.');
    process.exit(1);
  }

  // -------------------------------------------------------
  // 2. Test the API endpoint directly
  // -------------------------------------------------------
  console.log('\n[2] API endpoint: GET /api/movies/:id/filmix-stream');
  try {
    const resp = await fetch(`${BASE_URL}/api/movies/${FILMIX_MOVIE_ID}/filmix-stream`);
    const data = await resp.json();
    report('endpoint returns 200', resp.ok, `status ${resp.status}`);
    report('response has streamUrl', !!data?.streamUrl, JSON.stringify(data));
    report('streamUrl is an MP4', data?.streamUrl?.includes('.mp4'), `url: ${data?.streamUrl?.substring(0, 80)}`);
    report('streamUrl from CDN', data?.streamUrl?.includes('werkecdn.me'), `url: ${data?.streamUrl?.substring(0, 80)}`);
    report('response has title', !!data?.title, 'no title');

    // Verify the MP4 URL is actually reachable (HEAD request)
    if (data?.streamUrl) {
      const headResp = await fetch(data.streamUrl, { method: 'HEAD' });
      report('MP4 URL is reachable', headResp.ok, `HEAD status ${headResp.status}`);
      const contentType = headResp.headers.get('content-type');
      report('MP4 content-type is video', contentType?.includes('video'), `content-type: ${contentType}`);
    }
  } catch (err) {
    report('endpoint request', false, err.message);
  }

  // -------------------------------------------------------
  // 3. Test caching (second call should be faster)
  // -------------------------------------------------------
  console.log('\n[3] Cache behaviour');
  try {
    const t1 = Date.now();
    await fetch(`${BASE_URL}/api/movies/${FILMIX_MOVIE_ID}/filmix-stream`);
    const elapsed = Date.now() - t1;
    // Cached response should be < 500ms (extraction takes 5-10s)
    report('second call is cached (< 500ms)', elapsed < 500, `took ${elapsed}ms`);
  } catch (err) {
    report('cache test', false, err.message);
  }

  // -------------------------------------------------------
  // 4. Headless Playwright e2e: navigate to movie, play, verify video
  // -------------------------------------------------------
  console.log('\n[4] Headless e2e: play Filmix movie in the app');
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: BROWSER_PATH,
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required'],
    });

    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    // Navigate to the movie page in the Watchflix app
    await page.goto(`${BASE_URL}/movie/${FILMIX_MOVIE_ID}`, { waitUntil: 'networkidle', timeout: 15000 });
    report('app movie page loads', true, '');

    // Find and click the Filmix play button
    // The IframePlayer shows a .player-start div that starts playback on click
    const playButton = await page.$('.player-start');
    report('play button visible', !!playButton, 'no .player-start found');

    if (playButton) {
      await playButton.click();

      // Wait for extraction to complete (the "Extracting stream..." message)
      // Then wait for the video element to appear
      try {
        await page.waitForSelector('video.player-video', { timeout: 45000 });
        report('video element appears', true, '');
      } catch {
        // Maybe the video element has a different selector
        const anyVideo = await page.$('video');
        report('video element appears', !!anyVideo, 'no video element found after 45s');
      }

      // Wait for the video to start playing
      const videoState = await page.evaluate(() => {
        return new Promise((resolve) => {
          const video = document.querySelector('video');
          if (!video) return resolve({ error: 'no video element' });

          // If already has data, resolve immediately
          if (video.readyState >= 2) {
            return resolve({ readyState: video.readyState, currentTime: video.currentTime, src: video.src?.substring(0, 100) });
          }

          // Wait for loadeddata event
          const timeout = setTimeout(() => {
            resolve({ readyState: video.readyState, currentTime: video.currentTime, src: video.src?.substring(0, 100), timedOut: true });
          }, 15000);

          video.addEventListener('loadeddata', () => {
            clearTimeout(timeout);
            resolve({ readyState: video.readyState, currentTime: video.currentTime, src: video.src?.substring(0, 100) });
          });
        });
      });

      report(
        'video has data (readyState >= 2)',
        videoState.readyState >= 2,
        `readyState=${videoState.readyState}, src=${videoState.src}, timedOut=${videoState.timedOut || false}`
      );

      if (videoState.readyState >= 2) {
        // Also check the full src via a second evaluate (the truncated one may cut off .mp4)
        const fullSrc = await page.evaluate(() => document.querySelector('video')?.src || '');
        report('video src is MP4', fullSrc.includes('.mp4'), `src: ${fullSrc.substring(0, 150)}`);
      }
    }

    await page.close();
    await context.close();
  } catch (err) {
    report('e2e test', false, err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // -------------------------------------------------------
  // 5. Verify source files are correct
  // -------------------------------------------------------
  console.log('\n[5] Source file checks');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const apiDir = path.dirname(new URL(import.meta.url).pathname);

  const extractorPath = path.join(apiDir, '..', 'src', 'services', 'filmix-extractor.js');
  const routesPath = path.join(apiDir, '..', 'src', 'routes', 'movies.js');
  const iframePath = path.join(apiDir, '..', '..', 'ui', 'src', 'components', 'IframePlayer.vue');

  const extractorExists = fs.existsSync(extractorPath);
  report('filmix-extractor.js exists', extractorExists, extractorPath);

  if (extractorExists) {
    const content = fs.readFileSync(extractorPath, 'utf-8');
    report('exports extractFilmixStream', content.includes('export async function extractFilmixStream'), '');
    report('uses Playwright chromium', content.includes("from 'playwright-core'"), '');
    report('has 20-min cache TTL', content.includes('20 * 60 * 1000'), '');
    report('has quality selection logic', content.includes('selectBestQuality'), '');
  }

  const routesContent = fs.readFileSync(routesPath, 'utf-8');
  report('movies.js has filmix-stream route', routesContent.includes("'/:id/filmix-stream'"), '');
  report('movies.js imports filmix-extractor', routesContent.includes('filmix-extractor.js'), '');

  const iframeContent = fs.readFileSync(iframePath, 'utf-8');
  report('IframePlayer hlsSources includes filmix', iframeContent.includes("'filmix'"), '');
  report('IframePlayer endpointMap has filmix', iframeContent.includes("filmix: 'filmix-stream'"), '');

  // -------------------------------------------------------
  // Summary
  // -------------------------------------------------------
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'='.repeat(50)}`);

  if (failed > 0) {
    console.log('\nFAIL');
    process.exit(1);
  } else {
    console.log('\nPASS');
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
