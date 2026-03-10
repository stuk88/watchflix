import config from '../config.js';

/**
 * Bearer token auth middleware. Skipped entirely when authToken is not configured.
 * Apply to all /api routes except /api/health.
 */
export function requireAuth(req, res, next) {
  if (!config.authToken) return next();

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token !== config.authToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
