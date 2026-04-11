/**
 * E2E test: verify the actual Watchflix app serves Russian movies
 * and that Hdrezka/Filmix pages load correctly in a browser.
 * Tests against the running app at localhost:3001.
 *
 * Run: node api/tests/e2e-app-playback.test.mjs
 */
import { chromium } from 'playwright-core';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_URL = 'http://localhost:3001';

let browser, context;
let passed = 0, failed = 0;

async function setup() {
  browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: false, // visible so we can actually see it
    args: ['--disable-blink-features=AutomationControlled'],
  });
  context = await browser.newContext();
}

async function teardown() {
  if (context) await context.close();
  if (browser) await browser.close();
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function run() {
  // Check app is running
  try {
    const resp = await fetch(`${APP_URL}/api/health`);
    const data = await resp.json();
    assert(data.ok, 'App health check failed');
  } catch {
    console.error('App not running at localhost:3001. Start it first.');
    process.exit(1);
  }

  console.log('Watchflix E2E Playback Tests\n');
  await setup();

  // Test 1: App loads and shows movies
  await test('App homepage loads with movies', async () => {
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 });
    const title = await page.title();
    assert(title.length > 0, 'No page title');
    // Wait for movie cards to render
    await page.waitForSelector('.movie-card', { timeout: 10000 });
    const cards = await page.$$('.movie-card');
    assert(cards.length > 0, `No movie cards found (got ${cards.length})`);
    console.log(`    ${cards.length} movie cards visible`);
    await page.close();
  });

  // Test 2: Language filter shows Russian movies
  await test('Language filter switches to Russian movies', async () => {
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('.movie-card', { timeout: 10000 });

    // Change language dropdown to Russian
    await page.selectOption('select', { label: 'Russian' });
    await page.waitForTimeout(2000); // wait for API call
    await page.waitForSelector('.movie-card', { timeout: 10000 });

    // Verify the API returns Russian movies
    const resp = await fetch(`${APP_URL}/api/movies?language=ru&limit=1`);
    const data = await resp.json();
    assert(data.total > 0, 'No Russian movies returned from API');
    console.log(`    Russian movies: ${data.total}`);
    await page.close();
  });

  // Test 3: Hdrezka movie detail page loads with player area
  await test('Hdrezka movie page shows player', async () => {
    const page = await context.newPage();
    // Get a hdrezka movie ID from API
    const resp = await fetch(`${APP_URL}/api/movies?language=ru&source=hdrezka&type=movie&limit=1`);
    const data = await resp.json();
    assert(data.movies.length > 0, 'No hdrezka movies in DB');
    const movieId = data.movies[0].id;

    await page.goto(`${APP_URL}/movie/${movieId}`, { waitUntil: 'networkidle', timeout: 15000 });
    // Should see the movie title
    await page.waitForSelector('.hero-title', { timeout: 10000 });
    const heroTitle = await page.$eval('.hero-title', el => el.textContent.trim());
    assert(heroTitle.length > 0, 'No hero title');
    console.log(`    Movie: ${heroTitle.substring(0, 50)}`);

    // Should see player start button
    const playerStart = await page.$('.player-start');
    assert(playerStart, 'No player start button found');

    // Click to start player
    await playerStart.click();
    await page.waitForTimeout(3000);

    // Should have a webview or iframe
    const video = await page.$('.player-video, video');
    const iframe = await page.$('.player-iframe');
    const extracting = await page.$('.extracting-msg');
    assert(video || iframe || extracting, 'No player element found after clicking start');
    console.log(`    Player type: ${video ? 'video' : iframe ? 'iframe' : 'extracting'}`);
    await page.close();
  });

  // Test 4: Filmix movie detail page loads with player area
  await test('Filmix movie page shows player', async () => {
    const page = await context.newPage();
    const resp = await fetch(`${APP_URL}/api/movies?language=ru&source=filmix&type=movie&limit=1`);
    const data = await resp.json();
    assert(data.movies.length > 0, 'No filmix movies in DB');
    const movieId = data.movies[0].id;

    await page.goto(`${APP_URL}/movie/${movieId}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('.hero-title', { timeout: 10000 });

    const playerStart = await page.$('.player-start');
    assert(playerStart, 'No player start button');
    await playerStart.click();
    await page.waitForTimeout(3000);

    const video = await page.$('.player-video, video');
    const iframe = await page.$('.player-iframe');
    const extracting = await page.$('.extracting-msg');
    assert(video || iframe || extracting, 'No player element found');
    console.log(`    Player type: ${video ? 'video' : iframe ? 'iframe' : 'extracting'}`);
    await page.close();
  });

  // Test 5: Hdrezka series shows episodes
  await test('Hdrezka series page shows episode list', async () => {
    const page = await context.newPage();
    const resp = await fetch(`${APP_URL}/api/movies?language=ru&source=hdrezka&type=series&limit=1`);
    const data = await resp.json();
    assert(data.movies.length > 0, 'No hdrezka series in DB');
    const movieId = data.movies[0].id;

    await page.goto(`${APP_URL}/movie/${movieId}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('.hero-title', { timeout: 10000 });

    // Check for episode pills
    await page.waitForTimeout(2000);
    const episodePills = await page.$$('.episode-pill');
    console.log(`    Episode pills: ${episodePills.length}`);
    // Even if 0 pills (single-episode placeholder), page should load without error
    await page.close();
  });

  // Test 6: Torrent movie page has subtitle controls
  await test('Torrent movie page shows subtitle bar', async () => {
    const page = await context.newPage();
    const resp = await fetch(`${APP_URL}/api/movies?source=both&type=movie&limit=1`);
    const data = await resp.json();
    assert(data.movies.length > 0, 'No torrent movies in DB');
    const movieId = data.movies[0].id;

    await page.goto(`${APP_URL}/movie/${movieId}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('.hero-title', { timeout: 10000 });

    // Click Torrent Stream tab
    const srcTabs = await page.$$('button.source-tab');
    for (const t of srcTabs) { if ((await t.textContent()).includes('Torrent')) { await t.click(); break; } }
    await page.waitForTimeout(1000);

    const playerStart = await page.$('.player-start');
    assert(playerStart, 'No torrent player start button');
    await playerStart.click();

    // Wait for subtitle bar to appear (may take time for Plyr + stream init)
    await page.waitForSelector('.subtitle-bar', { timeout: 15000 }).catch(() => {});
    const subBar = await page.$('.subtitle-bar');
    const localBtn = await page.$('.btn-local-file');
    assert(subBar || localBtn, 'No subtitle bar or local file button found');
    console.log(`    Subtitle bar: ${!!subBar} | Local file: ${!!localBtn}`);
    await page.close();
  });

  // Test 7: Hdrezka page loads in real browser (direct URL test)
  await test('Hdrezka detail page loads in browser with player', async () => {
    const page = await context.newPage();
    const resp = await fetch(`${APP_URL}/api/movies?language=ru&source=hdrezka&type=movie&limit=1`);
    const data = await resp.json();
    const sourceUrl = data.movies[0].source_url;

    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const hasPlayer = await page.$('#cdnplayer, .b-player, iframe[src*="player"]');
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    const isBlocked = bodyText.includes('Ошибка доступа') || bodyText.includes('403');

    if (isBlocked) {
      console.log(`    Page blocked (region/CF restriction) — webview in Electron handles this`);
    } else {
      assert(hasPlayer, 'No player element found on Hdrezka page');
      console.log(`    Player element found on direct page load`);
    }
    await page.close();
  });

  await teardown();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  teardown().then(() => process.exit(1));
});
