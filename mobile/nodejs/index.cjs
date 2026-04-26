const { channel } = require('bridge');

process.env.CAPACITOR_NODEJS = '1';

const DB_URL = 'https://github.com/stuk88/watchflix/releases/download/v1.0.0/watchflix-prepopulated.db.gz';

async function ensureDb(dbPath) {
  const fs = require('fs');
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 100000) {
    console.log('[mobile-api] DB exists (' + (fs.statSync(dbPath).size / 1024 / 1024).toFixed(1) + 'MB)');
    return;
  }

  console.log('[mobile-api] Downloading pre-populated database...');
  const https = require('https');
  const http = require('http');
  const zlib = require('zlib');
  const { pipeline } = require('stream');
  const { promisify } = require('util');
  const pipe = promisify(pipeline);

  const tmpPath = dbPath + '.tmp';

  function download(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, { headers: { 'User-Agent': 'Watchflix/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return download(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        resolve(res);
      }).on('error', reject);
    });
  }

  try {
    const stream = await download(DB_URL);
    await pipe(stream, zlib.createGunzip(), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, dbPath);
    console.log('[mobile-api] DB downloaded (' + (fs.statSync(dbPath).size / 1024 / 1024).toFixed(1) + 'MB)');
  } catch (err) {
    console.error('[mobile-api] DB download failed:', err.message);
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function startApi() {
  try {
    const path = require('path');
    const fs = require('fs');

    // Determine DB path and ensure it exists before importing db.js
    const dataDir = process.env.CAPACITOR_NODEJS_DATA_DIR || path.dirname(require.resolve('./api-bundle/src/db.js'));
    const dbDir = path.join(dataDir, '..', 'data');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'watchflix.db');

    // Set env so db.js uses this path
    process.env.CAPACITOR_NODEJS_DATA_DIR = dbDir;

    await ensureDb(dbPath);

    // Now import the API modules (db.js will load the downloaded DB)
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    const { default: db } = await import('./api-bundle/src/db.js');

    const count = db.prepare('SELECT COUNT(*) as c FROM movies').get();
    console.log('[mobile-api] Movies in DB:', count.c);

    const { default: moviesRouter } = await import('./api-bundle/src/routes/movies.js');

    let torrentSearchRouter;
    try {
      ({ default: torrentSearchRouter } = await import('./api-bundle/src/routes/torrent-search.js'));
    } catch (e) {
      console.log('[mobile-api] torrent-search not available:', e.message);
    }

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '5mb' }));

    app.get('/api/health', (_, res) => res.json({ ok: true, mobile: true, movies: count.c, torrentStream: false }));
    app.use('/api/movies', moviesRouter);
    if (torrentSearchRouter) app.use('/api/torrent-search', torrentSearchRouter);

    const port = 3001;
    app.listen(port, '127.0.0.1', () => {
      console.log('[mobile-api] Running on http://127.0.0.1:' + port);
      channel.send('api-ready', JSON.stringify({ port }));
    });
  } catch (err) {
    console.error('[mobile-api] Failed:', err.message, err.stack);
    channel.send('api-error', err.message);
  }
}

channel.addListener('start-api', () => startApi());
channel.send('nodejs-ready', '');
