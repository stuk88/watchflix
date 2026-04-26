import { chromium } from 'playwright-core';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SOURCE_URL = 'https://ww6.123movieshd.com/film/the-dresden-sun-1630861003/';

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: false, // visible so we can see what's happening
  args: ['--no-sandbox', '--disable-features=IsolateOrigins,site-per-process'],
});

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ignoreHTTPSErrors: true,
});

const page = await ctx.newPage();

// Log ALL navigation events
page.on('framenavigated', frame => {
  console.log('FRAME NAV:', frame.url().substring(0, 150));
});

page.on('request', req => {
  const url = req.url();
  if (!url.includes('google') && !url.includes('analytics') && !url.includes('.png') && !url.includes('.jpg') && !url.includes('.css') && !url.includes('.woff')) {
    console.log('REQ:', req.resourceType().padEnd(12), url.substring(0, 150));
  }
});

console.log('Loading 123movies page...');
await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

console.log('\nClicking play...');
await page.click('#play-now', { timeout: 5000 }).catch(e => console.log('No #play-now:', e.message));

console.log('\nWaiting 15s for iframes...');
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(1000);
  const iframes = await page.evaluate(() => {
    return [...document.querySelectorAll('iframe')].map(f => f.src || f.getAttribute('data-src') || 'no-src');
  });
  if (iframes.length) console.log(`[${i+1}s] iframes:`, iframes);
}

await browser.close();
