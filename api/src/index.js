import express from 'express';
import cors from 'cors';
import config from './config.js';
import moviesRouter from './routes/movies.js';
import sourcesRouter from './routes/sources.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use('/api/movies', moviesRouter);
app.use('/api/scrape', sourcesRouter);

app.listen(config.port, () => {
  console.log(`[watchflix-api] Running on http://localhost:${config.port}`);
  startScheduler();
});
