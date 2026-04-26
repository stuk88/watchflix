const { channel } = require('bridge');

process.env.CAPACITOR_NODEJS = '1';

const DB_URL = 'https://github.com/stuk88/watchflix/releases/download/v1.0.0/watchflix-prepopulated.db.gz';

async function seedDbIfEmpty(db, dbPath) {
  const count = db.prepare('SELECT COUNT(*) as c FROM movies').get();
  if (count.c > 0) {
    console.log('[mobile-api] DB has', count.c, 'movies, skipping seed');
    return;
  }

  console.log('[mobile-api] DB empty, downloading pre-populated database...');
  try {
    const https = await import('https');
    const http = await import('http');
    const zlib = await import('zlib');
    const fs = await import('fs');
    const { pipeline } = await import('stream/promises');

    const tmpPath = dbPath + '.download';

    // Follow redirects (GitHub release URLs redirect)
    function download(url) {
      return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return download(res.headers.location).then(resolve, reject);
          }
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          resolve(res);
        }).on('error', reject);
      });
    }

    const stream = await download(DB_URL);
    await pipeline(stream, zlib.createGunzip(), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, dbPath);
    console.log('[mobile-api] Database downloaded, restarting...');
    return true; // signal restart needed
  } catch (err) {
    console.error('[mobile-api] DB download failed:', err.message);
    return false;
  }
}

async function startApi() {
  try {
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');

    // Import DB - creates empty tables if needed
    const dbModule = await import('./api-bundle/src/db.js');
    let db = dbModule.default;

    // Check if we need to seed
    const { dirname, join } = await import('path');
    const dbPath = join(process.env.CAPACITOR_NODEJS_DATA_DIR || '.', 'watchflix.db');
    const needsRestart = await seedDbIfEmpty(db, dbPath);

    if (needsRestart) {
      // Re-import DB with fresh data (dynamic import cache won't help, but sql.js reads from disk)
      const { openDatabase } = await import('./api-bundle/src/db/index.js');
      db = await openDatabase(dbPath);
    }

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

    app.get('/api/health', (_, res) => res.json({ ok: true, mobile: true }));
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
