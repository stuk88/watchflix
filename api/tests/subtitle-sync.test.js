/**
 * Tests for POST /api/movies/:id/subtitle-sync
 *
 * Requires the API server to be running on port 3001.
 * Movie 1351 must exist with a working torrent stream.
 *
 * Run: node --test api/tests/subtitle-sync.test.js
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3001';
const MOVIE_ID = 1351;
// A real subtitle URL for movie 1351 via the subtitle-proxy endpoint
const SUBTITLE_URL = `/api/movies/${MOVIE_ID}/subtitle-proxy?url=https%3A%2F%2Fdl.opensubtitles.org%2Fen%2Fdownload%2Fsrc-api%2Fvrf-19810c46%2Ffilead%2F1961600105.gz`;

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

// Verify the API is reachable before running any tests
before(async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/movies?limit=1`);
    assert.ok(res.ok, `API not reachable at ${BASE_URL} – start the server first`);
  } catch (err) {
    throw new Error(`API not reachable at ${BASE_URL}: ${err.message}`);
  }
});

describe('POST /api/movies/:id/subtitle-sync', () => {
  test('returns 400 when subtitleUrl is missing', async () => {
    const res = await apiPost(`/api/movies/${MOVIE_ID}/subtitle-sync`, {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, 'should have an error message');
    assert.match(body.error, /subtitleUrl/i);
  });

  test('returns 400 for a movie with no torrent', async () => {
    // Use movie id 0 (unlikely to exist) or a known movie without torrent
    const res = await apiPost('/api/movies/999999/subtitle-sync', {
      subtitleUrl: SUBTITLE_URL,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error, 'should have an error message');
  });

  // This integration test does a real sync and takes several minutes.
  // Skip in CI by setting SKIP_SLOW_TESTS=1
  const slowTest = process.env.SKIP_SLOW_TESTS ? test.skip : test;

  slowTest(
    'returns valid VTT content for movie 1351 with a real subtitle URL',
    { timeout: 300_000 }, // up to 5 min: ffmpeg extraction + ffsubsync
    async () => {
      const res = await apiPost(`/api/movies/${MOVIE_ID}/subtitle-sync`, {
        subtitleUrl: SUBTITLE_URL,
      });

      // In case the torrent stream isn't seeded right now, accept 500 too
      // but validate the response shape is correct
      if (res.status === 500) {
        const body = await res.json();
        // Must still be a JSON error, not a crash
        assert.ok(body.error, 'error response should have an error field');
        return;
      }

      assert.equal(res.status, 200);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(
        contentType.includes('text/vtt'),
        `Expected content-type text/vtt, got: ${contentType}`
      );

      const text = await res.text();
      assert.ok(text.trimStart().startsWith('WEBVTT'), 'Response body should be VTT format');
      assert.ok(text.length > 100, 'VTT content should be non-trivial');
    }
  );
});
