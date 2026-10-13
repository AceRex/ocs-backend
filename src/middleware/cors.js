function isOriginAllowed(origin) {
  if (!origin) return false;
  const configured = [process.env.FRONTEND_URL, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')]
    .filter(Boolean).map((value) => value.trim().replace(/\/$/, ''));
  if (configured.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  res.vary('Origin');
  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: 'cors_rejected', message: 'Origin not allowed by CORS' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  if (origin) res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, x-ocs-platform, x-ocs-device-id, x-ocs-device-name, x-ocs-client-version');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
module.exports = corsMiddleware;
module.exports.isOriginAllowed = isOriginAllowed;
