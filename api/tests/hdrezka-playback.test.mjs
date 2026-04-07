/**
 * Playwright E2E test: verify Hdrezka pages load and contain a video player.
 * Also tests episode scraping from a real detail page.
 *
 * Run: node api/tests/hdrezka-playback.test.mjs
 */
import { chromium } from 'playwright-core';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let browser, context;

async function setup() {
  browser = await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  context = await browser.newContext({ userAgent: UA });
}

async function teardown() {
  if (context) await context.close();
  if (browser) await browser.close();
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
  return true;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function run() {
  console.log('Hdrezka Playback Tests\n');
  await setup();
  let passed = 0;
  let failed = 0;

  // Test 1: Hdrezka homepage loads
  const r1 = await test('Hdrezka homepage loads', async () => {
    const page = await context.newPage();
    await page.goto('https://hdrezka.ag', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    assert(title.length > 0, 'Page has no title');
    await page.close();
  });
  r1 ? passed++ : failed++;

  // Test 2: Hdrezka movie detail page loads with player
  const r2 = await test('Hdrezka movie page has player', async () => {
    const page = await context.newPage();
    // Get a movie URL from the homepage
    await page.goto('https://hdrezka.ag/films/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const movieUrl = await page.$eval('.b-content__inline_item-link a', el => el.href);
    assert(movieUrl, 'No movie link found on films page');

    await page.goto(movieUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for player area
    const hasPlayer = await page.$('#cdnplayer, .b-player, #player, iframe[src*="player"]');
    const pageContent = await page.content();
    const hasPlayerMark = pageContent.includes('cdnplayer') || pageContent.includes('b-player') || pageContent.includes('pjax');
    assert(hasPlayer || hasPlayerMark, 'No player element found on movie page');
    await page.close();
  });
  r2 ? passed++ : failed++;

  // Test 3: Hdrezka series page has season/episode selectors
  const r3 = await test('Hdrezka series page has episode selectors', async () => {
    const page = await context.newPage();
    await page.goto('https://hdrezka.ag/series/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const seriesUrl = await page.$eval('.b-content__inline_item-link a', el => el.href);
    assert(seriesUrl, 'No series link found');

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Check for episode/season elements
    const seasonEls = await page.$$('.b-simple_season__list li');
    const episodeEls = await page.$$('.b-simple_episodes__list li');
    const translatorEls = await page.$$('.b-translators__list li');
    console.log(`    Seasons: ${seasonEls.length}, Episodes: ${episodeEls.length}, Translators: ${translatorEls.length}`);
    assert(episodeEls.length > 0 || seasonEls.length > 0 || translatorEls.length > 0, 'No episode/season selectors found');
    await page.close();
  });
  r3 ? passed++ : failed++;

  // Test 4: Episode scraping via Playwright (the actual fix)
  const r4 = await test('Scrape episodes from series detail page via Playwright', async () => {
    const page = await context.newPage();
    await page.goto('https://hdrezka.ag/series/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const seriesUrl = await page.$eval('.b-content__inline_item-link a', el => el.href);

    await page.goto(seriesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Extract episodes the same way the scraper should
    const episodes = await page.evaluate(() => {
      const eps = [];
      const seasonEls = document.querySelectorAll('.b-simple_season__list li');
      if (seasonEls.length > 0) {
        seasonEls.forEach(sEl => {
          const seasonNum = parseInt(sEl.getAttribute('data-tab_id') || sEl.textContent.match(/(\d+)/)?.[1]) || 1;
          const epEls = document.querySelectorAll(`.b-simple_episodes__list li[data-season_id="${seasonNum}"]`);
          if (epEls.length > 0) {
            epEls.forEach(eEl => {
              const epNum = parseInt(eEl.getAttribute('data-episode_id') || eEl.textContent.match(/(\d+)/)?.[1]) || 1;
              eps.push({ season: seasonNum, episode: epNum, title: eEl.textContent.trim().substring(0, 40) });
            });
          } else {
            eps.push({ season: seasonNum, episode: 1, title: `Season ${seasonNum}` });
          }
        });
      } else {
        const epEls = document.querySelectorAll('.b-simple_episodes__list li');
        epEls.forEach(eEl => {
          const epNum = parseInt(eEl.getAttribute('data-episode_id') || eEl.textContent.match(/(\d+)/)?.[1]) || 1;
          eps.push({ season: 1, episode: epNum, title: eEl.textContent.trim().substring(0, 40) });
        });
      }
      return eps;
    });

    console.log(`    Extracted ${episodes.length} episodes`);
    if (episodes.length > 0) {
      console.log(`    First: S${episodes[0].season}E${episodes[0].episode} - ${episodes[0].title}`);
      console.log(`    Last: S${episodes[episodes.length-1].season}E${episodes[episodes.length-1].episode} - ${episodes[episodes.length-1].title}`);
    }
    assert(episodes.length > 0, 'No episodes extracted');
    await page.close();
  });
  r4 ? passed++ : failed++;

  await teardown();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  teardown().then(() => process.exit(1));
});
