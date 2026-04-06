import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

// Helper to read a source file
function readSrc(relativePath) {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

describe('Russian Sources - File Structure', () => {
  it('hdrezka scraper file exists and exports search + scrape', () => {
    const path = join(srcDir, 'scrapers', 'hdrezka.js');
    assert.ok(existsSync(path), 'hdrezka.js should exist');
    const content = readSrc('scrapers/hdrezka.js');
    assert.ok(content.includes('export async function searchHdrezka'), 'should export searchHdrezka');
    assert.ok(content.includes('export async function scrapeHdrezka'), 'should export scrapeHdrezka');
    assert.ok(content.includes("language: 'ru'"), 'should set language to ru');
    assert.ok(content.includes("source: 'hdrezka'"), 'should set source to hdrezka');
  });

  it('seazonvar scraper file exists and exports search + scrape', () => {
    const path = join(srcDir, 'scrapers', 'seazonvar.js');
    assert.ok(existsSync(path), 'seazonvar.js should exist');
    const content = readSrc('scrapers/seazonvar.js');
    assert.ok(content.includes('export async function searchSeazonvar'), 'should export searchSeazonvar');
    assert.ok(content.includes('export async function scrapeSeazonvar'), 'should export scrapeSeazonvar');
    assert.ok(content.includes("language: 'ru'"), 'should set language to ru');
    assert.ok(content.includes("source: 'seazonvar'"), 'should set source to seazonvar');
  });

  it('filmix scraper file exists and exports search + scrape', () => {
    const path = join(srcDir, 'scrapers', 'filmix.js');
    assert.ok(existsSync(path), 'filmix.js should exist');
    const content = readSrc('scrapers/filmix.js');
    assert.ok(content.includes('export async function searchFilmix'), 'should export searchFilmix');
    assert.ok(content.includes('export async function scrapeFilmix'), 'should export scrapeFilmix');
    assert.ok(content.includes("language: 'ru'"), 'should set language to ru');
    assert.ok(content.includes("source: 'filmix'"), 'should set source to filmix');
  });

  it('russian-search route file exists', () => {
    const path = join(srcDir, 'routes', 'russian-search.js');
    assert.ok(existsSync(path), 'russian-search.js should exist');
    const content = readSrc('routes/russian-search.js');
    assert.ok(content.includes('searchHdrezka'), 'should use hdrezka search');
    assert.ok(content.includes('searchSeazonvar'), 'should use seazonvar search');
    assert.ok(content.includes('searchFilmix'), 'should use filmix search');
    assert.ok(content.includes('Promise.allSettled'), 'should search all sources in parallel');
  });
});

describe('Russian Sources - Config', () => {
  it('config has Russian source URLs', () => {
    const content = readSrc('config.js');
    assert.ok(content.includes('hdrezka:'), 'should define hdrezka URL');
    assert.ok(content.includes('seazonvar:'), 'should define seazonvar URL');
    assert.ok(content.includes('filmix:'), 'should define filmix URL');
    assert.ok(content.includes('hdrezka.ag'), 'hdrezka URL should point to hdrezka.ag');
    assert.ok(content.includes('sezonvar.org'), 'seazonvar URL should point to sezonvar.org');
    assert.ok(content.includes('filmix.fm'), 'filmix URL should point to filmix.fm');
  });

  it('proxy allowed domains include Russian sites', () => {
    const content = readSrc('config.js');
    assert.ok(content.includes("'hdrezka.ag'"), 'hdrezka.ag should be in allowed domains');
    assert.ok(content.includes("'sezonvar.org'"), 'sezonvar.org should be in allowed domains');
    assert.ok(content.includes("'filmix.fm'"), 'filmix.fm should be in allowed domains');
  });
});

describe('Russian Sources - DB Migration', () => {
  it('db.js includes language column migration', () => {
    const content = readSrc('db.js');
    assert.ok(content.includes("ALTER TABLE movies ADD COLUMN language"), 'should add language column');
    assert.ok(content.includes("DEFAULT 'en'"), 'default should be en');
    assert.ok(content.includes('idx_language'), 'should create language index');
  });
});

describe('Russian Sources - API Routes', () => {
  it('movies route supports language filter', () => {
    const content = readSrc('routes/movies.js');
    assert.ok(content.includes('language'), 'should accept language query param');
    assert.ok(content.includes("COALESCE(language, 'en') = @language"), 'should filter by language');
  });

  it('sources route has Russian scrape endpoint', () => {
    const content = readSrc('routes/sources.js');
    assert.ok(content.includes("'/russian'"), 'should have /russian POST endpoint');
    assert.ok(content.includes('scrapeHdrezka'), 'should import hdrezka scraper');
    assert.ok(content.includes('scrapeSeazonvar'), 'should import seazonvar scraper');
    assert.ok(content.includes('scrapeFilmix'), 'should import filmix scraper');
  });

  it('index.js registers russian-search route', () => {
    const content = readSrc('index.js');
    assert.ok(content.includes('russian-search'), 'should import russian-search router');
    assert.ok(content.includes('/api/russian-search'), 'should mount at /api/russian-search');
  });
});

describe('Russian Sources - Scheduler', () => {
  it('scheduler includes Russian scrapers in full scrape', () => {
    const content = readSrc('services/scheduler.js');
    assert.ok(content.includes('scrapeHdrezka'), 'should import scrapeHdrezka');
    assert.ok(content.includes('scrapeSeazonvar'), 'should import scrapeSeazonvar');
    assert.ok(content.includes('scrapeFilmix'), 'should import scrapeFilmix');
    assert.ok(content.includes('Promise.allSettled'), 'should run Russian scrapers in parallel');
  });
});

describe('Russian Sources - UI Components', () => {
  const uiDir = join(__dirname, '..', '..', 'ui', 'src');

  it('FilterBar has language selector', () => {
    const content = readFileSync(join(uiDir, 'components', 'FilterBar.vue'), 'utf-8');
    assert.ok(content.includes('Language'), 'should have Language label');
    assert.ok(content.includes("value=\"en\""), 'should have English option');
    assert.ok(content.includes("value=\"ru\""), 'should have Russian option');
    assert.ok(content.includes('onLanguageChange'), 'should handle language change');
    assert.ok(content.includes('hdrezka'), 'should show Hdrezka source option');
    assert.ok(content.includes('seazonvar'), 'should show Seazonvar source option');
    assert.ok(content.includes('filmix'), 'should show Filmix source option');
  });

  it('movies store has language in filters', () => {
    const content = readFileSync(join(uiDir, 'stores', 'movies.js'), 'utf-8');
    assert.ok(content.includes("language: 'en'"), 'should default language to en');
    assert.ok(content.includes("params.language === 'all'"), 'should skip language=all in API call');
  });

  it('IframePlayer supports Russian source labels', () => {
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(content.includes('sourceName'), 'should accept sourceName prop');
    assert.ok(content.includes('hdrezka'), 'should have hdrezka label config');
    assert.ok(content.includes('seazonvar'), 'should have seazonvar label config');
    assert.ok(content.includes('filmix'), 'should have filmix label config');
  });

  it('Movie.vue handles Russian sources', () => {
    const content = readFileSync(join(uiDir, 'views', 'Movie.vue'), 'utf-8');
    assert.ok(content.includes('isRussianSource'), 'should detect Russian source');
    assert.ok(content.includes("['hdrezka', 'seazonvar', 'filmix']"), 'should list Russian sources');
    assert.ok(content.includes(':source-name="movie.source"'), 'should pass source name to IframePlayer');
  });

  it('MovieCard.vue shows Russian source badges', () => {
    const content = readFileSync(join(uiDir, 'components', 'MovieCard.vue'), 'utf-8');
    assert.ok(content.includes('sru'), 'should have sru class for Russian sources');
    assert.ok(content.includes('HDR'), 'should have HDR label for hdrezka');
    assert.ok(content.includes('SZV'), 'should have SZV label for seazonvar');
    assert.ok(content.includes('FLX'), 'should have FLX label for filmix');
  });

  it('RussianSearch view exists', () => {
    const path = join(uiDir, 'views', 'RussianSearch.vue');
    assert.ok(existsSync(path), 'RussianSearch.vue should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('/api/russian-search'), 'should call russian-search API');
    assert.ok(content.includes('/api/russian-search/add'), 'should support adding to library');
  });

  it('router includes russian-search route', () => {
    const content = readFileSync(join(uiDir, 'router.js'), 'utf-8');
    assert.ok(content.includes('/russian-search'), 'should have /russian-search route');
    assert.ok(content.includes('RussianSearch.vue'), 'should lazy-import RussianSearch view');
  });

  it('App.vue has Russian Search nav link', () => {
    const content = readFileSync(join(uiDir, 'App.vue'), 'utf-8');
    assert.ok(content.includes('/russian-search'), 'should link to russian-search');
    assert.ok(content.includes('RU Search'), 'should show RU Search label');
  });

  it('main.css has Russian source badge style', () => {
    const content = readFileSync(join(uiDir, 'styles', 'main.css'), 'utf-8');
    assert.ok(content.includes('.source-badge.sru'), 'should have .sru badge style');
  });
});

describe('Russian Sources - Scraper Logic', () => {
  it('hdrezka scraper uses cheerio for HTML parsing', () => {
    const content = readSrc('scrapers/hdrezka.js');
    assert.ok(content.includes("import * as cheerio"), 'should import cheerio');
    assert.ok(content.includes('cheerio.load'), 'should use cheerio.load');
    assert.ok(content.includes('.b-content__inline_item'), 'should target hdrezka item selectors');
  });

  it('hdrezka scraper scrapes multiple categories', () => {
    const content = readSrc('scrapers/hdrezka.js');
    assert.ok(content.includes('/films/'), 'should scrape films');
    assert.ok(content.includes('/series/'), 'should scrape series');
  });

  it('seazonvar scraper uses POST for search', () => {
    const content = readSrc('scrapers/seazonvar.js');
    assert.ok(content.includes('axios.post'), 'should use POST for search');
    assert.ok(content.includes('application/x-www-form-urlencoded'), 'should use form encoding');
  });

  it('filmix scraper URL-encodes search query', () => {
    const content = readSrc('scrapers/filmix.js');
    assert.ok(content.includes('encodeURIComponent(query)'), 'should encode search query');
    assert.ok(content.includes('/filmy/'), 'should scrape films category');
    assert.ok(content.includes('/serialy/'), 'should scrape series category');
  });

  it('all scrapers insert with language=ru', () => {
    for (const name of ['hdrezka', 'seazonvar', 'filmix']) {
      const content = readSrc(`scrapers/${name}.js`);
      assert.ok(content.includes("language: 'ru'"), `${name} should set language=ru`);
    }
  });

  it('all scrapers log to scrape_log', () => {
    for (const name of ['hdrezka', 'seazonvar', 'filmix']) {
      const content = readSrc(`scrapers/${name}.js`);
      assert.ok(content.includes('INSERT INTO scrape_log'), `${name} should log to scrape_log`);
    }
  });

  it('all scrapers respect rate limiting', () => {
    for (const name of ['hdrezka', 'seazonvar', 'filmix']) {
      const content = readSrc(`scrapers/${name}.js`);
      assert.ok(content.includes('setTimeout'), `${name} should have rate limiting delay`);
    }
  });
});

describe('Russian Sources - Search Route Logic', () => {
  it('russian-search route validates query length', () => {
    const content = readSrc('routes/russian-search.js');
    assert.ok(content.includes('q.trim().length < 2'), 'should reject queries shorter than 2 chars');
  });

  it('russian-search add route validates source', () => {
    const content = readSrc('routes/russian-search.js');
    assert.ok(content.includes("['hdrezka', 'seazonvar', 'filmix']"), 'should validate source is Russian');
  });

  it('russian-search add route checks for duplicates', () => {
    const content = readSrc('routes/russian-search.js');
    assert.ok(content.includes('alreadyExists'), 'should indicate when movie already exists');
  });
});

describe('Russian Sources - min_rating NULL handling', () => {
  it('movies route allows NULL imdb_rating through min_rating filter', () => {
    const content = readSrc('routes/movies.js');
    assert.ok(
      content.includes('imdb_rating IS NULL'),
      'min_rating filter should include OR imdb_rating IS NULL so Russian movies (no IMDB rating) are not hidden'
    );
  });
});

describe('Russian Sources - English Titles', () => {
  it('db.js has title_en migration', () => {
    const content = readSrc('db.js');
    assert.ok(content.includes('title_en'), 'should add title_en column');
  });

  it('movies route search includes title_en', () => {
    const content = readSrc('routes/movies.js');
    assert.ok(content.includes('title_en LIKE @search'), 'search should match title_en');
  });

  it('MovieCard shows title_en when available', () => {
    const uiDir = join(__dirname, '..', '..', 'ui', 'src');
    const content = readFileSync(join(uiDir, 'components', 'MovieCard.vue'), 'utf-8');
    assert.ok(content.includes('movie.title_en'), 'should display title_en');
  });

  it('Movie detail shows title_en when available', () => {
    const uiDir = join(__dirname, '..', '..', 'ui', 'src');
    const content = readFileSync(join(uiDir, 'views', 'Movie.vue'), 'utf-8');
    assert.ok(content.includes('movie.title_en'), 'should display title_en in hero');
  });

  it('hdrezka scraper fetches detail pages for series episodes', () => {
    const content = readSrc('scrapers/hdrezka.js');
    assert.ok(content.includes('fetchSeriesEpisodes'), 'should fetch episode detail pages');
    assert.ok(content.includes('b-simple_episodes__list'), 'should parse episode selectors');
  });
});

describe('Russian Sources - Playback Integration', () => {
  it('filmix scraper rejects poster/image URLs', () => {
    const content = readSrc('scrapers/filmix.js');
    assert.ok(content.includes('jpg|jpeg|png'), 'should filter out image file extensions');
    assert.ok(content.includes('thumbs'), 'should filter out thumbs URLs');
  });

  it('IframePlayer supports Russian source names', () => {
    const uiDir = join(__dirname, '..', '..', 'ui', 'src');
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(content.includes('hdrezka'), 'should have hdrezka config');
    assert.ok(content.includes('filmix'), 'should have filmix config');
    assert.ok(content.includes('sourceName'), 'should accept sourceName prop');
  });

  it('Movie.vue forces IframePlayer re-render per episode with :key', () => {
    const uiDir = join(__dirname, '..', '..', 'ui', 'src');
    const content = readFileSync(join(uiDir, 'views', 'Movie.vue'), 'utf-8');
    assert.ok(content.includes(':key="activeEpisodeId"'), 'should use activeEpisodeId as key');
  });

  it('hdrezka and filmix domains are in proxy allowed list', () => {
    const content = readSrc('config.js');
    assert.ok(content.includes('hdrezka.ag'), 'hdrezka.ag allowed');
    assert.ok(content.includes('filmix.my'), 'filmix.my allowed');
    assert.ok(content.includes('seasonvar.org'), 'seasonvar.org allowed');
  });

  it('electron strips X-Frame-Options for all subframes', () => {
    const desktopDir = join(__dirname, '..', '..', 'desktop');
    const content = readFileSync(join(desktopDir, 'main.js'), 'utf-8');
    assert.ok(content.includes('x-frame-options'), 'should strip x-frame-options');
    assert.ok(content.includes('subFrame'), 'should only target subFrame resources');
  });
});
