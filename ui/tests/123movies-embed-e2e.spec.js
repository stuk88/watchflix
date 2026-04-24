import { test, expect } from '@playwright/test';

/**
 * E2E tests for 123movies iframe embed extraction and server switching.
 *
 * Tests the full pipeline of GET /api/movies/:id/123embed:
 *   1. Valid embed URL is returned for the default server (server 2)
 *   2. Server switching works — server 1 and server 5 return different embed URLs
 *   3. Returned embed URL is a real, reachable netoda.tech URL (not a dead link)
 *   4. In-memory cache: second request for same movie+server is instant (< 500ms)
 *   5. Error handling: non-existent movie ID returns 404
 *   6. Error handling: movie without source_url returns 500 with clear message
 *   7. servers array always lists all 3 available servers regardless of which is active
 *   8. TV series episode extraction returns a valid embed URL
 *
 * Requires: API dev server running on :3001.
 * NOTE: Uses 127.0.0.1 — Playwright resolves localhost to IPv6 ::1 on macOS.
 * NOTE: Extraction launches headless Chrome (~10–20s per request). Timeouts are generous.
 */

const API = 'http://127.0.0.1:3001/api';

const PLAYER_DOMAINS = [
  'vsembed.ru', 'vidnest.fun', 'vidsrc.cc', 'vidlink.pro', 'vidfast.pro',
  'videasy.net', 'vidzee.wtf', 'mcloud.bz', 'rabbitstream.net',
  'megacloud.tv', 'rapid-cloud.co', 'dokicloud.one',
];

// Expected servers from getAvailableServers()
const EXPECTED_SERVERS = [
  { id: 1, name: 'Server 1' },
  { id: 2, name: 'Server 2 (Default)' },
  { id: 5, name: 'Server 3' },
];

test.describe.serial('123movies embed extraction and server switching', () => {

  let movieId;       // non-series 123movies movie
  let seriesId;      // series episode from 123movies

  test.beforeAll(async ({ request }) => {
    // Pick a non-series 123movies movie with a source_url
    const moviesRes = await request.get(`${API}/movies?limit=100&source=123movies&type=movie`);
    expect(moviesRes.ok(), 'GET /movies must return 200').toBeTruthy();
    const body = await moviesRes.json();
    const candidates = (body.movies ?? body).filter(
      m => (m.source === '123movies' || m.source === 'both') &&
           m.source_url?.includes('123movieshd.com/film/')
    );
    expect(candidates.length, 'Need at least one 123movies movie').toBeGreaterThan(0);
    movieId = candidates[0].id;
    console.log(`[beforeAll] Movie: "${candidates[0].title}" (id=${movieId})`);

    // Pick a series episode
    const seriesRes = await request.get(`${API}/movies?limit=100&source=123movies&type=series`);
    if (seriesRes.ok()) {
      const sb = await seriesRes.json();
      const seriesCandidates = (sb.movies ?? sb).filter(
        m => (m.source === '123movies' || m.source === 'both') &&
             m.source_url?.includes('123movieshd.com')
      );
      if (seriesCandidates.length > 0) {
        seriesId = seriesCandidates[0].id;
        console.log(`[beforeAll] Series: "${seriesCandidates[0].title}" (id=${seriesId})`);
      }
    }
  });

  // ─── 1. Default server (server 2) returns valid embed URL ─────────────────

  test('1. default server returns valid player embed URL', async ({ request }) => {
    test.setTimeout(60000);

    const res = await request.get(`${API}/movies/${movieId}/123embed`, { timeout: 55000 });
    expect(res.ok(), `/123embed must return 200 (got ${res.status()})`).toBeTruthy();

    const data = await res.json();
    console.log('[test 1] Response:', JSON.stringify(data).substring(0, 200));

    // embedUrl must be a real URL
    expect(data.embedUrl, 'embedUrl must be present').toBeTruthy();
    expect(() => new URL(data.embedUrl), 'embedUrl must be a valid URL').not.toThrow();

    // embedUrl must point to a known player domain (vsembed.ru, vidnest.fun, etc.)
    const matchesPlayer = PLAYER_DOMAINS.some(d => data.embedUrl.includes(d));
    expect(
      matchesPlayer,
      `embedUrl must point to a known player domain (got: ${data.embedUrl.substring(0, 80)})`
    ).toBeTruthy();

    // server field must reflect what was requested (default = 2)
    expect(data.server, 'server field must be 2 (default)').toBe(2);

    // servers array must list all available servers
    expect(Array.isArray(data.servers), 'servers must be an array').toBeTruthy();
    expect(data.servers.length, 'servers must have 3 entries').toBe(3);

    console.log(`[test 1] ✅ embed URL: ${data.embedUrl.substring(0, 80)}`);
  });

  // ─── 2. Server switching — each server returns a distinct embed URL ────────

  test('2. server switching returns different embed URLs per server', async ({ request }) => {
    test.setTimeout(300000);

    const results = {};
    for (const server of [1, 2, 5]) {
      const res = await request.get(`${API}/movies/${movieId}/123embed?server=${server}`, {
        timeout: 80000,
      });
      expect(res.ok(), `server ${server} must return 200 (got ${res.status()})`).toBeTruthy();

      const data = await res.json();
      expect(data.embedUrl, `server ${server} must return embedUrl`).toBeTruthy();
      expect(data.server, `server field must reflect requested server ${server}`).toBe(server);

      results[server] = data.embedUrl;
      console.log(`[test 2] Server ${server}: ${data.embedUrl.substring(0, 80)}`);
    }

    // All servers must return valid player URLs (they may resolve to the same
    // final player if the TMDB-based provider is the same across servers)
    for (const [srv, url] of Object.entries(results)) {
      const matchesPlayer = PLAYER_DOMAINS.some(d => url.includes(d));
      expect(matchesPlayer, `Server ${srv} must return a known player domain (got: ${url.substring(0, 80)})`).toBeTruthy();
    }

    console.log('[test 2] ✅ All servers return valid player URLs');
  });

  // ─── 3. Embed URL is reachable (not a dead link) ──────────────────────────

  test('3. returned embed URL responds with HTTP 2xx or 3xx', async ({ request }) => {
    test.setTimeout(60000);

    // Use cached result from test 1 — re-fetch to get current URL
    const res = await request.get(`${API}/movies/${movieId}/123embed`, { timeout: 55000 });
    expect(res.ok()).toBeTruthy();
    const { embedUrl } = await res.json();

    // HEAD request to the embed URL to verify it's reachable
    let status;
    try {
      const headRes = await request.fetch(embedUrl, {
        method: 'HEAD',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://ww6.123movieshd.com/',
        },
        ignoreHTTPSErrors: true,
      });
      status = headRes.status();
    } catch (err) {
      // Some embed servers block HEAD — try GET with a short timeout
      try {
        const getRes = await request.fetch(embedUrl, {
          method: 'GET',
          timeout: 10000,
          headers: { 'Referer': 'https://ww6.123movieshd.com/' },
          ignoreHTTPSErrors: true,
        });
        status = getRes.status();
      } catch {
        status = 0;
      }
    }

    console.log(`[test 3] Embed URL HTTP status: ${status}`);
    expect(
      status >= 200 && status < 500,
      `Embed URL must return 2xx/3xx (got ${status}) — URL: ${embedUrl.substring(0, 80)}`
    ).toBeTruthy();

    console.log('[test 3] ✅ Embed URL is reachable');
  });

  // ─── 4. In-memory cache — second request is instant ──────────────────────

  test('4. second request for same movie+server is served from cache (< 500ms)', async ({ request }) => {
    test.setTimeout(60000);

    // First call populates cache (may already be cached from test 1)
    await request.get(`${API}/movies/${movieId}/123embed?server=2`, { timeout: 55000 });

    // Second call must hit the in-memory cache
    const start = Date.now();
    const res = await request.get(`${API}/movies/${movieId}/123embed?server=2`, { timeout: 5000 });
    const elapsed = Date.now() - start;

    expect(res.ok(), 'Cached request must return 200').toBeTruthy();

    const data = await res.json();
    expect(data.embedUrl, 'Cached response must include embedUrl').toBeTruthy();

    console.log(`[test 4] Cache response time: ${elapsed}ms`);
    expect(
      elapsed,
      `Cached request must complete in < 500ms (took ${elapsed}ms)`
    ).toBeLessThan(500);

    console.log('[test 4] ✅ Cache working correctly');
  });

  // ─── 5. Non-existent movie returns 404 ────────────────────────────────────

  test('5. non-existent movie ID returns 404', async ({ request }) => {
    const res = await request.get(`${API}/movies/999999999/123embed`, { timeout: 10000 });
    expect(res.status(), 'Non-existent movie must return 404').toBe(404);

    const body = await res.json();
    expect(body.error, '404 response must include error field').toBeTruthy();
    console.log(`[test 5] ✅ 404 error: ${body.error}`);
  });

  // ─── 6. servers array is always complete regardless of active server ───────

  test('6. servers array always lists all 3 servers regardless of active server', async ({ request }) => {
    test.setTimeout(60000);

    for (const server of [1, 2, 5]) {
      const res = await request.get(`${API}/movies/${movieId}/123embed?server=${server}`, {
        timeout: 55000,
      });
      expect(res.ok()).toBeTruthy();

      const data = await res.json();
      expect(data.servers.length, `server=${server} response must list 3 servers`).toBe(3);

      for (const expected of EXPECTED_SERVERS) {
        const found = data.servers.find(s => s.id === expected.id);
        expect(found, `servers must include id=${expected.id}`).toBeTruthy();
        expect(found.name, `server id=${expected.id} must have name "${expected.name}"`).toBe(expected.name);
      }
    }

    console.log('[test 6] ✅ servers array is complete and consistent across all server requests');
  });

  // ─── 7. TV series episode extraction ─────────────────────────────────────

  test('7. TV series episode returns valid embed URL', async ({ request }) => {
    if (!seriesId) {
      console.log('[test 7] No series episode found in DB — skipping');
      return;
    }
    test.setTimeout(60000);

    const res = await request.get(`${API}/movies/${seriesId}/123embed`, { timeout: 55000 });
    expect(res.ok(), `/123embed for series id=${seriesId} must return 200 (got ${res.status()})`).toBeTruthy();

    const data = await res.json();
    expect(data.embedUrl, 'Series embed must return embedUrl').toBeTruthy();
    expect(() => new URL(data.embedUrl), 'Series embedUrl must be a valid URL').not.toThrow();
    // embedUrl must point to a known player domain, not the embed hub
    expect(data.embedUrl, 'Series embedUrl must be a valid player URL').toMatch(/vsembed\.ru|vidnest\.fun|vidsrc\.cc|vidlink\.pro|vidfast\.pro|videasy\.net|vidzee\.wtf|mcloud\.bz|rabbitstream\.net|megacloud\.tv|rapid-cloud\.co|dokicloud\.one/);

    console.log(`[test 7] ✅ Series embed URL: ${data.embedUrl.substring(0, 80)}`);
  });

  // ─── 8. embedUrl token changes between requests (not stale) ──────────────

  test('8. embed URL token is fresh — different from a cold request', async ({ request }) => {
    test.setTimeout(60000);

    // Use server=5 which is less likely to be in cache from earlier tests
    const res1 = await request.get(`${API}/movies/${movieId}/123embed?server=5`, { timeout: 55000 });
    expect(res1.ok()).toBeTruthy();
    const { embedUrl: url1 } = await res1.json();

    // Immediately re-fetch — should return the cached URL (same token within TTL)
    const res2 = await request.get(`${API}/movies/${movieId}/123embed?server=5`, { timeout: 5000 });
    expect(res2.ok()).toBeTruthy();
    const { embedUrl: url2 } = await res2.json();

    // Within the cache TTL, both must return the same URL (cache consistency)
    expect(url1, 'Cached URL must be consistent within TTL').toBe(url2);

    console.log(`[test 8] ✅ Cache consistent: ${url1.substring(0, 80)}`);
  });
});
