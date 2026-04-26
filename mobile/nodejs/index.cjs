const { channel } = require('bridge');

process.env.CAPACITOR_NODEJS = '1';

async function startApi() {
  try {
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    const { default: db } = await import('./api-bundle/src/db.js');
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
