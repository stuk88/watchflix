/**
 * E2E tests: subtitle file selection + Hebrew RTL rendering.
 * Uses The Passion of the Christ (id 12454) with Hebrew subtitles.
 *
 * Run: node api/tests/e2e-subtitles.test.mjs
 */
import { chromium } from 'playwright-core';

const BROWSER = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = 'http://localhost:3001';
let browser, page;
let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.log(`  FAIL: ${name}\n    ${e.message}`); failed++; }
}

async function setup() {
  browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function startTorrentPlayer(movieId) {
  await page.goto(`${APP}/movie/${movieId}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForSelector('.player-start', { timeout: 5000 });
  await page.click('.player-start');
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(5000);
    if (await page.evaluate(() => document.querySelector('video')?.readyState >= 3)) return true;
  }
  return false;
}

async function run() {
  try { await (await fetch(`${APP}/api/health`)).json(); }
  catch { console.error('App not running'); process.exit(1); }

  console.log('Subtitle E2E Tests (The Passion of the Christ)\n');
  await setup();

  // Test 1: CC menu shows multiple subtitle files (not just language names)
  await test('CC menu shows subtitle files per language', async () => {
    const loaded = await startTorrentPlayer(12454);
    if (!loaded) throw new Error('Torrent did not connect');
    await page.waitForTimeout(3000);

    const menuItems = await page.evaluate(() => {
      const items = document.querySelectorAll('.vjs-subs-caps-button .vjs-menu-item');
      return Array.from(items).map(i => i.textContent.trim());
    });

    // Should have more items than just language names (file-level entries)
    const hebrewItems = menuItems.filter(l => l.includes('Hebrew'));
    console.log(`    Total CC items: ${menuItems.length}`);
    console.log(`    Hebrew entries: ${hebrewItems.length}`);
    console.log(`    Sample: ${hebrewItems.slice(0, 2).join(' | ')}`);

    if (hebrewItems.length === 0) throw new Error('No Hebrew in CC menu');
    // If multiple Hebrew files exist, they should show as separate entries
    if (menuItems.length < 3) throw new Error('CC menu has too few items: ' + menuItems.length);
  });

  // Test 2: Selecting Hebrew subtitle shows RTL text at 3:04
  await test('Hebrew subtitle renders RTL at 3:04', async () => {
    // Select Hebrew from CC menu
    await page.evaluate(() => {
      const items = document.querySelectorAll('.vjs-subs-caps-button .vjs-menu-item');
      for (const i of items) { if (i.textContent.trim().includes('Hebrew')) { i.click(); break; } }
    });
    await page.waitForTimeout(5000); // wait for cues to lazy-load

    // Seek to 3:04 (184s) where there's Hebrew dialogue
    await page.evaluate(() => {
      const v = document.querySelector('video');
      v.currentTime = 184;
      v.play().catch(() => {});
    });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      const display = document.querySelector('.vjs-text-track-display');
      const innerDivs = display?.querySelectorAll('div') || [];
      let cueDir = '';
      for (const d of innerDivs) {
        const cs = window.getComputedStyle(d);
        if (cs.direction === 'rtl') { cueDir = 'rtl'; break; }
      }
      return {
        text: display?.innerText?.trim()?.substring(0, 100) || '',
        displayDir: display?.style.direction || '',
        cueDir,
      };
    });

    console.log(`    Text: ${result.text}`);
    console.log(`    Display dir: ${result.displayDir}`);
    console.log(`    Cue div dir: ${result.cueDir}`);

    if (!result.text) throw new Error('No subtitle text at 3:04');
    // Hebrew characters should be present
    if (!/[\u0590-\u05FF]/.test(result.text)) throw new Error('Text is not Hebrew: ' + result.text);
    if (result.displayDir !== 'rtl' && result.cueDir !== 'rtl') throw new Error('Direction is not RTL');

    await page.screenshot({ path: '/tmp/e2e-hebrew-rtl.png' });
    console.log(`    Screenshot: /tmp/e2e-hebrew-rtl.png`);
  });

  // Test 3: Hebrew text contains RTL embedding marks for correct bidi rendering
  await test('Hebrew cues have RTL embedding marks', async () => {
    await page.evaluate(() => { document.querySelector('video').currentTime = 184; });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.querySelector('.vjs-text-track-display')?.innerText || '');
    console.log(`    Raw text bytes: ${[...text].slice(0, 5).map(c => 'U+' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(' ')}`);
    // Should contain RTL embedding marks U+202B at start
    const hasRTLEmbed = text.includes('\u202B');
    console.log(`    Has RTL embed mark: ${hasRTLEmbed}`);
    // Should contain Hebrew chars
    const hasHebrew = /[\u0590-\u05FF]/.test(text);
    console.log(`    Has Hebrew chars: ${hasHebrew}`);
    if (!hasRTLEmbed) throw new Error('Missing RTL embedding marks in cue text');
    if (!hasHebrew) throw new Error('No Hebrew characters found');
  });

  // Test 4: Switching to English subtitle clears RTL
  await test('Switching to English clears RTL direction', async () => {
    await page.evaluate(() => {
      const items = document.querySelectorAll('.vjs-subs-caps-button .vjs-menu-item');
      for (const i of items) { if (i.textContent.trim().includes('English')) { i.click(); break; } }
    });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { document.querySelector('video').currentTime = 60; });
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      const display = document.querySelector('.vjs-text-track-display');
      return { dir: display?.style.direction || 'not-set', text: display?.innerText?.trim()?.substring(0, 50) || '' };
    });
    console.log(`    Dir: ${result.dir} | Text: ${result.text}`);
    if (result.dir === 'rtl') throw new Error('RTL not cleared after switching to English');
  });

  await browser.close();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
