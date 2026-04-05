import express from 'express';
import cors from 'cors';
import config from './config.js';
import { requireAuth } from './middleware/auth.js';
import moviesRouter from './routes/movies.js';
import sourcesRouter from './routes/sources.js';
import torrentSearchRouter from './routes/torrent-search.js';
import russianSearchRouter from './routes/russian-search.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.use(cors());
// Subtitle cues for whisper-sync can be large (1000+ cues × ~100 bytes each)
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use('/api', requireAuth);
app.use('/api/movies', moviesRouter);
app.use('/api/scrape', sourcesRouter);
app.use('/api/torrent-search', torrentSearchRouter);
app.use('/api/russian-search', russianSearchRouter);

// Serve the built UI when bundled with the desktop app (UI_DIST is set by the Electron main process).
if (process.env.UI_DIST) {
  app.use(express.static(process.env.UI_DIST));
  app.get('*', (_, res) => res.sendFile(`${process.env.UI_DIST}/index.html`));
}

app.listen(config.port, () => {
  console.log(`[watchflix-api] Running on http://localhost:${config.port}`);
  startScheduler();
});
