/**
 * Search for torrents for high-rated movies (IMDb >= 7.5) that don't have torrent sources.
 * Searches YTS, TPB, and TorrentCSV. Only adds healthy torrents (seeds > 3).
 */
import axios from 'axios';
import db from './src/db.js';

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337',
  'udp://tracker.openbittorrent.com:80',
  'udp://open.stealth.si:80',
  'udp://tracker.torrent.eu.org:451',
].map(t => `&tr=${encodeURIComponent(t)}`).join('');

function makeMagnet(hash, name) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${TRACKERS}`;
}

function detectQuality(name) {
  if (/2160p|4k/i.test(name)) return '4K';
  if (/1080p/i.test(name)) return '1080p';
  if (/720p/i.test(name)) return '720p';
  return 'unknown';
}

async function searchYTS(imdbId) {
  try {
    const { data } = await axios.get('https://yts.torrentbay.st/api/v2/list_movies.json', {
      params: { query_term: imdbId, limit: 5 }, timeout: 10000,
    });
    const movies = data?.data?.movies || [];
    const results = [];
    for (const m of movies) {
      for (const t of (m.torrents || [])) {
        if (t.seeds > 3) {
          results.push({ source: 'yts', hash: t.hash, name: m.title, quality: t.quality, seeds: t.seeds, size: t.size });
        }
      }
    }
    return results;
  } catch { return []; }
}

async function searchTPB(title, year) {
  try {
    const query = [title, year].filter(Boolean).join(' ');
    const { data } = await axios.get('https://apibay.org/q.php', {
      params: { q: query, cat: '207' }, timeout: 10000,
    });
    if (!Array.isArray(data) || (data.length === 1 && data[0].name === 'No results returned')) return [];
    return data
      .filter(t => parseInt(t.seeders) > 3 && t.info_hash && t.info_hash !== '0000000000000000000000000000000000000000')
      .slice(0, 3)
      .map(t => ({
        source: 'tpb', hash: t.info_hash, name: t.name,
        quality: detectQuality(t.name), seeds: parseInt(t.seeders),
        size: parseInt(t.size) > 1e9 ? `${(parseInt(t.size)/1e9).toFixed(1)} GB` : `${(parseInt(t.size)/1e6).toFixed(0)} MB`,
      }));
  } catch { return []; }
}

async function searchCSV(title, year) {
  try {
    const query = [title, year].filter(Boolean).join(' ');
    const { data } = await axios.get('https://torrents-csv.com/service/search', {
      params: { q: query, size: 10 }, timeout: 10000,
    });
    return (data?.torrents || [])
      .filter(t => t.seeders > 3 && t.size_bytes > 300_000_000)
      .slice(0, 3)
      .map(t => ({
        source: 'csv', hash: t.infohash, name: t.name,
        quality: detectQuality(t.name), seeds: t.seeders,
        size: t.size_bytes > 1e9 ? `${(t.size_bytes/1e9).toFixed(1)} GB` : `${(t.size_bytes/1e6).toFixed(0)} MB`,
      }));
  } catch { return []; }
}

const updateStmt = db.prepare(`
  UPDATE movies SET source = 'both', torrent_magnet = @magnet, torrent_quality = @quality
  WHERE id = @id
`);

async function run() {
  const movies = db.prepare(`
    SELECT id, title, year, imdb_id, imdb_rating
    FROM movies
    WHERE imdb_rating >= 7.5
    AND source NOT IN ('torrent', 'both')
    AND torrent_magnet IS NULL
    AND imdb_id IS NOT NULL
    ORDER BY imdb_rating DESC
  `).all();

  console.log(`Searching torrents for ${movies.length} movies (IMDb >= 7.5)\n`);

  let found = 0, notFound = 0;

  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];

    // Search all sources in parallel
    const [yts, tpb, csv] = await Promise.allSettled([
      searchYTS(m.imdb_id),
      searchTPB(m.title, m.year),
      searchCSV(m.title, m.year),
    ]);

    const all = [
      ...(yts.status === 'fulfilled' ? yts.value : []),
      ...(tpb.status === 'fulfilled' ? tpb.value : []),
      ...(csv.status === 'fulfilled' ? csv.value : []),
    ];

    // Pick best: prefer 1080p, then highest seeds
    const sorted = all.sort((a, b) => {
      const qOrder = { '1080p': 3, '4K': 2, '720p': 1, 'unknown': 0 };
      const qDiff = (qOrder[b.quality] || 0) - (qOrder[a.quality] || 0);
      return qDiff !== 0 ? qDiff : b.seeds - a.seeds;
    });

    const best = sorted[0];

    if (best) {
      const magnet = makeMagnet(best.hash, best.name);
      updateStmt.run({ id: m.id, magnet, quality: best.quality });
      found++;
    } else {
      notFound++;
    }

    if ((i + 1) % 50 === 0 || i + 1 === movies.length) {
      console.log(`${i + 1}/${movies.length} | found: ${found} | not found: ${notFound}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone. Added torrents to ${found} movies. ${notFound} had no healthy sources.`);

  const bothCount = db.prepare("SELECT COUNT(*) as c FROM movies WHERE source = 'both'").get().c;
  console.log(`Movies with both sources: ${bothCount}`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
