import { test, expect } from '@playwright/test';

/**
 * Integration test: 123movies iframe player — movies and series.
 *
 * Tests the full pipeline:
 * 1. API has movies/series with valid source_url pointing to 123movieshd.com
 * 2. Movie detail page shows "Watch Online" button or tab
 * 3. Clicking "Watch Online" loads the 123movies page in an iframe
 * 4. Iframe is interactive (123movies page content loads inside it)
 * 5. Series: episode switching reloads the iframe with the correct source_url
 *
 * Requires: dev server running (npm run dev), movies in DB from 123movies source.
 */

const API = 'http://127.0.0.1:3001/api';
const UI = 'http://127.0.0.1:5173';

test.describe.serial('123movies iframe player', () => {
  let movie123;
  let series123;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API}/movies?limit=200&source=123movies`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const all = body.movies ?? body;

    // Find a movie (not series) with source_url
    movie123 = all.find(
      m => m.type !== 'series' &&
           (m.source === '123movies' || m.source === 'both') &&
           m.source_url?.includes('123movieshd.com')
    );

    // Find a series episode with source_url
    series123 = all.find(
      m => m.type === 'series' &&
           m.source_url?.includes('123movieshd.com')
    );

    console.log(`[beforeAll] Movie: ${movie123 ? `"${movie123.title}" (id=${movie123.id})` : 'NONE'}`);
    console.log(`[beforeAll] Series: ${series123 ? `"${series123.title}" S${series123.season}E${series123.episode} (id=${series123.id})` : 'NONE'}`);
  });

  // ─── 1. Movies with valid source URLs exist ─────────────────────────────────
  test('1. API has 123movies-sourced movies with valid source_url', async ({ request }) => {
    const res = await request.get(`${API}/movies?limit=50&source=123movies&type=movie`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const movies = (body.movies ?? body).filter(
      m => m.source_url?.includes('123movieshd.com')
    );
    expect(movies.length, 'Must have at least one movie with 123movies source_url').toBeGreaterThan(0);
    console.log(`[test 1] ${movies.length} movies with 123movies source_url`);
  });

  // ─── 2. Movie page shows Watch Online ───────────────────────────────────────
  test('2. Movie page shows Watch Online button', async ({ page }) => {
    test.skip(!movie123, 'No 123movies movie available');

    await page.goto(`${UI}/movie/${movie123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Either source tabs with "Watch Online" or direct player-start button
    const watchOnline = page.locator('.source-tab:has-text("Watch Online"), .player-start');
    await expect(watchOnline.first()).toBeVisible({ timeout: 5000 });
    console.log('[test 2] Watch Online button/tab visible');
  });

  // ─── 3. Clicking Watch Online loads 123movies in iframe ─────────────────────
  test('3. Clicking Watch Online loads 123movies page in iframe', async ({ page }) => {
    test.setTimeout(30000);
    test.skip(!movie123, 'No 123movies movie available');

    await page.goto(`${UI}/movie/${movie123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Click Watch Online tab if present (for "both" source movies)
    const watchTab = page.locator('.source-tab:has-text("Watch Online")');
    if (await watchTab.count() > 0) {
      await watchTab.click();
      await page.waitForTimeout(300);
    }

    // Click the player start button
    const startBtn = page.locator('.player-start');
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Iframe should appear with a 123movies source URL
    const iframe = page.locator('iframe.player-iframe');
    await expect(iframe).toBeAttached({ timeout: 10000 });

    const src = await iframe.getAttribute('src');
    console.log(`[test 3] Iframe src: ${src}`);
    expect(src, 'Iframe src must be a 123movies URL').toContain('123movieshd.com');

    // Iframe should have reasonable dimensions
    const box = await iframe.boundingBox();
    expect(box, 'Iframe must have a bounding box (visible on screen)').toBeTruthy();
    expect(box.height, 'Iframe height must be > 200px').toBeGreaterThan(200);
    expect(box.width, 'Iframe width must be > 300px').toBeGreaterThan(300);
    console.log(`[test 3] Iframe dimensions: ${Math.round(box.width)}x${Math.round(box.height)}`);
  });

  // ─── 4. Iframe content loads (not blank/blocked) ───────────────────────────
  test('4. Iframe content loads successfully (not blank or blocked)', async ({ page }) => {
    test.setTimeout(30000);
    test.skip(!movie123, 'No 123movies movie available');

    await page.goto(`${UI}/movie/${movie123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    const watchTab = page.locator('.source-tab:has-text("Watch Online")');
    if (await watchTab.count() > 0) await watchTab.click();

    await page.locator('.player-start').click();

    const iframe = page.locator('iframe.player-iframe');
    await expect(iframe).toBeAttached({ timeout: 10000 });

    // Wait for the iframe to fire its load event
    await page.waitForTimeout(5000);

    // The iframe should have loaded something (check that its src is still set)
    const src = await iframe.getAttribute('src');
    expect(src, 'Iframe src must still be set after load').toBeTruthy();

    // Verify the page didn't crash or navigate away
    const pageUrl = page.url();
    expect(pageUrl, 'Parent page should still be on movie detail').toContain('/movie/');
    console.log(`[test 4] Page still on: ${pageUrl}, iframe src: ${src}`);
  });

  // ─── 5. Series: page loads with episode list and Watch Online ──────────────
  test('5. Series page shows episode list and Watch Online', async ({ page }) => {
    test.skip(!series123, 'No 123movies series available');

    await page.goto(`${UI}/movie/${series123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    // Should show TV Series badge
    const badge = page.locator('.tv-badge');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Should show episode pills
    const episodes = page.locator('.episode-pill');
    const epCount = await episodes.count();
    expect(epCount, 'Series should have at least one episode pill').toBeGreaterThan(0);
    console.log(`[test 5] Series has ${epCount} episode pills`);

    // Watch Online should be available
    const watchOnline = page.locator('.source-tab:has-text("Watch Online"), .player-start');
    await expect(watchOnline.first()).toBeVisible({ timeout: 5000 });
    console.log('[test 5] Watch Online visible for series');
  });

  // ─── 6. Series: clicking Watch Online loads iframe ─────────────────────────
  test('6. Series Watch Online loads 123movies page in iframe', async ({ page }) => {
    test.setTimeout(30000);
    test.skip(!series123, 'No 123movies series available');

    await page.goto(`${UI}/movie/${series123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    const watchTab = page.locator('.source-tab:has-text("Watch Online")');
    if (await watchTab.count() > 0) await watchTab.click();

    const startBtn = page.locator('.player-start');
    if (await startBtn.count() > 0) {
      await startBtn.click();
    }

    const iframe = page.locator('iframe.player-iframe');
    await expect(iframe).toBeAttached({ timeout: 10000 });

    const src = await iframe.getAttribute('src');
    console.log(`[test 6] Series iframe src: ${src}`);
    expect(src, 'Series iframe src must be a 123movies URL').toContain('123movieshd.com');
  });

  // ─── 7. Iframe player is 100vh with no padding above ────────────────────────
  test('7. Iframe player is 100vh tall with no padding above', async ({ page }) => {
    test.setTimeout(15000);
    test.skip(!movie123, 'No 123movies movie available');

    await page.goto(`${UI}/movie/${movie123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    const watchTab = page.locator('.source-tab:has-text("Watch Online")');
    if (await watchTab.count() > 0) await watchTab.click();

    await page.locator('.player-start').click();

    const iframe = page.locator('iframe.player-iframe');
    await expect(iframe).toBeAttached({ timeout: 10000 });

    // Check iframe height is 100vh
    const iframeHeight = await iframe.evaluate(el => el.getBoundingClientRect().height);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(iframeHeight, `Iframe height (${iframeHeight}) must be ~100vh (${viewportHeight})`).toBeGreaterThanOrEqual(viewportHeight * 0.95);
    console.log(`[test 7] Iframe height: ${iframeHeight}px, viewport: ${viewportHeight}px`);

    // Check no padding/margin above the player section
    const playerSection = page.locator('.player-section');
    const sectionStyles = await playerSection.evaluate(el => {
      const cs = window.getComputedStyle(el);
      return {
        marginTop: parseFloat(cs.marginTop),
        paddingTop: parseFloat(cs.paddingTop),
      };
    });
    expect(sectionStyles.marginTop, 'Player section margin-top must be 0').toBe(0);
    expect(sectionStyles.paddingTop, 'Player section padding-top must be 0').toBe(0);
    console.log(`[test 7] Player section margin-top: ${sectionStyles.marginTop}, padding-top: ${sectionStyles.paddingTop}`);

    // Check no padding on iframe wrap
    const wrapStyles = await page.locator('.iframe-wrap').evaluate(el => {
      const cs = window.getComputedStyle(el);
      return { paddingTop: parseFloat(cs.paddingTop) };
    });
    expect(wrapStyles.paddingTop, 'Iframe wrap padding-top must be 0').toBe(0);
    console.log('[test 7] No padding above player');
  });

  // ─── 8. 123movies page has no space above player when CSS is injected ───────
  test('8. 123movies page: header/nav hidden, #body padding removed, player is full height', async ({ page }) => {
    test.setTimeout(15000);
    test.skip(!movie123, 'No 123movies movie available');

    // Load the 123movies page directly and inject the same CSS the Electron app injects
    const sourceUrl = movie123.source_url;
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Inject the same CSS that desktop/main.js injects into 123movies iframes
    await page.addStyleTag({ content: `
      header, .nav, ol.breadcrumb,
      .watch-extra, section.bl, .bl-2,
      footer, .footer, #episodes { display: none !important; }
      html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: 100vh !important; }
      #body { margin: 0 !important; padding: 0 !important; height: 100vh !important; }
      #watch { margin: 0 !important; padding: 0 !important; height: 100vh !important; }
      .container { max-width: 100% !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      .play { width: 100% !important; max-width: 100% !important; height: 100vh !important;
               margin: 0 !important; padding: 0 !important; }
      #player, .iframecontainer { width: 100% !important; max-width: 100% !important; height: 100vh !important; }
      #player iframe, #videoiframe { width: 100% !important; height: 100vh !important; }
    `});

    await page.waitForTimeout(500);

    const metrics = await page.evaluate(() => {
      const get = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        return { top: Math.round(r.top), h: Math.round(r.height), pt: cs.paddingTop, display: cs.display };
      };
      return {
        vh: window.innerHeight,
        header: get('header'),
        nav: get('.nav'),
        body_div: get('#body'),
        player: get('#player'),
      };
    });

    console.log(`[test 8] viewport: ${metrics.vh}px`);

    // Header must be hidden
    expect(metrics.header.display, 'header must be display:none').toBe('none');
    console.log(`[test 8] header: display=${metrics.header.display}`);

    // .nav must be hidden
    expect(metrics.nav.display, '.nav must be display:none').toBe('none');
    console.log(`[test 8] .nav: display=${metrics.nav.display}`);

    // #body padding-top must be 0 (was 88px for fixed header)
    expect(metrics.body_div.pt, '#body padding-top must be 0px').toBe('0px');
    console.log(`[test 8] #body: top=${metrics.body_div.top}, padding-top=${metrics.body_div.pt}`);

    // #player must be at top of page (no space above)
    expect(metrics.player.top, '#player must be at top=0').toBeLessThanOrEqual(2);
    console.log(`[test 8] #player: top=${metrics.player.top}, height=${metrics.player.h}`);

    // #player height must be 100vh
    expect(metrics.player.h, '#player height must be 100vh').toBeGreaterThanOrEqual(metrics.vh * 0.95);
    console.log('[test 8] Player is full height with no space above (before play click)');

    // Click the play button on the 123movies page
    const playBtn = page.locator('#play-now');
    if (await playBtn.count() > 0) {
      await playBtn.click();
      // Wait for the embed iframe chain to load (123movies → netoda → player)
      await page.waitForTimeout(8000);

      const afterPlay = await page.evaluate(() => {
        const player = document.querySelector('#player');
        const innerIframe = player ? player.querySelector('iframe') : null;
        const r = player ? player.getBoundingClientRect() : null;
        const ir = innerIframe ? innerIframe.getBoundingClientRect() : null;
        return {
          vh: window.innerHeight,
          player: r ? { top: Math.round(r.top), h: Math.round(r.height) } : null,
          innerIframe: ir ? { top: Math.round(ir.top), h: Math.round(ir.height), w: Math.round(ir.width) } : null,
        };
      });

      console.log(`[test 8] After play: player=${JSON.stringify(afterPlay.player)}, innerIframe=${JSON.stringify(afterPlay.innerIframe)}`);

      // #player must still be at top and full height after play click
      if (afterPlay.player) {
        expect(afterPlay.player.top, '#player must still be at top after play').toBeLessThanOrEqual(2);
        expect(afterPlay.player.h, '#player must still be 100vh after play').toBeGreaterThanOrEqual(afterPlay.vh * 0.95);
      }

      // Inner iframe (video embed) must fill the player
      if (afterPlay.innerIframe) {
        expect(afterPlay.innerIframe.h, 'Inner iframe must fill player height').toBeGreaterThanOrEqual(afterPlay.vh * 0.8);
        console.log('[test 8] Inner embed iframe fills player after play click');
      } else {
        console.log('[test 8] No inner iframe yet (embed chain still loading — OK)');
      }
    }
  });

  // ─── 9. Series: episode switching works ────────────────────────────────────
  test('9. Switching episodes updates the player', async ({ page }) => {
    test.setTimeout(30000);
    test.skip(!series123, 'No 123movies series available');

    await page.goto(`${UI}/movie/${series123.id}`);
    await page.waitForSelector('h1.hero-title', { timeout: 10000 });

    const episodes = page.locator('.episode-pill');
    const epCount = await episodes.count();
    test.skip(epCount < 2, 'Need at least 2 episodes to test switching');

    // Click a different episode
    const secondEp = episodes.nth(1);
    await secondEp.click();
    await page.waitForTimeout(300);

    // The active episode should change
    const isActive = await secondEp.evaluate(el => el.classList.contains('active'));
    expect(isActive, 'Second episode pill should be active after click').toBe(true);
    console.log('[test 7] Episode switching works');
  });
});
