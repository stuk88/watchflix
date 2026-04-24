import { test, expect } from '@playwright/test';

/**
 * E2E test for the 123movies server scraper pipeline.
 *
 * Verifies the full scrape cycle without mocks:
 *   1. API server is reachable and /sources/status responds
 *   2. POST /sources/123movies triggers a real scrape of 123movieshd.com
 *   3. Scraped movies are persisted with valid fields (title, imdb_id,
 *      source_url, imdb_rating >= 6.0) and appear in GET /movies
 *   4. Idempotency: re-running the scrape does not inflate movie count
 *      (INSERT OR IGNORE prevents duplicates)
 *   5. Conflict guard: a concurrent scrape request returns 409
 *
 * Requires: API dev server running (npm run dev in /api) — API on :3001.
 * NOTE: Uses 127.0.0.1 — Playwright resolves "localhost" to IPv6 ::1 on macOS.
 * NOTE: Scraping 1 page involves real HTTP requests to 123movieshd.com + OMDb.
 *       Allow up to 120s for the scrape to complete.
 */

const API = 'http://127.0.0.1:3001/api';
const SCRAPE = 'http://127.0.0.1:3001/api/scrape';

test.describe.serial('123movies scraper e2e', () => {
  let movieCountBefore = 0;
  let scrapeResult;

  // ─── 1. API health ────────────────────────────────────────────────────────

  test('1. API server is up and /sources/status responds', async ({ request }) => {
    const res = await request.get(`${SCRAPE}/status`);
    expect(res.ok(), `GET /scrape/status must return 200 (got ${res.status()})`).toBeTruthy();

    const body = await res.json();
    console.log('[test 1] Status:', JSON.stringify(body));

    expect(typeof body.scraping, 'scraping field must be boolean').toBe('boolean');
    expect(typeof body.totalMovies, 'totalMovies field must be a number').toBe('number');

    // Record baseline movie count so we can compare after scrape
    movieCountBefore = body.totalMovies;
    console.log(`[test 1] Baseline movie count: ${movieCountBefore}`);
  });

  // ─── 2. Trigger scrape ───────────────────────────────────────────────────

  test('2. POST /sources/123movies runs scrape and returns ok', async ({ request }) => {
    // Scraping 1 page: ~10-30 items × OMDb lookup (~200ms each) ≈ up to 60s
    test.setTimeout(120000);

    console.log('[test 2] Triggering 123movies scrape (1 page)...');
    const res = await request.post(`${SCRAPE}/123movies`, {
      data: { pages: 1 },
      timeout: 110000,
    });

    console.log(`[test 2] Scrape response status: ${res.status()}`);
    expect(
      res.ok(),
      `POST /sources/123movies must return 200 (got ${res.status()}). ` +
      'Check that the API server is running and 123movieshd.com is reachable.'
    ).toBeTruthy();

    scrapeResult = await res.json();
    console.log('[test 2] Scrape result:', JSON.stringify(scrapeResult));

    expect(scrapeResult.ok, 'Response must have ok: true').toBe(true);
    expect(typeof scrapeResult.saved, 'Response must include saved count').toBe('number');
    expect(scrapeResult.saved, 'saved count must be non-negative').toBeGreaterThanOrEqual(0);

    console.log(`[test 2] ✅ Scrape completed — saved ${scrapeResult.saved} new movies`);
  });

  // ─── 3. Movies persisted with valid fields ────────────────────────────────

  test('3. Scraped movies appear in DB with valid fields', async ({ request }) => {
    const res = await request.get(`${API}/movies?limit=100&source=123movies`);
    expect(res.ok(), 'GET /movies?source=123movies must return 200').toBeTruthy();

    const body = await res.json();
    const movies = body.movies ?? body;
    const from123 = movies.filter(m => m.source === '123movies' || m.source === 'both');

    expect(from123.length, 'Must have at least one 123movies movie in DB after scrape').toBeGreaterThan(0);
    console.log(`[test 3] Found ${from123.length} 123movies movies in DB`);

    // Validate fields on a sample of movies (non-series, since series use series_imdb_id)
    const sampleMovies = from123.filter(m => m.type !== 'series').slice(0, 5);
    const sampleSeries = from123.filter(m => m.type === 'series').slice(0, 5);

    for (const m of sampleMovies) {
      expect(m.title, 'Movie must have a title').toBeTruthy();
      expect(m.imdb_id, `"${m.title}" must have imdb_id`).toMatch(/^tt\d+$/);
      expect(m.source_url, `"${m.title}" must have source_url`).toContain('123movieshd.com/film/');
      expect(m.imdb_rating, `"${m.title}" must have imdb_rating >= 6.0`).toBeGreaterThanOrEqual(6.0);
      expect(m.type, `"${m.title}" must have type = movie`).toBe('movie');
      console.log(`[test 3] ✓ movie: "${m.title}" (${m.imdb_id}) rating=${m.imdb_rating}`);
    }

    for (const m of sampleSeries) {
      expect(m.title, 'Series must have a title').toBeTruthy();
      const effectiveId = m.series_imdb_id ?? m.imdb_id;
      expect(effectiveId, `"${m.title}" must have series_imdb_id or imdb_id`).toMatch(/^tt\d+$/);
      expect(m.source_url, `"${m.title}" must have source_url`).toContain('123movieshd.com');
      expect(m.type, `"${m.title}" must have type = series`).toBe('series');
      console.log(`[test 3] ✓ series: "${m.title}" s${m.season ?? '?'}e${m.episode ?? '?'}`);
    }
  });

  // ─── 4. Idempotency — no duplicate rows ──────────────────────────────────

  test('4. Re-running scrape does not create duplicate movies', async ({ request }) => {
    test.setTimeout(120000);

    // Get current movie count before second scrape
    const statusBefore = await request.get(`${SCRAPE}/status`);
    const { totalMovies: countBefore } = await statusBefore.json();
    console.log(`[test 4] Movie count before second scrape: ${countBefore}`);

    // Run scrape again with the same single page
    const res = await request.post(`${SCRAPE}/123movies`, {
      data: { pages: 1 },
      timeout: 110000,
    });
    expect(res.ok(), 'Second scrape must return 200').toBeTruthy();

    const result = await res.json();
    console.log(`[test 4] Second scrape saved: ${result.saved}`);

    // Get count after second scrape
    const statusAfter = await request.get(`${SCRAPE}/status`);
    const { totalMovies: countAfter } = await statusAfter.json();
    console.log(`[test 4] Movie count after second scrape: ${countAfter}`);

    // The count should be the same or only slightly higher (new items may have been
    // added to 123movies between the two scrapes, but no existing rows should be duped)
    expect(
      countAfter,
      `Movie count must not decrease after re-scrape (was ${countBefore}, now ${countAfter})`
    ).toBeGreaterThanOrEqual(countBefore);

    // If the scraper is working correctly, saved should be 0 (all already in DB)
    // Allow a small number of new saves in case 123movies updated their listings
    expect(
      result.saved,
      `Re-scraping same page should save 0 new movies (INSERT OR IGNORE), got ${result.saved}`
    ).toBe(0);

    console.log('[test 4] ✅ Idempotency confirmed — no duplicates created');
  });

  // ─── 5. Conflict guard — 409 on concurrent scrape ────────────────────────

  test('5. Concurrent scrape request returns 409 Conflict', async ({ request }) => {
    test.setTimeout(180000);

    // Start a background scrape (pages=2 to give it enough time to still be running)
    const firstScrapePromise = request.post(`${SCRAPE}/123movies`, {
      data: { pages: 2 },
      timeout: 170000,
    });

    // Give the first request a moment to acquire the scraping lock
    await new Promise(r => setTimeout(r, 500));

    // Second concurrent request must be rejected
    const secondRes = await request.post(`${SCRAPE}/123movies`, {
      data: { pages: 1 },
    });

    console.log(`[test 5] Concurrent request status: ${secondRes.status()}`);
    expect(secondRes.status(), 'Concurrent scrape must return 409 Conflict').toBe(409);

    const body = await secondRes.json();
    expect(body.error, 'Conflict response must include error message').toContain('progress');
    // Route returns: 'Scrape already in progress'
    console.log('[test 5] ✅ Conflict guard working:', body.error);

    // Wait for the first scrape to finish so it doesn't bleed into other tests
    const firstRes = await firstScrapePromise;
    console.log(`[test 5] First scrape finished with status ${firstRes.status()}`);
  });

  // ─── 6. Scraped movies have poster and plot ───────────────────────────────

  test('6. Scraped movies have poster and plot from OMDb', async ({ request }) => {
    const res = await request.get(`${API}/movies?limit=50&source=123movies`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    const movies = (body.movies ?? body).filter(m => m.source === '123movies' || m.source === 'both');
    const nonSeries = movies.filter(m => m.type !== 'series');

    expect(nonSeries.length, 'Need at least one non-series 123movies movie').toBeGreaterThan(0);

    // Check that OMDb metadata was populated (poster and plot should be present)
    const withPoster = nonSeries.filter(m => m.poster && m.poster.startsWith('http'));
    const withPlot = nonSeries.filter(m => m.plot && m.plot.length > 10);

    console.log(`[test 6] ${withPoster.length}/${nonSeries.length} movies have poster`);
    console.log(`[test 6] ${withPlot.length}/${nonSeries.length} movies have plot`);

    // At least 80% should have poster and plot (some obscure titles may not be in OMDb)
    const posterRatio = withPoster.length / nonSeries.length;
    const plotRatio = withPlot.length / nonSeries.length;

    expect(
      posterRatio,
      `At least 80% of scraped movies must have a poster URL (got ${Math.round(posterRatio * 100)}%)`
    ).toBeGreaterThanOrEqual(0.8);

    expect(
      plotRatio,
      `At least 80% of scraped movies must have a plot (got ${Math.round(plotRatio * 100)}%)`
    ).toBeGreaterThanOrEqual(0.8);

    console.log('[test 6] ✅ OMDb metadata populated correctly');
  });

  // ─── 7. Scrape log recorded ───────────────────────────────────────────────

  test('7. Scrape log entry recorded after scrape', async ({ request }) => {
    const res = await request.get(`${SCRAPE}/status`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    console.log('[test 7] Status after all scrapes:', JSON.stringify(body));

    expect(body.lastScrape, 'lastScrape must be present after scraping').toBeTruthy();
    expect(body.lastScrape.source, 'lastScrape.source must be "123movies"').toBe('123movies');
    expect(typeof body.lastScrape.count, 'lastScrape.count must be a number').toBe('number');

    const totalMovies = body.totalMovies;
    expect(totalMovies, 'Total movies must be >= baseline').toBeGreaterThanOrEqual(movieCountBefore);

    console.log(`[test 7] ✅ Scrape log: source=${body.lastScrape.source} count=${body.lastScrape.count} total=${totalMovies}`);
  });
});
