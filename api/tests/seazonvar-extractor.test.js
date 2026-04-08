import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');
const uiDir = join(__dirname, '..', '..', 'ui', 'src');

function readSrc(relativePath) {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

// ============================================================
// Seazonvar Extractor - File & Structure Tests
// ============================================================

describe('Seazonvar Extractor - File exists with correct exports', () => {
  it('seazonvar-extractor.js exists in services/', () => {
    const path = join(srcDir, 'services', 'seazonvar-extractor.js');
    assert.ok(existsSync(path), 'seazonvar-extractor.js should exist');
  });

  it('exports extractSeazonvarStream function', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(
      content.includes('export async function extractSeazonvarStream'),
      'should export extractSeazonvarStream'
    );
  });

  it('uses Playwright chromium for browser automation', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes("import { chromium } from 'playwright-core'"), 'should import chromium');
    assert.ok(content.includes('chromium.launch'), 'should launch chromium');
  });

  it('uses headless Chrome at the standard macOS path', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(
      content.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      'should use Chrome executable path'
    );
    assert.ok(content.includes('headless: true'), 'should run headless');
  });

  it('imports db for movie lookups', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes("import db from '../db.js'"), 'should import db');
  });

  it('implements caching with TTL', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes('const cache = new Map()'), 'should have cache Map');
    assert.ok(content.includes('CACHE_TTL'), 'should define cache TTL');
    assert.ok(content.includes('cache.get(movieId)'), 'should check cache');
    assert.ok(content.includes('cache.set(movieId'), 'should populate cache');
  });
});

describe('Seazonvar Extractor - Availability check', () => {
  it('checks site availability before extraction', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes('isSeazonvarOnline'), 'should have availability check function');
    assert.ok(content.includes('seasonvar.org'), 'should check seasonvar.org');
  });

  it('detects the "temporarily disabled" offline page', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes('временно отключен'), 'should detect Russian offline message');
  });

  it('throws informative error when site is unavailable', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(
      content.includes('Seazonvar is currently unavailable'),
      'should throw clear unavailable error'
    );
  });
});

describe('Seazonvar Extractor - Stream extraction logic', () => {
  it('looks up movie from database by ID', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(
      content.includes('SELECT source_url, title, type, season, episode FROM movies WHERE id = ?'),
      'should query movie by ID'
    );
  });

  it('supports series episode selection (season/episode)', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes('movie.season'), 'should handle season');
    assert.ok(content.includes('movie.episode'), 'should handle episode');
    assert.ok(content.includes("movie.type === 'series'"), 'should check series type');
  });

  it('searches for HLS .m3u8 URLs', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(content.includes('.m3u8'), 'should look for m3u8 streams');
  });

  it('checks both DOM elements and network responses for stream URL', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    // DOM: video element, iframe, source element
    assert.ok(content.includes("document.querySelector('video')"), 'should check video element');
    assert.ok(content.includes('iframe'), 'should check iframe elements');
    // Network: waitForResponse
    assert.ok(content.includes('waitForResponse'), 'should listen for network m3u8 response');
  });

  it('always closes browser even on error', () => {
    const content = readSrc('services/seazonvar-extractor.js');
    assert.ok(
      content.includes("browser.close().catch(() => {})"),
      'should close browser in catch block'
    );
  });
});

describe('Seazonvar Extractor - API Route', () => {
  it('movies.js has seazonvar-stream endpoint', () => {
    const content = readSrc('routes/movies.js');
    assert.ok(
      content.includes("'/:id/seazonvar-stream'"),
      'should have /:id/seazonvar-stream route'
    );
  });

  it('endpoint imports extractSeazonvarStream dynamically', () => {
    const content = readSrc('routes/movies.js');
    assert.ok(
      content.includes("import('../services/seazonvar-extractor.js')"),
      'should dynamically import seazonvar extractor'
    );
  });

  it('endpoint returns streamUrl and title on success', () => {
    const content = readSrc('routes/movies.js');
    // Find the seazonvar-stream block
    const seazonvarBlock = content.substring(
      content.indexOf('seazonvar-stream'),
      content.indexOf('seazonvar-stream') + 500
    );
    assert.ok(seazonvarBlock.includes('result.streamUrl'), 'should return streamUrl');
    assert.ok(seazonvarBlock.includes('result.title'), 'should return title');
  });

  it('endpoint returns 500 with error message on failure', () => {
    const content = readSrc('routes/movies.js');
    const seazonvarBlock = content.substring(
      content.indexOf('seazonvar-stream'),
      content.indexOf('seazonvar-stream') + 500
    );
    assert.ok(seazonvarBlock.includes('res.status(500)'), 'should return 500 on error');
    assert.ok(seazonvarBlock.includes('err.message'), 'should include error message');
  });
});

describe('Seazonvar Extractor - UI Integration', () => {
  it('IframePlayer hlsSources includes seazonvar', () => {
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(
      content.includes("'seazonvar'"),
      'hlsSources should include seazonvar'
    );
    // Verify it's actually in the hlsSources array
    const hlsLine = content.split('\n').find(l => l.includes('hlsSources'));
    assert.ok(hlsLine.includes('seazonvar'), 'seazonvar should be in hlsSources array');
    assert.ok(hlsLine.includes('hdrezka'), 'hdrezka should still be in hlsSources array');
  });

  it('startPlayer routes seazonvar to seazonvar-stream endpoint', () => {
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(
      content.includes("seazonvar: 'seazonvar-stream'"),
      'endpointMap should map seazonvar to seazonvar-stream'
    );
  });

  it('startPlayer routes hdrezka to hdrezka-stream endpoint', () => {
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(
      content.includes("hdrezka: 'hdrezka-stream'"),
      'endpointMap should map hdrezka to hdrezka-stream'
    );
  });

  it('IframePlayer still has seazonvar in sourceLabels', () => {
    const content = readFileSync(join(uiDir, 'components', 'IframePlayer.vue'), 'utf-8');
    assert.ok(content.includes('seazonvar:'), 'should have seazonvar label entry');
    assert.ok(content.includes("label: 'Seazonvar'"), 'should have Seazonvar label text');
  });
});

describe('Seazonvar Extractor - Follows hdrezka-extractor pattern', () => {
  it('matches hdrezka-extractor structure: imports, cache, export', () => {
    const hdrezka = readSrc('services/hdrezka-extractor.js');
    const seazonvar = readSrc('services/seazonvar-extractor.js');

    // Both should have the same structural elements
    assert.ok(hdrezka.includes("import { chromium }"), 'hdrezka imports chromium');
    assert.ok(seazonvar.includes("import { chromium }"), 'seazonvar imports chromium');

    assert.ok(hdrezka.includes('const cache = new Map()'), 'hdrezka has cache');
    assert.ok(seazonvar.includes('const cache = new Map()'), 'seazonvar has cache');

    assert.ok(hdrezka.includes('CACHE_TTL'), 'hdrezka has CACHE_TTL');
    assert.ok(seazonvar.includes('CACHE_TTL'), 'seazonvar has CACHE_TTL');

    assert.ok(hdrezka.includes('BROWSER_PATH'), 'hdrezka has BROWSER_PATH');
    assert.ok(seazonvar.includes('BROWSER_PATH'), 'seazonvar has BROWSER_PATH');
  });

  it('API route follows same pattern as hdrezka-stream route', () => {
    const content = readSrc('routes/movies.js');

    // Both routes should follow the same structure
    const hdrezkaRoute = content.includes("router.get('/:id/hdrezka-stream'");
    const seazonvarRoute = content.includes("router.get('/:id/seazonvar-stream'");
    assert.ok(hdrezkaRoute, 'hdrezka route exists');
    assert.ok(seazonvarRoute, 'seazonvar route exists');
  });
});
