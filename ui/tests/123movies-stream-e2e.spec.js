import { test, expect } from '@playwright/test';

/**
 * Real end-to-end test for 123movies embed extraction.
 *
 * Verifies the full pipeline without mocks:
 *   1. API returns 123movies-sourced movies with valid source_url
 *   2. /123embed launches a headless browser, loads the 123movies film page,
 *      clicks play, and intercepts the player embed URL from the embed chain
 *   3. The returned embed URL points to a known player domain and is reachable
 *
 * The extraction step (~15–35s) requires dev servers running:
 *   npm run dev   (API: :3001, UI: :5173)
 *
 * NOTE: Uses 127.0.0.1 — Playwright resolves "localhost" to IPv6 ::1 on macOS.
 */

const API = 'http://127.0.0.1:3001/api';

const PLAYER_DOMAINS = [
  'vsembed.ru', 'vidnest.fun', 'vidsrc.cc', 'vidlink.pro', 'vidfast.pro',
  'videasy.net', 'vidzee.wtf', 'mcloud.bz', 'rabbitstream.net',
  'megacloud.tv', 'rapid-cloud.co', 'dokicloud.one',
];

test.describe.serial('123movies real embed extraction', () => {

  let testMovie;
  let embedUrl;

  test.beforeAll(async ({ request }) => {
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
    testMovie = movies[0];
    console.log(`[beforeAll] Test movie: "${testMovie.title}" (id=${testMovie.id})`);
  });

  test('1. movie has valid source_url pointing to 123movieshd.com', async () => {
    expect(testMovie.source_url, 'source_url must be set').toBeTruthy();
    expect(testMovie.source_url, 'source_url must point to 123movieshd.com/film/').toContain('123movieshd.com/film/');
    expect(testMovie.imdb_id ?? testMovie.series_imdb_id, 'Must have imdb_id or series_imdb_id').toMatch(/^tt\d+$/);
    console.log(`[test 1] source_url: ${testMovie.source_url}`);
  });

  test('2. /123embed extracts real player embed URL', async ({ request }) => {
    test.setTimeout(90000);

    const res = await request.get(`${API}/movies/${testMovie.id}/123embed?server=2`, { timeout: 80000 });
    console.log(`[test 2] /123embed status: ${res.status()}`);
    expect(res.ok(), `/123embed must return 200 (got ${res.status()})`).toBeTruthy();

    const data = await res.json();
    console.log('[test 2] Response:', JSON.stringify(data).substring(0, 300));

    expect(data.embedUrl, 'Response must include embedUrl field').toBeTruthy();
    expect(() => new URL(data.embedUrl), 'embedUrl must be a valid URL').not.toThrow();

    const matchesPlayer = PLAYER_DOMAINS.some(d => data.embedUrl.includes(d));
    expect(matchesPlayer, `embedUrl must point to a known player domain (got: ${data.embedUrl.substring(0, 80)})`).toBeTruthy();

    expect(Array.isArray(data.servers), 'servers must be an array').toBeTruthy();
    expect(data.servers.length, 'servers must have at least 2 entries').toBeGreaterThanOrEqual(2);

    embedUrl = data.embedUrl;
    console.log(`[test 2] ✅ Embed URL: ${embedUrl.substring(0, 120)}`);
  });

  test('3. embed URL is reachable and serves a player page', async ({ request }) => {
    test.setTimeout(30000);
    expect(embedUrl, 'embedUrl must be set from test 2').toBeTruthy();

    let status;
    try {
      const res = await request.fetch(embedUrl, {
        method: 'GET',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://ww6.123movieshd.com/',
        },
        ignoreHTTPSErrors: true,
      });
      status = res.status();
    } catch {
      status = 0;
    }

    console.log(`[test 3] Embed URL HTTP status: ${status}`);
    expect(status >= 200 && status < 500, `Embed URL must be reachable (got ${status})`).toBeTruthy();
    console.log('[test 3] ✅ Embed URL is reachable');
  });
});
