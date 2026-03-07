import axios from 'axios';
import zlib from 'zlib';
import { promisify } from 'util';
import db from '../db.js';

// OpenSubtitles REST API v1 (free, no API key required)
const OPENSUBTITLES_V1 = 'https://rest.opensubtitles.org/search';
const USER_AGENT = 'TemporaryUserAgent';

// Cache: imdbId -> { tracks, expiry }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const gunzip = promisify(zlib.gunzip);

/**
 * Fetch subtitle tracks for a movie from OpenSubtitles API v1 (free, no key needed).
 * Returns array of { language, label, url } objects.
 */
export async function fetchSubtitles(movieId) {
  const movie = db.prepare('SELECT imdb_id FROM movies WHERE id = ?').get(movieId);
  if (!movie?.imdb_id) return [];

  const imdbId = movie.imdb_id; // e.g. "tt1234567"
  const cached = cache.get(imdbId);
  if (cached && cached.expiry > Date.now()) return cached.tracks;

  // Strip "tt" prefix to get numeric ID
  const numericId = imdbId.replace(/^tt/, '');

  try {
    const { data } = await axios.get(`${OPENSUBTITLES_V1}/imdbid-${numericId}`, {
      headers: { 'X-User-Agent': USER_AGENT },
      timeout: 15000,
    });

    if (!Array.isArray(data) || data.length === 0) {
      cache.set(imdbId, { tracks: [], expiry: Date.now() + CACHE_TTL });
      return [];
    }

    // Deduplicate by language, keep highest Score
    const byLang = new Map();
    for (const item of data) {
      const lang = item.ISO639 || 'unknown';
      const score = parseFloat(item.Score) || 0;
      const url = item.SubDownloadLink;
      if (!url) continue;

      if (!byLang.has(lang) || score > byLang.get(lang).score) {
        byLang.set(lang, {
          language: lang,
          label: item.LanguageName || lang.toUpperCase(),
          url,
          score,
        });
      }
    }

    const tracks = [...byLang.values()].map(({ score, ...t }) => t);
    cache.set(imdbId, { tracks, expiry: Date.now() + CACHE_TTL });
    console.log(`[subtitles] Found ${tracks.length} tracks for IMDB ${imdbId}`);
    return tracks;
  } catch (err) {
    console.error('[subtitles] OpenSubtitles v1 fetch error:', err.message);
    cache.set(imdbId, { tracks: [], expiry: Date.now() + CACHE_TTL });
    return [];
  }
}

/**
 * Fetch a subtitle file from its download URL, decompress if gzipped,
 * and return the content as WebVTT text.
 */
export async function fetchAndConvertSubtitle(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });

  let buffer = Buffer.from(response.data);

  // Decompress gzip if needed – v1 SubDownloadLinks are typically .srt.gz
  const contentType = response.headers['content-type'] || '';
  const isGzip = url.endsWith('.gz') || contentType.includes('gzip')
    || (buffer[0] === 0x1f && buffer[1] === 0x8b);
  if (isGzip) {
    buffer = await gunzip(buffer);
  }

  const text = buffer.toString('utf-8');
  const isVtt = text.trimStart().startsWith('WEBVTT');
  return isVtt ? text : srtToVtt(text);
}

/**
 * Convert SRT subtitle text to WebVTT format.
 */
export function srtToVtt(srt) {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  const noSeq = converted.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3})/gm, '');
  return 'WEBVTT\n\n' + noSeq.trim() + '\n';
}

