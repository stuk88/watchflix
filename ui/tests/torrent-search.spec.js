import { test, expect } from '@playwright/test';

/**
 * E2E tests for the torrent search feature.
 *
 * Tests:
 * 1. API: GET /api/torrent-search?q=... returns results
 * 2. API: results are healthy (seeders >= 5)
 * 3. API: POST /api/torrent-search/add saves to library
 * 4. UI: torrent search page loads
 * 5. UI: search returns and displays results
 * 6. UI: "Add to Library" button works and changes to "Watch"
 *
 * Requires: API running on port 3001, UI dev server on 5173.
 */

const API = 'http://127.0.0.1:3001/api';

test.describe.serial('Torrent Search', () => {
  // ─── API tests ──────────────────────────────────────────────────────────────

  test('1. API returns search results for a known movie', async ({ request }) => {
    const res = await request.get(`${API}/torrent-search?q=inception`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.results).toBeDefined();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });

  test('2. All results have seeders >= 5 (healthy torrents only)', async ({ request }) => {
    const res = await request.get(`${API}/torrent-search?q=inception`);
    const { results } = await res.json();
    for (const r of results) {
      expect(r.seeds).toBeGreaterThanOrEqual(5);
      expect(r.infohash).toBeTruthy();
      expect(r.magnet).toContain('magnet:?xt=urn:btih:');
      expect(r.name).toBeTruthy();
      expect(r.source).toBeTruthy();
    }
  });

  test('3. Results contain expected fields', async ({ request }) => {
    const res = await request.get(`${API}/torrent-search?q=dune`);
    const { results } = await res.json();
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('infohash');
    expect(r).toHaveProperty('magnet');
    expect(r).toHaveProperty('quality');
    expect(r).toHaveProperty('seeds');
    expect(r).toHaveProperty('leechers');
    expect(r).toHaveProperty('size');
    expect(r).toHaveProperty('source');
  });

  test('4. API rejects empty query', async ({ request }) => {
    const res = await request.get(`${API}/torrent-search?q=`);
    expect(res.status()).toBe(400);
  });

  test('5. Add to library creates a movie entry', async ({ request }) => {
    // Search first to get a real result
    const searchRes = await request.get(`${API}/torrent-search?q=interstellar`);
    const { results } = await searchRes.json();
    expect(results.length).toBeGreaterThan(0);

    const torrent = results[0];
    const addRes = await request.post(`${API}/torrent-search/add`, {
      data: {
        magnet: torrent.magnet,
        name: torrent.name,
        quality: torrent.quality,
        infohash: torrent.infohash,
      },
    });
    expect(addRes.ok()).toBeTruthy();
    const addBody = await addRes.json();
    expect(addBody.ok).toBe(true);
    expect(addBody.movieId).toBeDefined();

    // Verify movie exists in the DB via API
    const movieRes = await request.get(`${API}/movies/${addBody.movieId}`);
    expect(movieRes.ok()).toBeTruthy();
    const movie = await movieRes.json();
    expect(movie.torrent_magnet).toContain('magnet:');
  });

  test('6. Adding same torrent again returns existing', async ({ request }) => {
    const searchRes = await request.get(`${API}/torrent-search?q=interstellar`);
    const { results } = await searchRes.json();
    const torrent = results[0];

    const addRes = await request.post(`${API}/torrent-search/add`, {
      data: {
        magnet: torrent.magnet,
        name: torrent.name,
        quality: torrent.quality,
        infohash: torrent.infohash,
      },
    });
    const body = await addRes.json();
    expect(body.ok).toBe(true);
    expect(body.existing).toBe(true);
  });

  // ─── UI tests ───────────────────────────────────────────────────────────────

  test('7. Torrent search page loads with search input', async ({ page }) => {
    await page.goto('/torrent-search');
    await expect(page.locator('.ts-title')).toHaveText('Torrent Search');
    await expect(page.locator('.ts-search-input')).toBeVisible();
    await expect(page.locator('.btn-primary')).toBeVisible();
  });

  test('8. Nav link to torrent search exists', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a.nav-link[href="/torrent-search"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Torrent Search');
  });

  test('9. Search displays results in table', async ({ page }) => {
    await page.goto('/torrent-search');

    await page.fill('.ts-search-input', 'inception');
    await page.click('.btn-primary');

    // Wait for results table
    await expect(page.locator('.ts-table')).toBeVisible({ timeout: 15000 });
    const rows = page.locator('.ts-row');
    await expect(rows.first()).toBeVisible();

    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Verify result content
    const firstRow = rows.first();
    await expect(firstRow.locator('.ts-name')).not.toBeEmpty();
    await expect(firstRow.locator('.quality-badge')).toBeVisible();
    await expect(firstRow.locator('.seeds-count')).toBeVisible();
  });

  test('10. Add to Library button works from UI', async ({ page }) => {
    await page.goto('/torrent-search');

    await page.fill('.ts-search-input', 'the matrix 1999');
    await page.click('.btn-primary');

    await expect(page.locator('.ts-table')).toBeVisible({ timeout: 15000 });

    // Click first "Add to Library" button
    const addBtn = page.locator('.ts-row .btn-primary').first();
    await expect(addBtn).toHaveText('+ Library');
    await addBtn.click();

    // Button should change to "Watch" after adding
    const watchBtn = page.locator('.ts-row .btn-outline').first();
    await expect(watchBtn).toHaveText('Watch', { timeout: 10000 });
  });
});
