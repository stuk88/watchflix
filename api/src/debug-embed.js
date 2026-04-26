import { chromium } from 'playwright-core';
import db from './db.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const movie = db.prepare("SELECT id, title, source_url FROM movies WHERE (source='123movies' OR source='both') AND source_url IS NOT NULL LIMIT 1").get();
console.log('Testing:', movie?.title, movie?.source_url);

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-features=IsolateOrigins,site-per-process'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();

// Log every frame that attaches
page.on('frameattached', frame => {
  const url = frame.url();
  if (url && url !== 'about:blank') console.log('  FRAME attached:', url);
});
page.on('framenavigated', frame => {
  const url = frame.url();
  if (url && url !== 'about:blank' && frame !== page.mainFrame()) console.log('  FRAME nav:', url);
});

await page.goto(movie.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1000);

console.log('\nClicking #play-now...');
await page.click('#play-now').catch(e => console.log('  play-now error:', e.message));

console.log('Waiting 12s for iframes to load...');
await page.waitForTimeout(12000);

// Dump all iframes in the DOM
const domIframes = await page.evaluate(() =>
  [...document.querySelectorAll('iframe')].map(f => ({
    src: f.src,
    dataSrc: f.getAttribute('data-src'),
    id: f.id,
    className: f.className,
  }))
);
console.log('\nDOM iframes:', JSON.stringify(domIframes, null, 2));

// Also check all frames Playwright knows about
console.log('\nPlaywright frames:');
for (const frame of page.frames()) {
  if (frame.url() !== 'about:blank') console.log(' ', frame.url());
}

await browser.close();
