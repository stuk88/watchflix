import { chromium } from 'playwright-core';
import axios from 'axios';
import config from '../config.js';

const BROWSER_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SYSTEM_PROMPT = `You are a film critic analyst. Given a movie review article, extract numerical scores (1-10) for each of these filmmaking categories. Base scores ONLY on what the review discusses. If a category is not mentioned, estimate based on overall tone.

Categories:
- story: Plot, originality, dialogue, screenplay quality
- acting: Performances, character portrayals
- direction: Vision, pacing, coherence, directorial choices
- cinematography: Camera work, lighting, framing, visual style
- productionDesign: Sets, costumes, world-building, visual design
- editing: Flow, rhythm, scene transitions
- sound: Score, soundtrack, sound design
- emotionalImpact: Emotional resonance, memorability, lasting impression

Respond with ONLY valid JSON in this exact format, nothing else:
{"story":N,"acting":N,"direction":N,"cinematography":N,"productionDesign":N,"editing":N,"sound":N,"emotionalImpact":N,"summary":"One sentence summary of critic's overall sentiment"}`;

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      executablePath: BROWSER_PATH,
    });
  }
  return browserInstance;
}

async function newContext() {
  const browser = await getBrowser();
  return browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
}

async function analyzeWithLLM(reviewText, movieTitle) {
  const token = config.groqApiKey;
  if (!token) throw new Error('GROQ_API_KEY not set');

  const { data: response } = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Movie: "${movieTitle}"\n\nReview text:\n${reviewText}` },
      ],
      max_tokens: 300,
      temperature: 0.1,
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    }
  );

  const content = response.choices[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    scores: {
      story: parsed.story,
      acting: parsed.acting,
      direction: parsed.direction,
      cinematography: parsed.cinematography,
      productionDesign: parsed.productionDesign,
      editing: parsed.editing,
      sound: parsed.sound,
      emotionalImpact: parsed.emotionalImpact,
    },
    summary: parsed.summary || '',
  };
}

const CRITIC_SOURCES = [
  { name: 'Variety', searchUrl: (q) => `https://variety.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/reviews\/|\/film\/reviews\// },
  { name: 'The Hollywood Reporter', searchUrl: (q) => `https://www.hollywoodreporter.com/search/${encodeURIComponent(q + ' review')}`, linkPattern: /\/movies\/movie-reviews\// },
  { name: 'Empire', searchUrl: (q) => `https://www.empireonline.com/search/?q=${encodeURIComponent(q)}`, linkPattern: /\/movies\/reviews\// },
  { name: 'Rolling Stone', searchUrl: (q) => `https://www.rollingstone.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/movie-reviews\// },
  { name: 'The Guardian', searchUrl: (q) => `https://www.theguardian.com/film?query=${encodeURIComponent(q)}`, linkPattern: /\/film\/.*review/ },
  { name: 'Roger Ebert', searchUrl: (q) => `https://www.rogerebert.com/search#stq=${encodeURIComponent(q)}`, linkPattern: /\/reviews\// },
  { name: 'IndieWire', searchUrl: (q) => `https://www.indiewire.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/criticism\/|\/reviews\// },
  { name: 'The A.V. Club', searchUrl: (q) => `https://www.avclub.com/search?q=${encodeURIComponent(q + ' review')}`, linkPattern: /avclub\.com\// },
  { name: 'IGN', searchUrl: (q) => `https://www.ign.com/search?q=${encodeURIComponent(q + ' review')}`, linkPattern: /\/articles\/.*review/ },
  { name: 'Time', searchUrl: (q) => `https://time.com/search/?q=${encodeURIComponent(q + ' review')}`, linkPattern: /time\.com\// },
];

async function findReviewOnSite(movieTitle, site) {
  const context = await newContext();
  const page = await context.newPage();
  try {
    await page.goto(site.searchUrl(movieTitle), { waitUntil: 'networkidle', timeout: 12000 });

    const reviewUrl = await page.evaluate(
      ({ pattern, title }) => {
        const regex = new RegExp(pattern);
        const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const anchors = document.querySelectorAll('a[href]');
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const text = (a.textContent || '').toLowerCase();
          const hrefLower = href.toLowerCase();
          if (regex.test(href) && titleWords.some(w => text.includes(w) || hrefLower.includes(w))) {
            return href.startsWith('http') ? href : new URL(href, document.baseURI).href;
          }
        }
        for (const a of anchors) {
          const text = (a.textContent || '').toLowerCase();
          if (titleWords.some(w => text.includes(w)) && text.includes('review')) {
            const href = a.getAttribute('href') || '';
            return href.startsWith('http') ? href : new URL(href, document.baseURI).href;
          }
        }
        return null;
      },
      { pattern: site.linkPattern.source, title: movieTitle }
    );

    if (!reviewUrl) return null;

    await page.goto(reviewUrl, { waitUntil: 'networkidle', timeout: 15000 });
    const text = await page.evaluate(() => {
      const selectors = ['article', '[role="article"]', '.review-body', '.entry-content', 'main'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 200) {
          return el.textContent.trim();
        }
      }
      return Array.from(document.querySelectorAll('p'))
        .map(p => p.textContent?.trim() || '')
        .filter(t => t.length > 30)
        .join('\n');
    });

    if (text.length < 100) return null;
    return { url: reviewUrl, text: text.slice(0, 6000) };
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

async function scrapeMetacriticSources(movieTitle) {
  const context = await newContext();
  const page = await context.newPage();
  try {
    const slug = movieTitle
      .replace(/['\u2018\u2019]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    let metacriticUrl = null;

    const resp = await page.goto(
      `https://www.metacritic.com/movie/${slug}/critic-reviews/`,
      { waitUntil: 'domcontentloaded', timeout: 10000 }
    ).catch(() => null);

    if (resp && resp.status() === 200) {
      metacriticUrl = `https://www.metacritic.com/movie/${slug}/critic-reviews/`;
    }

    if (!metacriticUrl) {
      await page.goto(
        `https://www.metacritic.com/search/${encodeURIComponent(movieTitle)}/?category=movie`,
        { waitUntil: 'domcontentloaded', timeout: 10000 }
      ).catch(() => null);
      await page.waitForTimeout(3000);

      const foundUrl = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href]');
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          if (href.match(/^\/movie\/[a-z0-9-]+\/$/) && !href.includes('browse')) {
            return href;
          }
        }
        return null;
      });

      if (foundUrl) {
        metacriticUrl = `https://www.metacritic.com${foundUrl}critic-reviews/`;
        await page.goto(metacriticUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      }
    }

    if (!metacriticUrl) return [];

    await page.waitForTimeout(5000);

    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    // Collect external review URLs keyed by source name
    const urlMap = await page.evaluate(() => {
      const map = {};
      const anchors = document.querySelectorAll('a[href^="http"]');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (href.includes('metacritic.com')) continue;
        const text = (a.textContent || '').trim();
        if (text.includes('FULL REVIEW')) map[Object.keys(map).length] = href;
      }
      return map;
    });
    const urls = Object.values(urlMap);

    // Parse reviews from body text (reliable across Metacritic layout changes)
    const bodyText = await page.evaluate(() => document.body.innerText);
    const blocks = bodyText.split('FULL REVIEW');
    const reviews = [];
    const seen = new Set();
    let urlIdx = 0;

    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      let score = null, source = null, snippet = '', author = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!author && line.startsWith('By ')) { author = line; continue; }
        if (author && !snippet && !source && line.length > 40) { snippet = line; continue; }
        if (snippet && !source && !/^\d+$/.test(line) && !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/.test(line)) { source = line; continue; }
        if (source && score === null && /^\d+$/.test(line)) { score = parseInt(line); break; }
      }
      if (!source || seen.has(source)) { urlIdx++; continue; }
      seen.add(source);
      reviews.push({
        source,
        snippet: snippet.slice(0, 500),
        url: urls[urlIdx] || '',
        score: score ?? 0,
      });
      urlIdx++;
    }

    return reviews;
  } catch {
    return [];
  } finally {
    await context.close();
  }
}

async function tryDirectSources(title, year, results, processed) {
  const slug = title
    .replace(/['\u2018\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const directUrls = [
    {
      name: 'Roger Ebert',
      urls: year
        ? [`https://www.rogerebert.com/reviews/${slug}-${year}`]
        : [`https://www.rogerebert.com/reviews/${slug}`],
    },
    {
      name: 'Rotten Tomatoes',
      urls: [
        `https://www.rottentomatoes.com/m/${slug.replace(/-/g, '_')}`,
        `https://www.rottentomatoes.com/m/${slug}`,
      ],
    },
    {
      name: 'Letterboxd',
      urls: [`https://letterboxd.com/film/${slug}/reviews/by/popular/`],
    },
  ];

  for (const source of directUrls) {
    if (processed.has(source.name.toLowerCase())) continue;

    const context = await newContext();
    try {
      for (const url of source.urls) {
        const page = await context.newPage();
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
          if (!resp || resp.status() !== 200) { await page.close(); continue; }
          await page.waitForTimeout(2000);

          const text = await page.evaluate(() => {
            if (document.location.hostname.includes('letterboxd')) {
              const reviews = document.querySelectorAll('.body-text, .review-body');
              return Array.from(reviews).slice(0, 5)
                .map(el => el.textContent?.trim() || '')
                .filter(t => t.length > 30)
                .join('\n\n');
            }
            const selectors = ['article', '[role="article"]', '.review-body', '.entry-content', 'main'];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.textContent && el.textContent.trim().length > 200) {
                return el.textContent.trim();
              }
            }
            return Array.from(document.querySelectorAll('p'))
              .map(p => p.textContent?.trim() || '')
              .filter(t => t.length > 30)
              .join('\n');
          });

          if (text.length < 100) { await page.close(); continue; }

          const { scores, summary } = await analyzeWithLLM(text.slice(0, 6000), title);
          results.push({ source: source.name, url, scores, summary });
          processed.add(source.name.toLowerCase());
          await page.close();
          break;
        } catch {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
}

export async function getCriticScores(movieTitle, movieYear) {
  const results = [];
  const processedSources = new Set();
  const MAX_METACRITIC_SOURCES = 15;

  console.log(`[review-scraper] Scraping reviews for "${movieTitle}"...`);

  const metacriticReviews = await scrapeMetacriticSources(movieTitle);
  console.log(`[review-scraper] Found ${metacriticReviews.length} Metacritic sources`);

  for (const review of metacriticReviews.slice(0, MAX_METACRITIC_SOURCES)) {
    if (!review.source || /^\d+$/.test(review.source)) continue;
    try {
      const reviewText = review.snippet.length >= 50 ? review.snippet : '';
      if (!reviewText) continue;
      const { scores, summary } = await analyzeWithLLM(reviewText, movieTitle);
      results.push({ source: review.source, url: review.url, scores, summary });
      processedSources.add(review.source.toLowerCase());
    } catch (err) {
      console.error(`[review-scraper] LLM error for ${review.source}:`, err.message);
    }
  }

  for (const site of CRITIC_SOURCES) {
    if (processedSources.has(site.name.toLowerCase())) continue;
    try {
      const found = await findReviewOnSite(movieTitle, site);
      if (!found) continue;
      const { scores, summary } = await analyzeWithLLM(found.text, movieTitle);
      results.push({ source: site.name, url: found.url, scores, summary });
      processedSources.add(site.name.toLowerCase());
    } catch {
      // skip
    }
  }

  await tryDirectSources(movieTitle, movieYear, results, processedSources);

  console.log(`[review-scraper] Total: ${results.length} critic scores for "${movieTitle}"`);
  return results;
}
