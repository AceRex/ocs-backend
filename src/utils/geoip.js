const geoip = require('geoip-lite');

/**
 * Resolve client IP country from request headers (Netlify / Cloudflare / Proxies)
 * or fallback to geoip-lite lookup on remote address.
 */
function resolveCountry(req) {
  // 1. Netlify Geo Header (x-country / x-nf-geo / nf-geo)
  const netlifyCountry =
    req.headers['x-country'] ||
    req.headers['x-nf-country'] ||
    req.headers['cf-ipcountry'];

  if (netlifyCountry && typeof netlifyCountry === 'string' && netlifyCountry.length === 2) {
    return netlifyCountry.toUpperCase();
  }

  // 2. Extract client IP from x-forwarded-for or socket
  const forwarded = req.headers['x-forwarded-for'];
  let ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress;

  if (!ip) return 'UNKNOWN';

  // Handle IPv6 mapped IPv4 (e.g. ::ffff:192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // Check for local loopback / private IPs
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.')
  ) {
    return 'LOCAL';
  }

  try {
    const geo = geoip.lookup(ip);
    if (geo && geo.country) {
      return geo.country;
    }
  } catch (err) {
    // Ignore geo lookup errors
  }

  return 'UNKNOWN';
}

module.exports = {
  resolveCountry,
};
