import { fileURLToPath } from 'url';
import db from './db.js';
import { extractStreamUrl } from './services/stream-extractor.js';

// ============================================================
// Pre-extract and cache stream URLs for all 123movies entries
// Run: node api/src/extract-streams.js
// ============================================================

export const SERVERS = [1, 2, 5];
export const MAX_CONCURRENT = 2;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Query all movies eligible for stream extraction:
 * source='123movies' or 'both', have tmdb_id, are regular movies (not series episodes).
 */
export function getMoviesToExtract(database = db) {
  return database.prepare(`
    SELECT id, title, tmdb_id
    FROM movies
    WHERE (source = '123movies' OR source = 'both')
      AND tmdb_id IS NOT NULL
      AND (type IS NULL OR type = 'movie')
    ORDER BY id
  `).all();
}

/**
 * Check if a stream_cache entry exists and is still valid (not expired).
 */
export function getCachedStream(movieId, server, database = db) {
  const row = database.prepare(
    'SELECT * FROM stream_cache WHERE movie_id = ? AND server = ?'
  ).get(movieId, server);
  if (!row) return null;
  // Return even if expired — caller decides what to do
  return row;
}

/**
 * Check whether a cache row is still valid (not expired and no error).
 */
export function isCacheValid(row, nowMs = Date.now()) {
  if (!row) return false;
  if (row.error) return false;
  return row.expires_at > nowMs;
}

/**
 * Upsert a successful result into stream_cache.
 */
export function saveCacheHit(movieId, server, result, database = db, nowMs = Date.now()) {
  database.prepare(`
    INSERT OR REPLACE INTO stream_cache
      (movie_id, server, m3u8_url, subtitle_url, tmdb_id, extracted_at, expires_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    movieId,
    server,
    result.m3u8 ?? null,
    result.subtitles ?? null,
    result.tmdbId ?? null,
    nowMs,
    nowMs + CACHE_TTL_MS,
  );
}

/**
 * Upsert an error result into stream_cache so we don't retry failures immediately.
 */
export function saveCacheError(movieId, server, errorMessage, database = db, nowMs = Date.now()) {
  database.prepare(`
    INSERT OR REPLACE INTO stream_cache
      (movie_id, server, m3u8_url, subtitle_url, tmdb_id, extracted_at, expires_at, error)
    VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?)
  `).run(movieId, server, nowMs, nowMs + CACHE_TTL_MS, errorMessage);
}

/**
 * Run extraction for all eligible movies × servers with configurable concurrency.
 * @param {object} opts
 * @param {Function} opts.extractFn - injectable for testing
 * @param {number}   opts.maxConcurrent
 * @param {object}   opts.database - injectable DB
 */
export async function extractAllStreams({
  extractFn = extractStreamUrl,
  maxConcurrent = MAX_CONCURRENT,
  database = db,
} = {}) {
  const movies = getMoviesToExtract(database);

  // Build flat work list: one entry per (movie, server) pair, skipping valid cache hits
  const work = [];
  const nowMs = Date.now();
  for (const movie of movies) {
    for (const server of SERVERS) {
      const cached = getCachedStream(movie.id, server, database);
      // Skip if any cache entry (success or error) is still within TTL
      if (cached && cached.expires_at > nowMs) continue;
      work.push({ movie, server });
    }
  }

  const total = work.length;
  let done = 0;

  console.log(`\n🎬 STREAM PRE-EXTRACTION`);
  console.log(`   Movies: ${movies.length} | Servers: ${SERVERS.join(', ')} | Work items: ${total}`);
  console.log(`   Concurrency: ${maxConcurrent} | TTL: 24h\n`);

  if (total === 0) {
    console.log('   ✅ Nothing to extract — all entries cached.');
    return { total: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // Process in batches of maxConcurrent
  for (let i = 0; i < work.length; i += maxConcurrent) {
    const batch = work.slice(i, i + maxConcurrent);

    await Promise.all(batch.map(async ({ movie, server }) => {
      done++;
      const label = `[${done}/${total}] ${movie.title} (server ${server})`;
      try {
        const result = await extractFn(movie.id, server);
        saveCacheHit(movie.id, server, result, database);
        succeeded++;
        const m3u8Short = result.m3u8 ? result.m3u8.substring(0, 60) + '…' : 'no url';
        console.log(`  ✅ ${label} — ${m3u8Short}`);
      } catch (err) {
        saveCacheError(movie.id, server, err.message, database);
        failed++;
        console.log(`  ❌ ${label} — ${err.message}`);
      }
    }));
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ✅ Extraction complete: ${succeeded} succeeded, ${failed} failed`);
  console.log(`═══════════════════════════════════════════\n`);

  return { total, succeeded, failed };
}

// Only run when invoked directly (not imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  extractAllStreams().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
