/**
 * Universal CORS middleware for OCS Web & Netlify Functions.
 * Enforces explicit origin validation for credentialed requests while
 * allowing authorized frontend domains, local development, and desktop apps.
 */

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(www\.)?churchocs\.com$/,
  /^https:\/\/ocs-web-three\.vercel\.app$/,
  /^https:\/\/ocs-web-three(-[a-z0-9-]+)?\.vercel\.app$/,
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^capacitor:\/\/localhost$/,
  /^ionic:\/\/localhost$/,
  /^electron:\/\//,
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  const requestHeaders = req.headers["access-control-request-headers"];
  const baseAllowedHeaders =
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers, x-ocs-platform, x-ocs-device-id, x-ocs-device-name, x-ocs-client-version";

  const allowed = isOriginAllowed(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else if (!origin) {
    // Non-browser or direct clients (desktop apps, mobile native, server-to-server)
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    // Untrusted cross-origin browser request: do not reflect origin or credentials
    res.setHeader("Access-Control-Allow-Origin", "null");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    requestHeaders ? `${baseAllowedHeaders}, ${requestHeaders}` : baseAllowedHeaders
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle browser preflight immediately
  if (req.method === "OPTIONS") {
    if (origin && !allowed) {
      return res.status(403).json({ error: "cors_rejected", message: "Origin not allowed by CORS" });
    }
    return res.status(204).end();
  }

  next();
}

module.exports = corsMiddleware;

