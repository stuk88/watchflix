import { chromium } from 'playwright-core';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Get a fresh embed URL from the API
const res = await fetch('http://localhost:3001/api/movies/12408/123embed?server=2');
const { embedUrl } = await res.json();
console.log('Embed URL:', embedUrl);

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const allRequests = [];
page.on('request', req => allRequests.push(req.url()));

await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(6000);

const iframeUrls = await page.evaluate(() =>
  Array.from(document.querySelectorAll('iframe')).map(f => f.src || f.getAttribute('data-src') || '')
);
const title = await page.title();
const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || '');

console.log('\nTitle:', title);
console.log('\nBody text:', bodyText);
console.log('\nIframes:', iframeUrls);
console.log('\nAll requests (first 20):');
allRequests.slice(0, 20).forEach(u => console.log(' ', u.substring(0, 120)));

await browser.close();
