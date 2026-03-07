import WebTorrent from 'webtorrent';

const client = new WebTorrent();
const activeStreams = new Map(); // magnetHash -> { torrent, lastAccess, timeout }

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 min idle → destroy torrent

/**
 * Get or start a torrent, return the largest video file.
 * Resolves once metadata is ready.
 */
export function getVideoFile(magnet) {
  const hashMatch = magnet.match(/btih:([a-fA-F0-9]+)/);
  const hash = hashMatch ? hashMatch[1].toUpperCase() : magnet;

  if (activeStreams.has(hash)) {
    const entry = activeStreams.get(hash);
    entry.lastAccess = Date.now();
    // Already have metadata
    if (entry.file) return Promise.resolve(entry);
    // Still loading metadata
    return entry.promise;
  }

  const entry = { torrent: null, file: null, lastAccess: Date.now(), promise: null };

  entry.promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Torrent metadata timeout (60s)'));
      try { torrent.destroy(); } catch {}
      activeStreams.delete(hash);
    }, 60000);

    const torrent = client.add(magnet, { destroyStoreOnDestroy: true });
    entry.torrent = torrent;
    activeStreams.set(hash, entry);

    torrent.on('ready', () => {
      clearTimeout(timeout);
      // Find largest video file
      const videoExts = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v'];
      const videos = torrent.files.filter(f =>
        videoExts.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      const file = videos.length
        ? videos.reduce((a, b) => a.length > b.length ? a : b)
        : torrent.files.reduce((a, b) => a.length > b.length ? a : b);

      entry.file = file;
      // Collect subtitle files from torrent
      const subExts = ['.srt', '.sub', '.ass', '.ssa', '.vtt'];
      entry.subtitleFiles = torrent.files.filter(f =>
        subExts.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      resolve(entry);
      scheduleCleanup(hash);
    });

    torrent.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
      activeStreams.delete(hash);
    });
  });

  return entry.promise;
}

function scheduleCleanup(hash) {
  const check = () => {
    const entry = activeStreams.get(hash);
    if (!entry) return;
    if (Date.now() - entry.lastAccess > IDLE_TIMEOUT) {
      console.log(`[streamer] Destroying idle torrent: ${hash.substring(0, 8)}...`);
      try { entry.torrent.destroy(); } catch {}
      activeStreams.delete(hash);
    } else {
      setTimeout(check, 60000);
    }
  };
  setTimeout(check, 60000);
}

export function getStats(magnet) {
  const hashMatch = magnet.match(/btih:([a-fA-F0-9]+)/);
  const hash = hashMatch ? hashMatch[1].toUpperCase() : null;
  const entry = hash && activeStreams.get(hash);
  if (!entry || !entry.torrent) return null;
  const t = entry.torrent;
  return {
    peers: t.numPeers,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    progress: t.progress,
    downloaded: t.downloaded,
    total: entry.file?.length || 0,
    filename: entry.file?.name || null,
    subtitleFiles: (entry.subtitleFiles || []).map((f, i) => ({ index: i, name: f.name, size: f.length })),
  };
}
