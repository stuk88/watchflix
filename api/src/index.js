import express from 'express';
import cors from 'cors';
import config from './config.js';
import moviesRouter from './routes/movies.js';
import sourcesRouter from './routes/sources.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.use(cors());
// Subtitle cues for whisper-sync can be large (1000+ cues × ~100 bytes each)
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use('/api/movies', moviesRouter);
app.use('/api/scrape', sourcesRouter);

app.listen(config.port, () => {
  console.log(`[watchflix-api] Running on http://localhost:${config.port}`);
  startScheduler();
});
