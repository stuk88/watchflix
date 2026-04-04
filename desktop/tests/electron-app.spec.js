const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

const MAIN_JS = path.join(__dirname, '..', 'main.js');

test.describe.serial('Electron desktop app', () => {
  /** @type {import('@playwright/test').ElectronApplication} */
  let app;
  /** @type {import('@playwright/test').Page} */
  let window;

  test.beforeAll(async () => {
    // Launch Electron with main.js — dev mode connects to Vite on :5173
    app = await electron.launch({
      args: [MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  // ─── 1. Window opens and is visible ────────────────────────────────────────
  test('app launches with a visible window', async () => {
    test.setTimeout(30000);

    window = await app.firstWindow();
    expect(window, 'App must have at least one window').toBeTruthy();

    // Window starts with show:false — wait for ready-to-show which calls show()
    // Poll until the window becomes visible (content must load first)
    let visible = false;
    for (let i = 0; i < 40 && !visible; i++) {
      visible = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? win.isVisible() : false;
      });
      if (!visible) await new Promise(r => setTimeout(r, 500));
    }
    expect(visible, 'Main window must be visible').toBe(true);
    console.log('[test 1] Window is visible');
  });

  // ─── 2. Window has expected dimensions ─────────────────────────────────────
  test('window has expected dimensions', async () => {
    const { width, height } = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const [w, h] = win.getSize();
      return { width: w, height: h };
    });

    expect(width, 'Window width should be ~1280').toBeGreaterThanOrEqual(1200);
    expect(height, 'Window height should be ~800').toBeGreaterThanOrEqual(700);
    console.log(`[test 2] Window size: ${width}x${height}`);
  });

  // ─── 3. Window title is set ────────────────────────────────────────────────
  test('window title contains Watchflix', async () => {
    test.setTimeout(15000);
    // Wait for page to load fully so title is set
    await window.waitForLoadState('load');
    const title = await window.title();
    console.log(`[test 3] Window title: "${title}"`);
    expect(title.toLowerCase(), 'Title should contain watchflix').toContain('watchflix');
  });

  // ─── 4. UI loads and shows movie cards ─────────────────────────────────────
  test('UI loads and shows movie cards on home page', async () => {
    test.setTimeout(30000);

    await window.waitForSelector('.movie-card', { timeout: 20000 });
    const cardCount = await window.locator('.movie-card').count();
    console.log(`[test 4] Movie cards rendered: ${cardCount}`);
    expect(cardCount, 'Home page must show movie cards').toBeGreaterThan(0);
  });

  // ─── 5. API health check works from the renderer ──────────────────────────
  test('API health endpoint responds from within the app', async () => {
    const health = await window.evaluate(async () => {
      const res = await fetch('http://localhost:3001/api/health');
      return { status: res.status, body: await res.json() };
    });

    expect(health.status, 'API health must return 200').toBe(200);
    expect(health.body.ok, 'API health body must have ok: true').toBe(true);
    console.log('[test 5] API health OK from renderer');
  });

  // ─── 6. Navigate to movie detail page ──────────────────────────────────────
  test('clicking a movie card navigates to detail page', async () => {
    test.setTimeout(20000);

    await window.locator('.movie-card').first().click();
    const title = await window.waitForSelector('h1.hero-title', { timeout: 10000 });
    const text = (await title.textContent()).trim();
    console.log(`[test 6] Navigated to movie: "${text}"`);
    expect(text.length, 'Movie title must have text').toBeGreaterThan(0);
  });

  // ─── 7. Can navigate back to home ─────────────────────────────────────────
  test('can navigate back to home page', async () => {
    test.setTimeout(15000);

    const homeLink = await window.$('.logo, .nav-brand, a[href="/"]');
    if (homeLink) {
      await homeLink.click();
    } else {
      await window.goBack();
    }

    await window.waitForSelector('.movie-card', { timeout: 10000 });
    const count = await window.locator('.movie-card').count();
    expect(count, 'Home page must show movie cards after navigation').toBeGreaterThan(0);
    console.log(`[test 7] Back on home page with ${count} cards`);
  });

  // ─── 8. Window remains visible after navigation ───────────────────────────
  test('window remains visible after navigation', async () => {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return { exists: false };
      return {
        exists: true,
        visible: win.isVisible(),
        minimized: win.isMinimized(),
        destroyed: win.isDestroyed(),
      };
    });

    expect(state.exists, 'Window must still exist').toBe(true);
    expect(state.visible, 'Window must be visible').toBe(true);
    expect(state.minimized, 'Window must not be minimized').toBe(false);
    expect(state.destroyed, 'Window must not be destroyed').toBe(false);
    console.log('[test 8] Window state:', JSON.stringify(state));
  });

  // ─── 9. Renderer does not have nodeIntegration (security) ─────────────────
  test('renderer does not have nodeIntegration (security)', async () => {
    const hasNode = await window.evaluate(() => {
      return typeof require !== 'undefined' || typeof process !== 'undefined';
    });

    expect(hasNode, 'nodeIntegration must be disabled in renderer').toBe(false);
    console.log('[test 9] nodeIntegration correctly disabled');
  });

  // ─── 10. Only one window is open ──────────────────────────────────────────
  test('only one window is open', async () => {
    const windowCount = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });

    expect(windowCount, 'Only one window should be open').toBe(1);
    console.log(`[test 10] Window count: ${windowCount}`);
  });

  // ─── 11. 123movies embed loads in iframe ──────────────────────────────────
  test('123movies page loads in iframe when clicking Watch Online', async () => {
    test.setTimeout(60000);

    // Navigate to first movie that has a 123movies source
    const movieId = await window.evaluate(async () => {
      const res = await fetch('http://localhost:3001/api/movies');
      const data = await res.json();
      const movie = data.movies.find(m => m.source_url && m.source_url.includes('123movies'));
      return movie ? movie.id : null;
    });

    if (!movieId) {
      console.log('[test 11] SKIP — no movie with 123movies source_url');
      test.skip();
      return;
    }

    await window.goto(`http://localhost:${process.env.VITE_PORT || 5173}/movie/${movieId}`);
    await window.waitForSelector('.hero-title', { timeout: 10000 });

    // Click "Watch Online" start button
    const startBtn = window.locator('.player-start');
    if (!(await startBtn.count())) {
      console.log('[test 11] SKIP — no Watch Online button on this movie');
      test.skip();
      return;
    }
    await startBtn.click();

    // The iframe should appear with a 123movies src
    const iframe = window.locator('iframe.player-iframe');
    await iframe.waitFor({ state: 'attached', timeout: 10000 });
    const src = await iframe.getAttribute('src');
    console.log(`[test 11] Iframe src: ${src}`);
    expect(src, 'Iframe src must be a 123movies URL').toContain('123movie');

    // Wait a bit and confirm no crash — window still visible, iframe still attached
    await window.waitForTimeout(5000);
    const visible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win ? win.isVisible() : false;
    });
    expect(visible, 'Window must remain visible after iframe load').toBe(true);

    const iframeStillThere = await iframe.count();
    expect(iframeStillThere, 'Iframe must still be in DOM after load').toBe(1);
    console.log('[test 11] 123movies iframe loaded, no crash');
  });
});
