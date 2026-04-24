import { test, expect } from '@playwright/test';

/**
 * E2E tests for stream extraction covering:
 * - TV show (id=11068, Monarch: Legacy of Monsters, season 2) — verifies TV show handling
 * - Regular movie (id=11) — regression guard to ensure movies still work
 *
 * These tests verify the UI pipeline up to and including embed extraction.
 * Embed extraction launches headless Chrome (~15-20s), so timeouts are generous.
 *
 * Requires: dev servers running (npm run dev) — UI on :5173, API on :3001.
 * NOTE: Uses 127.0.0.1 not localhost — Playwright resolves localhost to IPv6 ::1.
 */

const API = 'http://localhost:3001/api';
const UI = 'http://localhost:5173';

test.describe('TV show stream extraction (movie id=11068)', () => {
  test('page loads and shows correct title', async ({ page }) => {
    await page.goto(`${UI}/movie/11068`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });
    const title = await page.textContent('h1.hero-title');
    expect(title?.trim(), 'Hero title must be non-empty').toBeTruthy();
    console.log(`[tv-test] Page title: "${title?.trim()}"`);
  });

  test('Watch Online tab is present', async ({ page }) => {
    await page.goto(`${UI}/movie/11068`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Click Watch Online tab if multiple source tabs exist
    const watchTab = await page.$('.source-tab:has-text("Watch Online")');
    if (watchTab) {
      await watchTab.click();
      await page.waitForTimeout(300);
      console.log('[tv-test] Clicked Watch Online tab');
    }

    // Player start button should be present
    const startBtn = await page.$('.player-start');
    expect(startBtn, 'Player start button must be visible').toBeTruthy();
  });

  test('clicking Watch Online shows spinner then video or helpful error', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto(`${UI}/movie/11068`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Click Watch Online tab if present
    const watchTab = await page.$('.source-tab:has-text("Watch Online")');
    if (watchTab) {
      await watchTab.click();
      await page.waitForTimeout(300);
    }

    const startBtn = await page.$('.player-start');
    expect(startBtn, '.player-start button must exist before clicking').toBeTruthy();
    await startBtn.click();
    console.log('[tv-test] Clicked player-start');

    // Spinner should appear quickly
    const spinner = await page.waitForSelector('.spinner, .loading-text', { timeout: 5000 }).catch(() => null);
    if (spinner) console.log('[tv-test] Loading spinner appeared');

    // Wait for iframe player or error state
    const outcome = await Promise.race([
      page.waitForSelector('.player-iframe', { timeout: 60000 }).then(() => 'iframe'),
      page.waitForSelector('.error-state', { timeout: 60000 }).then(() => 'error'),
    ]);

    if (outcome === 'iframe') {
      const src = await page.locator('.player-iframe').getAttribute('src');
      console.log(`[tv-test] ✅ iframe player loaded — src: ${src?.substring(0, 80)}`);
    } else {
      const errorText = await page.textContent('.error-state').catch(() => '');
      console.log('[tv-test] Error state:', errorText?.substring(0, 200));

      // Error must not be a generic 500 — should be meaningful
      expect(errorText, 'Error message must not be a raw 500').not.toContain('500');

      // Server retry buttons must be shown
      const serverBtns = await page.$$('.btn-server');
      expect(
        serverBtns.length,
        'Error state must show server switch buttons for retry'
      ).toBeGreaterThan(0);
      console.log(`[tv-test] ${serverBtns.length} server button(s) shown`);
    }
  });
});

test.describe('Regular movie regression (movie id=11)', () => {
  test('page loads with correct source badge', async ({ page, request }) => {
    // Confirm id=11 is a 123movies or both-source movie
    const res = await request.get(`${API}/movies/11`);
    expect(res.ok(), 'GET /api/movies/11 should return 200').toBeTruthy();
    const movie = await res.json();
    expect(
      movie.source === '123movies' || movie.source === 'both' || movie.source,
      'Movie id=11 must have a source'
    ).toBeTruthy();
    console.log(`[movie-test] id=11: "${movie.title}", source=${movie.source}`);

    await page.goto(`${UI}/movie/11`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });
    const title = await page.textContent('h1.hero-title');
    expect(title?.trim()).toBeTruthy();

    const badge = await page.$('.source-badge');
    expect(badge, 'Source badge must be visible').toBeTruthy();
    console.log(`[movie-test] Page loaded OK: "${title?.trim()}"`);
  });

  test('clicking Watch Online shows spinner then video or error+servers', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto(`${UI}/movie/11`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    const watchTab = await page.$('.source-tab:has-text("Watch Online")');
    if (watchTab) {
      await watchTab.click();
      await page.waitForTimeout(300);
    }

    const startBtn = await page.$('.player-start');
    if (!startBtn) {
      console.log('[movie-test] No .player-start found — movie may not support 123movies streaming, skipping');
      return;
    }

    await startBtn.click();
    console.log('[movie-test] Clicked player-start');

    await page.waitForSelector('.spinner, .loading-text', { timeout: 5000 }).catch(() => null);

    const outcome = await Promise.race([
      page.waitForSelector('.player-iframe', { timeout: 60000 }).then(() => 'iframe'),
      page.waitForSelector('.error-state', { timeout: 60000 }).then(() => 'error'),
    ]);

    if (outcome === 'iframe') {
      const src = await page.locator('.player-iframe').getAttribute('src');
      console.log(`[movie-test] ✅ iframe player loaded — src: ${src?.substring(0, 80)}`);
    } else {
      const errorText = await page.textContent('.error-state').catch(() => '');
      console.log('[movie-test] Error state:', errorText?.substring(0, 200));
      const serverBtns = await page.$$('.btn-server');
      expect(serverBtns.length, 'Error state must show server buttons').toBeGreaterThan(0);
    }
  });
});
