const env = require('../config/env');

/**
 * Custom CORS middleware configured for OCS Web Platform & Electron Desktop App.
 *
 * Rules:
 * 1. Explicitly allows FRONTEND_URL.
 * 2. In non-production environments, permits localhost/127.0.0.1 origins for local dev.
 * 3. CRITICAL: Allows requests without an Origin header (e.g., direct Electron desktop app
 *    native HTTP requests to /auth/validate-token and /auth/revoke, mobile app, curl).
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  // Allowed origins list
  const allowedOrigins = [env.FRONTEND_URL].filter(Boolean);

  if (env.NODE_ENV !== 'production') {
    allowedOrigins.push(
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5000',
      'http://localhost:5001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:5001'
    );
  }

  // If no origin is sent (Electron desktop app, Postman, server-to-server), allow it
  if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Accept'
    );
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }

  // If origin is in allowed origins
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Accept'
    );

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  }

  // If origin is not allowed, reject preflight or return forbidden
  if (req.method === 'OPTIONS') {
    return res.status(403).json({ error: 'cors_not_allowed', message: 'CORS origin not allowed' });
  }

  // For regular requests from unauthorized origins, proceed without CORS headers (browser will block response)
  next();
}

module.exports = corsMiddleware;
