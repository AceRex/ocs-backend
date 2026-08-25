const env = require("../config/env");

/**
 * Universal CORS middleware for OCS Web & Netlify Functions.
 * Allows ocs-web-three.vercel.app, preview deploys, local development, and desktop apps.
 */
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  // Set CORS headers for all incoming origins
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle browser preflight immediately
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
}

module.exports = corsMiddleware;
