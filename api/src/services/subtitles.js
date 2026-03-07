import axios from 'axios';
import zlib from 'zlib';
import { promisify } from 'util';
import db from '../db.js';

const gunzip = promisify(zlib.gunzip);

// OpenSubtitles REST API v1 (no auth required)
const OPENSUBTITLES_API = 'https://rest.opensubtitles.org/search';
const USER_AGENT = 'TemporaryUserAgent';

// Cache: imdbNum -> { tracks, expiry }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch subtitle tracks for a movie from OpenSubtitles REST API v1.
 * Returns array of { language, label, url, format } objects.
 */
export async function fetchSubtitles(movieId) {
  const movie = db.prepare('SELECT imdb_id FROM movies WHERE id = ?').get(movieId);
  if (!movie?.imdb_id) return [];

  // OpenSubtitles uses numeric IMDB ID (without 'tt' prefix)
  const imdbNum = movie.imdb_id.replace(/^tt/, '');
  const cached = cache.get(imdbNum);
  if (cached && cached.expiry > Date.now()) return cached.tracks;

  try {
    const { data } = await axios.get(`${OPENSUBTITLES_API}/imdbid-${imdbNum}`, {
      headers: { 'X-User-Agent': USER_AGENT },
      timeout: 15000,
    });

    if (!Array.isArray(data) || data.length === 0) {
      cache.set(imdbNum, { tracks: [], expiry: Date.now() + CACHE_TTL });
      return [];
    }

    // Deduplicate by language, keep highest-scored subtitle
    const byLang = new Map();
    for (const sub of data) {
      if (!sub.SubDownloadLink) continue;
      const lang = sub.ISO639 || 'unknown';
      const score = parseFloat(sub.Score || 0);
      if (!byLang.has(lang) || score > byLang.get(lang).score) {
        byLang.set(lang, {
          language: lang,
          label: sub.LanguageName || lang,
          url: sub.SubDownloadLink,
          format: (sub.SubFormat || 'srt').toLowerCase(),
          score,
        });
      }
    }

    // Remove score from final output
    const tracks = [...byLang.values()].map(({ score, ...t }) => t);
    cache.set(imdbNum, { tracks, expiry: Date.now() + CACHE_TTL });
    console.log(`[subtitles] Found ${tracks.length} tracks for IMDB ${movie.imdb_id}`);
    return tracks;
  } catch (err) {
    console.error('[subtitles] OpenSubtitles fetch error:', err.message);
    cache.set(imdbNum, { tracks: [], expiry: Date.now() + CACHE_TTL });
    return [];
  }
}

/**
 * Convert SRT subtitle text to WebVTT format.
 * Handles CRLF/LF line endings and removes sequence numbers.
 */
export function srtToVtt(srt) {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Replace SRT comma-based timestamps with VTT dot-based timestamps
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  // Remove standalone sequence number lines (digit-only lines before a timestamp line)
  const noSeq = converted.replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3})/gm, '');
  return 'WEBVTT\n\n' + noSeq.trim() + '\n';
}

/**
 * Fetch an external subtitle file and return it as VTT text.
 * Handles .vtt (passthrough), .srt (convert), .srt.gz (decompress + convert).
 */
export async function fetchAndConvertSubtitle(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });

  let buffer = Buffer.from(response.data);

  // Decompress gzip if needed (OpenSubtitles serves .srt.gz)
  const isGzip =
    url.toLowerCase().includes('.gz') ||
    response.headers['content-encoding'] === 'gzip' ||
    (buffer[0] === 0x1f && buffer[1] === 0x8b); // gzip magic bytes

  if (isGzip) {
    buffer = await gunzip(buffer);
  }

  const text = buffer.toString('utf8');

  // Detect format by URL or content
  const lowerUrl = url.toLowerCase().replace(/\?.*$/, '');
  const isVtt = lowerUrl.endsWith('.vtt') || text.trimStart().startsWith('WEBVTT');

  return isVtt ? text : srtToVtt(text);
}
