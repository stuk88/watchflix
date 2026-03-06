/**
 * clean-no-peers.js
 * Cleans up movies that have no active seeders:
 * 1. Torrent movies with no torrent_magnet are deleted.
 * 2. YTS-sourced movies are re-checked via YTS API — deleted if no torrent has seeds > 0.
 *
 * Usage: node api/src/clean-no-peers.js
 */

import axios from 'axios';
import db from './db.js';

const YTS_API = 'https://yts.torrentbay.st/api/v2';
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  let deletedNoMagnet = 0;
  let deletedNoSeeds = 0;
  let checked = 0;
  let skipped = 0;

  // 1. Delete torrent-source movies with no magnet link
  const noMagnet = db.prepare(
    "SELECT id, title FROM movies WHERE source IN ('torrent', 'both') AND (torrent_magnet IS NULL OR torrent_magnet = '')"
  ).all();

  for (const movie of noMagnet) {
    db.prepare('DELETE FROM movies WHERE id = ?').run(movie.id);
    console.log(`[no-magnet] Deleted: "${movie.title}" (id=${movie.id})`);
    deletedNoMagnet++;
  }

  // 2. Re-check YTS movies via YTS API using imdb_id
  const ytsMovies = db.prepare(
    "SELECT id, title, imdb_id FROM movies WHERE source IN ('torrent', 'both') AND imdb_id IS NOT NULL AND imdb_id != ''"
  ).all();

  console.log(`\nChecking ${ytsMovies.length} torrent movies against YTS API...`);

  for (const movie of ytsMovies) {
    try {
      const { data } = await axios.get(`${YTS_API}/movie_details.json`, {
        params: { imdb_id: movie.imdb_id },
        timeout: 10000,
      });

      const ytsMovie = data?.data?.movie;
      if (!ytsMovie) {
        // Not found on YTS — skip (may be TPB-only)
        skipped++;
        checked++;
        await sleep(DELAY_MS);
        continue;
      }

      const torrents = ytsMovie.torrents || [];
      const hasSeeds = torrents.some(t => t.seeds > 0);

      if (!hasSeeds) {
        db.prepare('DELETE FROM movies WHERE id = ?').run(movie.id);
        console.log(`[no-seeds] Deleted: "${movie.title}" (imdb=${movie.imdb_id})`);
        deletedNoSeeds++;
      }

      checked++;
    } catch (err) {
      console.error(`  Error checking "${movie.title}": ${err.message}`);
      skipped++;
      checked++;
    }

    await sleep(DELAY_MS);

    if (checked % 50 === 0) {
      process.stdout.write(`  Progress: ${checked}/${ytsMovies.length}\r`);
    }
  }

  console.log('\n\n========== Clean Stats ==========');
  console.log(`Deleted (no magnet):  ${deletedNoMagnet}`);
  console.log(`Deleted (no seeds):   ${deletedNoSeeds}`);
  console.log(`Skipped (not on YTS): ${skipped}`);
  console.log(`Total checked:        ${checked}`);
  console.log(`Total deleted:        ${deletedNoMagnet + deletedNoSeeds}`);
  console.log('=================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
