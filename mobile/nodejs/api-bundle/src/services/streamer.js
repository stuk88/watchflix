import WebTorrent from 'webtorrent';
import fs from 'fs';

const client = new WebTorrent();
const activeStreams = new Map(); // magnetHash -> { torrent, lastAccess, timeout }

const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 min idle → destroy torrent

function getHash(magnet) {
  const match = magnet.match(/btih:([a-fA-F0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Get or start a torrent, return the largest video file.
 * Resolves once metadata is ready.
 */
export function getVideoFile(magnet) {
  const hash = getHash(magnet);

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

      // Sequential download — critical for streaming playback
      file.select();
      // Deselect all other files to avoid wasting bandwidth
      torrent.files.forEach(f => { if (f !== file) f.deselect(); });

      // Collect subtitle files from torrent
      const subExts = ['.srt', '.sub', '.ass', '.ssa', '.vtt'];
      entry.subtitleFiles = torrent.files.filter(f =>
        subExts.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      // Select subtitle files too
      entry.subtitleFiles.forEach(f => f.select());

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
    if (entry.saving) { setTimeout(check, 60000); return; }
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

/**
 * Immediately destroy a torrent and delete its downloaded files.
 * If a save is in progress, defers destruction until save completes.
 */
export function destroyTorrent(magnet) {
  const hash = getHash(magnet);
  if (!hash) return false;

  const entry = activeStreams.get(hash);
  if (!entry) return false;

  if (entry.saving) {
    console.log(`[streamer] Save in progress, deferring destroy for ${hash.substring(0, 8)}...`);
    entry.pendingDestroy = true;
    return false;
  }

  console.log(`[streamer] Destroying torrent on player close: ${hash.substring(0, 8)}...`);
  try { entry.torrent.destroy(); } catch {}
  activeStreams.delete(hash);
  return true;
}

/**
 * Get info about the active torrent's video file.
 */
export function getFileInfo(magnet) {
  const hash = getHash(magnet);
  const entry = hash && activeStreams.get(hash);
  if (!entry?.file) return null;
  return { filename: entry.file.name, size: entry.file.length };
}

/**
 * Save the torrent's video file to a permanent path on disk.
 * Returns a promise that resolves when the copy is complete.
 * The caller should NOT await this — it runs in the background.
 */
export function saveToOffline(magnet, destPath) {
  const hash = getHash(magnet);
  if (!hash) throw new Error('Invalid magnet');
  const entry = activeStreams.get(hash);
  if (!entry?.file) throw new Error('No active torrent stream');
  if (entry.saving) throw new Error('Save already in progress');

  entry.saving = true;
  entry.saveStatus = 'saving';
  entry.saveProgress = { written: 0, total: entry.file.length };
  entry.savePath = destPath;

  const readStream = entry.file.createReadStream();
  const writeStream = fs.createWriteStream(destPath);
  entry.saveWriteStream = writeStream;

  readStream.on('data', (chunk) => {
    if (entry.saveProgress) entry.saveProgress.written += chunk.length;
  });

  return new Promise((resolve, reject) => {
    readStream.pipe(writeStream);

    writeStream.on('finish', () => {
      entry.saving = false;
      entry.saveStatus = 'done';
      entry.saveWriteStream = null;
      entry.saveProgress = null;
      if (entry.pendingDestroy) {
        destroyTorrent(magnet);
      }
      resolve({ size: entry.file.length, filename: entry.file.name });
    });

    writeStream.on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      entry.saving = false;
      entry.saveStatus = 'error';
      entry.saveWriteStream = null;
      entry.saveProgress = null;
      entry.savePath = null;
      if (entry.pendingDestroy) {
        destroyTorrent(magnet);
      }
      reject(err);
    });
  });
}

/**
 * Cancel an in-progress save and delete the partial file.
 */
export function cancelSave(magnet) {
  const hash = getHash(magnet);
  if (!hash) return false;
  const entry = activeStreams.get(hash);
  if (!entry?.saving) return false;

  if (entry.saveWriteStream) {
    entry.saveWriteStream.destroy();
  }
  try { fs.unlinkSync(entry.savePath); } catch {}
  entry.saving = false;
  entry.saveStatus = null;
  entry.saveWriteStream = null;
  entry.saveProgress = null;
  entry.savePath = null;
  return true;
}

export function getStats(magnet) {
  const hash = getHash(magnet);
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
    saveStatus: entry.saveStatus || null,
    saveProgress: entry.saveProgress ? {
      written: entry.saveProgress.written,
      total: entry.saveProgress.total,
    } : null,
  };
}
