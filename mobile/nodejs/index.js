import { channel } from 'bridge';

process.env.CAPACITOR_NODEJS = '1';
process.env.CAPACITOR_NODEJS_DATA_DIR = channel.getDataPath?.() || process.cwd();

async function startApi() {
  try {
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '5mb' }));

    app.get('/api/health', (_, res) => res.json({ ok: true, mobile: true }));

    const { default: moviesRouter } = await import('./api-bundle/src/routes/movies.js');
    app.use('/api/movies', moviesRouter);

    try {
      const { default: torrentSearchRouter } = await import('./api-bundle/src/routes/torrent-search.js');
      app.use('/api/torrent-search', torrentSearchRouter);
    } catch {}

    const port = 3001;
    app.listen(port, '127.0.0.1', () => {
      console.log(`[mobile-api] Running on http://127.0.0.1:${port}`);
      channel.send('api-ready', JSON.stringify({ port }));
    });
  } catch (err) {
    console.error('[mobile-api] Failed to start:', err.message, err.stack);
    channel.send('api-error', err.message);
  }
}

channel.addListener('start-api', () => startApi());
channel.send('nodejs-ready', '');
