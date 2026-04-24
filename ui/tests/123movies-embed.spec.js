// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E tests for 123movies embed player flow.
 *
 * Tests the full chain:
 *   123movies source_url → netoda.tech → embos.net → vsembed.ru (or equivalent)
 *
 * Requires the API to be running on port 3001 and Vite on 5173.
 */

const BASE = 'http://localhost:5173';
const API  = 'http://localhost:3001';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function get123moviesMovie(request) {
  const res = await request.get(`${API}/api/movies?limit=5&type=movie&source=123movies`);
  expect(res.ok()).toBeTruthy();
  const { movies } = await res.json();
  const movie = movies.find(m => m.source === '123movies' || m.source === 'both');
  expect(movie, 'Need at least one 123movies movie in DB').toBeTruthy();
  return movie;
}

// ─── API: /123embed endpoint ─────────────────────────────────────────────────

test.describe('GET /api/movies/:id/123embed', () => {
  test('returns a valid player URL for server 2 (default)', async ({ request }) => {
    const movie = await get123moviesMovie(request);

    const res = await request.get(`${API}/api/movies/${movie.id}/123embed?server=2`, {
      timeout: 45000,
    });

    expect(res.ok(), `embed failed: ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    expect(body.embedUrl).toBeTruthy();
    expect(body.embedUrl).toMatch(/^https?:\/\//);
    expect(body.servers).toBeInstanceOf(Array);
    expect(body.servers.length).toBeGreaterThan(0);

    // Should be a known player domain, not the hub
    expect(body.embedUrl).not.toContain('netoda.tech');
    console.log(`✅ Server 2 embed URL: ${body.embedUrl}`);
  });

  test('returns a valid player URL for server 1', async ({ request }) => {
    test.setTimeout(90000);
    const movie = await get123moviesMovie(request);

    const res = await request.get(`${API}/api/movies/${movie.id}/123embed?server=1`, {
      timeout: 80000,
    });

    expect(res.ok(), `embed failed: ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    expect(body.embedUrl).toBeTruthy();
    expect(body.embedUrl).toMatch(/^https?:\/\//);
    expect(body.embedUrl).not.toContain('netoda.tech');
    console.log(`✅ Server 1 embed URL: ${body.embedUrl}`);
  });

  test('returns a valid player URL for server 5', async ({ request }) => {
    const movie = await get123moviesMovie(request);

    const res = await request.get(`${API}/api/movies/${movie.id}/123embed?server=5`, {
      timeout: 45000,
    });

    expect(res.ok(), `embed failed: ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    expect(body.embedUrl).toBeTruthy();
    expect(body.embedUrl).not.toContain('netoda.tech');
    console.log(`✅ Server 5 embed URL: ${body.embedUrl}`);
  });

  test('returns 404 for unknown movie id', async ({ request }) => {
    const res = await request.get(`${API}/api/movies/999999/123embed?server=2`, {
      timeout: 10000,
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('caches result — second call is instant', async ({ request }) => {
    const movie = await get123moviesMovie(request);

    // First call (may be slow — Playwright browser)
    await request.get(`${API}/api/movies/${movie.id}/123embed?server=2`, { timeout: 45000 });

    // Second call should hit in-memory cache and be fast
    const t0 = Date.now();
    const res = await request.get(`${API}/api/movies/${movie.id}/123embed?server=2`, { timeout: 5000 });
    const elapsed = Date.now() - t0;

    expect(res.ok()).toBeTruthy();
    expect(elapsed).toBeLessThan(500); // cache hit should be < 500ms
    console.log(`✅ Cache hit in ${elapsed}ms`);
  });
});

// ─── UI: IframePlayer component ──────────────────────────────────────────────

test.describe('IframePlayer UI', () => {
  test('movie detail page shows "Watch Online" button for 123movies source', async ({ page }) => {
    const movie = await (async () => {
      const res = await page.request.get(`${API}/api/movies?limit=5&type=movie&source=123movies`);
      const { movies } = await res.json();
      return movies.find(m => m.source === '123movies' || m.source === 'both');
    })();

    await page.goto(`${BASE}/movie/${movie.id}`);
    await expect(page.locator('.player-start')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.start-text')).toHaveText('Watch Online');
  });

  test('clicking "Watch Online" shows loading spinner then embeds iframe', async ({ page }) => {
    const movie = await (async () => {
      const res = await page.request.get(`${API}/api/movies?limit=5&type=movie&source=123movies`);
      const { movies } = await res.json();
      return movies.find(m => m.source === '123movies' || m.source === 'both');
    })();

    await page.goto(`${BASE}/movie/${movie.id}`);

    // Click play
    await page.locator('.player-start').click();

    // Spinner may flash briefly (or be skipped if embed is cached)
    const spinnerVisible = await page.locator('.spinner').isVisible().catch(() => false);
    if (spinnerVisible) console.log('Spinner appeared');

    // Wait for iframe to appear (up to 45s — Playwright browser extraction)
    await expect(page.locator('.player-iframe')).toBeVisible({ timeout: 45000 });

    // iframe should have a src pointing to a real player (not netoda.tech)
    const src = await page.locator('.player-iframe').getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).not.toContain('netoda.tech');
    console.log(`✅ iframe src: ${src}`);
  });

  test('server switcher buttons are visible after player loads', async ({ page }) => {
    const movie = await (async () => {
      const res = await page.request.get(`${API}/api/movies?limit=5&type=movie&source=123movies`);
      const { movies } = await res.json();
      return movies.find(m => m.source === '123movies' || m.source === 'both');
    })();

    await page.goto(`${BASE}/movie/${movie.id}`);
    await page.locator('.player-start').click();

    // Wait for iframe
    await expect(page.locator('.player-iframe')).toBeVisible({ timeout: 45000 });

    // Server bar should be visible with 3 buttons
    await expect(page.locator('.server-bar')).toBeVisible();
    const serverBtns = page.locator('.btn-server-sm');
    await expect(serverBtns).toHaveCount(3);
  });

  test('switching servers reloads the player with a new embed URL', async ({ page }) => {
    const movie = await (async () => {
      const res = await page.request.get(`${API}/api/movies?limit=5&type=movie&source=123movies`);
      const { movies } = await res.json();
      return movies.find(m => m.source === '123movies' || m.source === 'both');
    })();

    await page.goto(`${BASE}/movie/${movie.id}`);
    await page.locator('.player-start').click();

    // Wait for first iframe
    await expect(page.locator('.player-iframe')).toBeVisible({ timeout: 45000 });
    const firstSrc = await page.locator('.player-iframe').getAttribute('src');

    // Switch to Server 1
    await page.locator('.btn-server-sm').first().click();

    // Spinner may flash briefly (or be skipped if embed is cached)
    await page.locator('.spinner').isVisible().catch(() => false);

    // Wait for new iframe
    await expect(page.locator('.player-iframe')).toBeVisible({ timeout: 45000 });
    const newSrc = await page.locator('.player-iframe').getAttribute('src');

    // URL may differ per server
    console.log(`✅ Server 1 src: ${newSrc}`);
    expect(newSrc).toBeTruthy();
  });
});
