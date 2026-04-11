import axios from 'axios';
import zlib from 'zlib';
import { promisify } from 'util';
import jschardet from 'jschardet';
import iconv from 'iconv-lite';
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
 * Fetch Hebrew subtitles from Wizdom.xyz (Israeli subtitle site).
 * Returns files in the same format as OpenSubtitles results.
 */
async function fetchFromWizdom(imdbId) {
  try {
    const { data } = await axios.get('https://wizdom.xyz/api/search', {
      params: { action: 'by_id', imdb: imdbId, version: 'all' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    if (!Array.isArray(data) || data.length === 0) return [];
    return data.map(item => ({
      MatchedBy: 'wizdom',
      SubFileName: item.versioname + '.srt',
      SubDownloadLink: `https://wizdom.xyz/api/files/sub/${item.id}`,
      SubDownloadsCnt: '0',
      SubFormat: 'srt',
      ISO639: 'he',
      LanguageName: 'Hebrew',
      Score: 10,
    }));
  } catch {
    return [];
  }
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
    // Fetch from OpenSubtitles and Wizdom (Hebrew) in parallel
    const [osData, wizdomData] = await Promise.allSettled([
      fetchFromApi(`/imdbid-${numericId}`),
      fetchFromWizdom(imdbId),
    ]);

    const allData = [
      ...(osData.status === 'fulfilled' ? osData.value : []),
      ...(wizdomData.status === 'fulfilled' ? wizdomData.value : []),
    ];

    if (allData.length === 0) {
      cache.set(imdbId, { tracks: [], expiry: Date.now() + CACHE_TTL });
      return [];
    }

    const tracks = groupByLang(allData);
    cache.set(imdbId, { tracks, expiry: Date.now() + CACHE_TTL });
    console.log(`[subtitles] Found ${tracks.length} languages for IMDB ${imdbId}`);
    return tracks;
  } catch (err) {
    console.error('[subtitles] Subtitle fetch error:', err.message);
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

  // Handle ZIP files (Wizdom returns .zip containing .srt)
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    const { default: AdmZip } = await import('adm-zip');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const srtEntry = entries.find(e => e.entryName.endsWith('.srt') || e.entryName.endsWith('.vtt'));
    if (srtEntry) {
      buffer = srtEntry.getData();
    } else if (entries.length > 0) {
      buffer = entries[0].getData();
    }
  }

  const isGzip = url.endsWith('.gz') || contentType.includes('gzip')
    || (buffer[0] === 0x1f && buffer[1] === 0x8b);
  if (isGzip) {
    buffer = await gunzip(buffer);
  }

  // Detect encoding and decode to UTF-8 string
  const detected = jschardet.detect(buffer);
  const encoding = (detected?.encoding && detected.encoding !== 'ascii')
    ? detected.encoding
    : 'utf-8';
  console.log(`[subtitles] Detected encoding: ${encoding} (confidence: ${(detected?.confidence * 100 || 0).toFixed(0)}%)`);
  const text = iconv.decode(buffer, encoding);
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
