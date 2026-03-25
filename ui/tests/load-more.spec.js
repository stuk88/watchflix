import { test, expect } from '@playwright/test';

/**
 * Load More button integration tests.
 * Mocks /api/movies to return controlled paginated responses —
 * no real database required.
 */

function makeMovies(count, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    title: `Movie ${startId + i}`,
    year: 2020,
    imdb_rating: 7.5,
    poster: null,
    source: 'torrent',
    type: 'movie',
    is_favorite: 0,
    is_hidden: 0,
  }));
}

test.describe('Home page — Load More', () => {
  test('Load More button appears and appends more movies', async ({ page }) => {
    const PAGE1 = makeMovies(40, 1);
    const PAGE2 = makeMovies(15, 41);

    let callCount = 0;

    await page.route('**/api/movies*', async route => {
      const url = new URL(route.request().url());
      const pageNum = parseInt(url.searchParams.get('page') || '1');
      callCount++;

      if (pageNum === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ movies: PAGE1, total: 55, page: 1, pages: 2 }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ movies: PAGE2, total: 55, page: 2, pages: 2 }),
        });
      }
    });

    await page.goto('/');

    // Wait for first batch of movie cards
    await page.waitForSelector('.movie-card', { timeout: 10000 });
    const initialCount = await page.locator('.movie-card').count();
    console.log(`[load-more] Initial movie count: ${initialCount}`);
    expect(initialCount).toBe(40);

    // Load More button must be visible
    const loadMoreBtn = page.locator('.btn-load-more');
    await expect(loadMoreBtn).toBeVisible({ timeout: 5000 });
    console.log('[load-more] Load More button is visible');

    // Click Load More
    await loadMoreBtn.click();

    // Wait for new cards to be appended
    await page.waitForFunction(
      count => document.querySelectorAll('.movie-card').length > count,
      initialCount,
      { timeout: 10000 }
    );

    const finalCount = await page.locator('.movie-card').count();
    console.log(`[load-more] Final movie count after Load More: ${finalCount}`);
    expect(finalCount).toBe(55);

    // Load More button should disappear (no more pages)
    await expect(loadMoreBtn).not.toBeVisible({ timeout: 5000 });

    // "All loaded" message should appear
    await expect(page.locator('.all-loaded')).toBeVisible({ timeout: 3000 });
    console.log('[load-more] "All loaded" indicator visible');

    expect(callCount).toBe(2);
  });

  test('Load More button does not appear when only one page of results', async ({ page }) => {
    await page.route('**/api/movies*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ movies: makeMovies(12, 1), total: 12, page: 1, pages: 1 }),
      })
    );

    await page.goto('/');
    await page.waitForSelector('.movie-card', { timeout: 10000 });

    await expect(page.locator('.btn-load-more')).not.toBeVisible();
    console.log('[load-more] Correctly hidden when only 1 page');
  });
});
