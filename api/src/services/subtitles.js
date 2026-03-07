import axios from 'axios';
import zlib from 'zlib';
import { promisify } from 'util';
import db from '../db.js';

// OpenSubtitles REST API v1 (free, no API key required)
const OPENSUBTITLES_V1 = 'https://rest.opensubtitles.org/search';
const USER_AGENT = 'TemporaryUserAgent';

// Cache: key -> { tracks, expiry }
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const gunzip = promisify(zlib.gunzip);

/**
 * Group raw OpenSubtitles results by language.
 * Each language gets all available files sorted by score (best first).
 */
function groupByLang(data) {
  const byLang = new Map();
  for (const item of data) {
    const lang = item.ISO639 || 'unknown';
    const url = item.SubDownloadLink;
    if (!url) continue;
    if (!byLang.has(lang)) {
      byLang.set(lang, { language: lang, label: item.LanguageName || lang.toUpperCase(), files: [] });
    }
    byLang.get(lang).files.push({
      filename: item.SubFileName || 'Unknown',
      url,
      score: parseFloat(item.Score) || 0,
      downloads: parseInt(item.SubDownloadsCnt) || 0,
      format: item.SubFormat || 'srt',
    });
  }
  // Sort files within each language by score desc
  for (const entry of byLang.values()) {
    entry.files.sort((a, b) => b.score - a.score);
  }
  return [...byLang.values()];
}

async function fetchFromApi(searchPath) {
  const { data } = await axios.get(`${OPENSUBTITLES_V1}${searchPath}`, {
    headers: { 'X-User-Agent': USER_AGENT },
    timeout: 15000,
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch subtitle tracks for a movie from OpenSubtitles API v1.
 * Returns array of { language, label, files: [{ filename, url, score, downloads, format }] }.
 */
export async function fetchSubtitles(movieId) {
  const movie = db.prepare('SELECT imdb_id FROM movies WHERE id = ?').get(movieId);
  if (!movie?.imdb_id) return [];

  const imdbId = movie.imdb_id;
  const cached = cache.get(imdbId);
  if (cached && cached.expiry > Date.now()) return cached.tracks;

  const numericId = imdbId.replace(/^tt/, '');

  try {
    const data = await fetchFromApi(`/imdbid-${numericId}`);
    if (data.length === 0) {
      cache.set(imdbId, { tracks: [], expiry: Date.now() + CACHE_TTL });
      return [];
    }

    const tracks = groupByLang(data);
    cache.set(imdbId, { tracks, expiry: Date.now() + CACHE_TTL });
    console.log(`[subtitles] Found ${tracks.length} languages for IMDB ${imdbId}`);
    return tracks;
  } catch (err) {
    console.error('[subtitles] OpenSubtitles v1 fetch error:', err.message);
    cache.set(imdbId, { tracks: [], expiry: Date.now() + CACHE_TTL });
    return [];
  }
}

/**
 * Fetch subtitles by torrent filename (better sync for specific releases).
 * Falls back to IMDB ID search if filename search returns nothing.
 */
export async function fetchSubtitlesByFilename(movieId, filename) {
  if (!filename) return fetchSubtitles(movieId);

  const cacheKey = `file:${filename}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.tracks;

  const movie = db.prepare('SELECT imdb_id FROM movies WHERE id = ?').get(movieId);
  const numericId = movie?.imdb_id?.replace(/^tt/, '');

  try {
    const searchPath = numericId
      ? `/imdbid-${numericId}/tag-${encodeURIComponent(filename)}`
      : `/tag-${encodeURIComponent(filename)}`;

    const data = await fetchFromApi(searchPath);
    if (data.length > 0) {
      const tracks = groupByLang(data);
      cache.set(cacheKey, { tracks, expiry: Date.now() + CACHE_TTL });
      console.log(`[subtitles] Found ${tracks.length} languages by filename: ${filename}`);
      return tracks;
    }
  } catch (err) {
    console.error('[subtitles] Filename search error:', err.message);
  }

  console.log(`[subtitles] No filename match, falling back to IMDB ID`);
  return fetchSubtitles(movieId);
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
