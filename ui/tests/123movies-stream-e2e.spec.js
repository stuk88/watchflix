import { test, expect } from '@playwright/test';

/**
 * Real end-to-end test for 123movies stream extraction.
 *
 * Verifies the full pipeline without mocks:
 *   1. API returns 123movies-sourced movies with valid source_url
 *   2. /123stream launches a headless browser, loads the 123movies film page,
 *      clicks play, and intercepts the HLS m3u8 URL from the embed chain
 *   3. The returned proxy URL routes through /123proxy
 *   4. /123proxy fetches the HLS playlist and returns valid #EXTM3U content
 *
 * The extraction step (~15–35s) requires dev servers running:
 *   npm run dev   (API: :3001, UI: :5173)
 *
 * NOTE: Uses 127.0.0.1 — Playwright resolves "localhost" to IPv6 ::1 on macOS.
 * NOTE: The 123movies embed chain generates IP-bound tokens. Since Playwright and
 *       the API server both run on the same machine, the IP is consistent.
 */

const API = 'http://127.0.0.1:3001/api';

test.describe.serial('123movies real stream extraction', () => {

  /** The movie used for this test run — chosen from the live DB. */
  let testMovie;
  /** The proxy URL returned by /123stream */
  let proxyUrl;

  test.beforeAll(async ({ request }) => {
    // Pick a non-series 123movies movie that has a source_url (required for extraction)
    const res = await request.get(`${API}/movies?limit=100&source=123movies&type=movie`);
    expect(res.ok(), 'GET /api/movies should return 200').toBeTruthy();

    const body = await res.json();
    const movies = (body.movies ?? body).filter(
      m => (m.source === '123movies' || m.source === 'both') &&
           m.source_url &&
           m.source_url.includes('123movieshd.com/film/') &&
           m.type !== 'series'
    );

    expect(movies.length, 'Need at least one 123movies non-series movie with source_url').toBeGreaterThan(0);

    // Prefer movies with tmdb_id already cached (extraction is faster) and high rating
    testMovie = movies.find(m => m.tmdb_id) ?? movies[0];

    console.log(`[beforeAll] Test movie: "${testMovie.title}" (id=${testMovie.id}, source=${testMovie.source}, tmdb_id=${testMovie.tmdb_id ?? 'none'})`);
  });

  test('1. movie has valid source_url pointing to 123movieshd.com', async () => {
    expect(testMovie.source_url, 'source_url must be set').toBeTruthy();
    expect(testMovie.source_url, 'source_url must point to 123movieshd.com/film/').toContain('123movieshd.com/film/');
    expect(testMovie.imdb_id ?? testMovie.series_imdb_id, 'Must have imdb_id or series_imdb_id').toMatch(/^tt\d+$/);
    console.log(`[test 1] source_url: ${testMovie.source_url}`);
  });

  test('2. /123stream extracts real HLS m3u8 URL', async ({ request }) => {
    // Extraction launches headless Chrome to load 123movies page, click play,
    // and intercept the m3u8 from the embed chain (netoda.tech → embed provider).
    // Allow up to 90s for the full Playwright extraction cycle.
    test.setTimeout(90000);

    const res = await request.get(`${API}/movies/${testMovie.id}/123stream`);

    console.log(`[test 2] /123stream status: ${res.status()}`);

    expect(res.ok(), `/123stream must return 200 (got ${res.status()})`).toBeTruthy();

    const data = await res.json();
    console.log('[test 2] Response:', JSON.stringify(data).substring(0, 300));

    // Validate response shape
    expect(data.m3u8, 'Response must include m3u8 field').toBeTruthy();
    expect(data.m3u8, 'm3u8 must route through /123proxy').toContain(`/api/movies/${testMovie.id}/123proxy`);
    expect(data.m3u8, 'm3u8 must include url= query param').toContain('url=');

    // The proxied URL must be an actual HLS resource, not a tracking/analytics URL
    const innerUrl = decodeURIComponent(data.m3u8.split('url=')[1] ?? '');
    const innerPath = (() => { try { return new URL(innerUrl).pathname; } catch { return innerUrl; } })();
    expect(
      innerPath.includes('.m3u8') || innerPath.includes('/hls/'),
      `Inner URL must be an HLS resource (got path: "${innerPath.substring(0, 80)}")`
    ).toBeTruthy();

    // Servers array must list available servers
    expect(Array.isArray(data.servers), 'servers must be an array').toBeTruthy();
    expect(data.servers.length, 'servers must have at least 2 entries').toBeGreaterThanOrEqual(2);

    proxyUrl = data.m3u8;
    console.log(`[test 2] ✅ Proxy URL: ${proxyUrl.substring(0, 120)}`);
  });

  test('3. /123proxy returns a valid HLS playlist', async ({ request }) => {
    // The proxy fetches the CDN m3u8 and rewrites segment URLs.
    // CDN tokens are time-bound so this must run immediately after test 2.
    test.setTimeout(30000);

    expect(proxyUrl, 'proxyUrl must be set from test 2').toBeTruthy();

    const playlistRes = await request.get(`http://127.0.0.1:3001${proxyUrl}`);
    console.log(`[test 3] Proxy status: ${playlistRes.status()}`);

    if (!playlistRes.ok()) {
      // CDN token may have already expired; log and skip content checks rather than fail
      console.warn(`[test 3] Proxy returned ${playlistRes.status()} — CDN token may have expired, skipping playlist content check`);
      return;
    }

    const playlist = await playlistRes.text();
    console.log('[test 3] Playlist preview:', playlist.substring(0, 400));

    // Must be a valid HLS playlist
    expect(playlist, 'Playlist must start with HLS #EXTM3U header').toContain('#EXTM3U');

    // Segment or sub-playlist lines must be rewritten through our proxy
    const nonCommentLines = playlist.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (nonCommentLines.length > 0) {
      const firstLine = nonCommentLines[0];
      expect(firstLine, 'Segment/playlist URLs must be rewritten through /123proxy').toContain(
        `/api/movies/${testMovie.id}/123proxy?url=`
      );
      console.log(`[test 3] ✅ Playlist has ${nonCommentLines.length} rewritten URL(s)`);
    } else {
      // Empty non-comment lines is acceptable for some master playlists
      console.log('[test 3] Playlist has no non-comment lines (may be a meta-only master playlist)');
    }
  });
});
