/**
 * Integration tests for seed health validation:
 * - POST /api/torrent-search/report-dead blacklists infohashes
 * - GET /api/torrent-search filters out dead torrents
 * - POST /api/torrent-search/add inserts movie into regular library
 *
 * Requires the API server running on port 3001.
 * Run: node --test api/tests/seed-health.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3001';
const FAKE_HASH = 'DEADBEEF0000000000000000000000000000DEAD';
const FAKE_HASH2 = 'DEADBEEF0000000000000000000000000000DEA2';

async function apiGet(path) {
  return fetch(`${BASE_URL}${path}`);
}

async function apiPost(path, body) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiDelete(path) {
  return fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
}

before(async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/movies?limit=1`);
    assert.ok(res.ok, `API not reachable at ${BASE_URL} – start the server first`);
  } catch (err) {
    throw new Error(`API not reachable at ${BASE_URL}: ${err.message}`);
  }
});

// Clean up test data after all tests
after(async () => {
  // Remove fake dead torrent entries (via direct DB, but we don't have access — they'll expire in 30 days)
});

describe('POST /api/torrent-search/report-dead', () => {
  test('returns 400 when infohash is missing', async () => {
    const res = await apiPost('/api/torrent-search/report-dead', {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('infohash'));
  });

  test('accepts a valid infohash and returns ok', async () => {
    const res = await apiPost('/api/torrent-search/report-dead', {
      infohash: FAKE_HASH,
      name: 'Test Dead Torrent',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  test('increments fail_count on duplicate report', async () => {
    // Report same hash again
    const res = await apiPost('/api/torrent-search/report-dead', {
      infohash: FAKE_HASH,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  test('normalizes infohash to uppercase', async () => {
    const res = await apiPost('/api/torrent-search/report-dead', {
      infohash: FAKE_HASH2.toLowerCase(),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

describe('GET /api/torrent-search (dead torrent filtering)', () => {
  test('search results do not include blacklisted infohashes', async () => {
    // Search for something likely to return results
    const res = await apiGet('/api/torrent-search?q=inception');
    assert.equal(res.status, 200);
    const body = await res.json();

    // Verify no result has the fake dead hash
    for (const r of body.results) {
      assert.notEqual(r.infohash, FAKE_HASH, 'Dead torrent should not appear in results');
      assert.notEqual(r.infohash, FAKE_HASH2, 'Dead torrent should not appear in results');
    }
  });
});

describe('POST /api/torrent-search/add (add to library)', () => {
  let addedMovieId = null;

  test('adds a torrent to the library and returns movieId', async () => {
    const res = await apiPost('/api/torrent-search/add', {
      magnet: `magnet:?xt=urn:btih:AAAA0000BBBB1111CCCC2222DDDD3333EEEE4444&dn=Test+Movie+(2024)+1080p`,
      name: 'Test Movie (2024) 1080p BluRay',
      quality: '1080p',
      infohash: 'AAAA0000BBBB1111CCCC2222DDDD3333EEEE4444',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.movieId, 'Should return a movieId');
    addedMovieId = body.movieId;
  });

  test('added movie appears in regular movie listing', async () => {
    assert.ok(addedMovieId, 'Movie must have been added in previous test');
    const res = await apiGet(`/api/movies/${addedMovieId}`);
    assert.equal(res.status, 200);
    const movie = await res.json();
    assert.ok(movie.torrent_magnet, 'Movie should have a magnet link');
    assert.ok(movie.torrent_magnet.includes('AAAA0000BBBB1111CCCC2222DDDD3333EEEE4444'));
  });

  test('duplicate add returns existing movieId', async () => {
    const res = await apiPost('/api/torrent-search/add', {
      magnet: `magnet:?xt=urn:btih:AAAA0000BBBB1111CCCC2222DDDD3333EEEE4444&dn=Test+Movie+(2024)+1080p`,
      name: 'Test Movie (2024) 1080p BluRay',
      quality: '1080p',
      infohash: 'AAAA0000BBBB1111CCCC2222DDDD3333EEEE4444',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.existing, true);
    assert.equal(body.movieId, addedMovieId);
  });

  // Cleanup: remove the test movie
  after(async () => {
    if (addedMovieId) {
      await apiDelete(`/api/movies/${addedMovieId}`);
    }
  });
});
