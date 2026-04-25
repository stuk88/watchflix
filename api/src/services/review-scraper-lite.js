import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
};

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

async function fetchPage(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
  return data;
}

async function scrapeMetacriticSources(movieTitle) {
  const slug = movieTitle
    .replace(/['\u2018\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  let html;
  try {
    html = await fetchPage(`https://www.metacritic.com/movie/${slug}/critic-reviews/`);
  } catch {
    try {
      const searchHtml = await fetchPage(
        `https://www.metacritic.com/search/${encodeURIComponent(movieTitle)}/?category=movie`
      );
      const $s = cheerio.load(searchHtml);
      let moviePath = null;
      $s('a[href]').each((_, a) => {
        const href = $s(a).attr('href') || '';
        if (!moviePath && href.match(/^\/movie\/[a-z0-9-]+\/$/) && !href.includes('browse')) {
          moviePath = href;
        }
      });
      if (!moviePath) return [];
      html = await fetchPage(`https://www.metacritic.com${moviePath}critic-reviews/`);
    } catch {
      return [];
    }
  }

  const $ = cheerio.load(html);
  const reviews = [];
  const seen = new Set();

  $('.review-card').each((_, card) => {
    const el = $(card);
    const source = el.find('.review-card__header').text().trim();
    const scoreText = el.find('span').first().text().trim();
    const score = parseInt(scoreText) || 0;
    const snippet = el.find('.review-card__quote').text().trim();
    const url = el.find('a[href^=http]').attr('href') || '';

    if (!source || seen.has(source) || snippet.length < 30) return;
    seen.add(source);
    reviews.push({ source, snippet: snippet.slice(0, 500), url, score });
  });

  return reviews;
}

async function scrapeArticleText(url) {
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const selectors = ['article', '[role="article"]', '.review-body', '.entry-content', 'main'];
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 200) {
        return el.text().trim().slice(0, 6000);
      }
    }
    const paragraphs = $('p').map((_, p) => $(p).text().trim()).get().filter(t => t.length > 30);
    return paragraphs.join('\n').slice(0, 6000);
  } catch {
    return '';
  }
}

const CRITIC_SOURCES = [
  { name: 'Variety', searchUrl: (q) => `https://variety.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/reviews\/|\/film\/reviews\// },
  { name: 'The Hollywood Reporter', searchUrl: (q) => `https://www.hollywoodreporter.com/search/${encodeURIComponent(q + ' review')}`, linkPattern: /\/movies\/movie-reviews\// },
  { name: 'Rolling Stone', searchUrl: (q) => `https://www.rollingstone.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/movie-reviews\// },
  { name: 'The Guardian', searchUrl: (q) => `https://www.theguardian.com/film?query=${encodeURIComponent(q)}`, linkPattern: /\/film\/.*review/ },
  { name: 'Roger Ebert', searchUrl: (q) => `https://www.rogerebert.com/search#stq=${encodeURIComponent(q)}`, linkPattern: /\/reviews\// },
  { name: 'IndieWire', searchUrl: (q) => `https://www.indiewire.com/?s=${encodeURIComponent(q + ' review')}`, linkPattern: /\/criticism\/|\/reviews\// },
];

async function findReviewOnSite(movieTitle, site) {
  try {
    const html = await fetchPage(site.searchUrl(movieTitle));
    const $ = cheerio.load(html);
    const titleWords = movieTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    let reviewUrl = null;
    $('a[href]').each((_, a) => {
      if (reviewUrl) return;
      const href = $(a).attr('href') || '';
      const text = $(a).text().toLowerCase();
      const matchesPattern = site.linkPattern.test(href);
      const matchesTitle = titleWords.some(w => text.includes(w) || href.toLowerCase().includes(w));
      if (matchesPattern && matchesTitle) {
        reviewUrl = href.startsWith('http') ? href : new URL(href, site.searchUrl(movieTitle)).href;
      }
    });

    if (!reviewUrl) {
      $('a[href]').each((_, a) => {
        if (reviewUrl) return;
        const text = $(a).text().toLowerCase();
        if (titleWords.some(w => text.includes(w)) && text.includes('review')) {
          const href = $(a).attr('href') || '';
          reviewUrl = href.startsWith('http') ? href : new URL(href, site.searchUrl(movieTitle)).href;
        }
      });
    }

    if (!reviewUrl) return null;
    const text = await scrapeArticleText(reviewUrl);
    if (text.length < 100) return null;
    return { url: reviewUrl, text };
  } catch {
    return null;
  }
}

export async function getCriticScores(movieTitle, movieYear) {
  const results = [];
  const processedSources = new Set();
  const MAX_METACRITIC = 15;

  console.log(`[review-scraper-lite] Scraping reviews for "${movieTitle}"...`);

  const metacriticReviews = await scrapeMetacriticSources(movieTitle);
  console.log(`[review-scraper-lite] Found ${metacriticReviews.length} Metacritic sources`);

  for (const review of metacriticReviews.slice(0, MAX_METACRITIC)) {
    if (!review.source || /^\d+$/.test(review.source)) continue;
    if (review.snippet.length < 50) continue;
    try {
      const { scores, summary } = await analyzeWithLLM(review.snippet, movieTitle);
      results.push({ source: review.source, url: review.url, scores, summary });
      processedSources.add(review.source.toLowerCase());
    } catch (err) {
      console.error(`[review-scraper-lite] LLM error for ${review.source}:`, err.message);
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
    } catch {}
  }

  console.log(`[review-scraper-lite] Total: ${results.length} critic scores for "${movieTitle}"`);
  return results;
}
