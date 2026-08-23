/**
 * Rate Limiter Module.
 * Provides sliding-window IP rate limiting and failed attempt lockout tracking.
 */

// Global registry of all active rate limiter stores for clean test teardowns
const allRateLimitStores = new Set();
const failedAttempts = new Map();

// Periodic cleanup of stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const store of allRateLimitStores) {
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }
  for (const [key, record] of failedAttempts.entries()) {
    if (now > record.lockoutUntil && now > record.firstAttempt + 3600000) {
      failedAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // unref so timer doesn't hold open Node process in test/serverless

/**
 * Standard request rate limiter middleware.
 * Isolated per-route store ensures different endpoints do not cross-pollute quota.
 * 
 * @param {Object} options
 * @param {number} options.windowMs Window duration in ms (default 15 mins)
 * @param {number} options.max Max allowed requests per window
 * @param {string} options.message Custom error message
 */
function rateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = 'Too many requests. Please try again later.',
} = {}) {
  const store = new Map();
  allRateLimitStores.add(store);

  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-ip';
    const now = Date.now();

    let record = store.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(ip, record);
      return next();
    }

    record.count += 1;
    if (record.count > max) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'rate_limited',
        message,
        retryAfterSeconds: retryAfter,
      });
    }

    next();
  };
}

/**
 * Failed attempt tracker for sensitive endpoints like POST /auth/login.
 * Locks out an IP after consecutive failed attempts for a specified lockout duration.
 */
const loginAttemptTracker = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes window
  lockoutMs: 15 * 60 * 1000, // 15 minutes lockout

  getKey(req) {
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-ip';
  },

  isLocked(req) {
    const key = this.getKey(req);
    const record = failedAttempts.get(key);
    if (!record) return { locked: false };

    const now = Date.now();
    if (record.lockoutUntil && now < record.lockoutUntil) {
      const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
      return { locked: true, remainingSeconds };
    }

    if (now > record.firstAttempt + this.windowMs) {
      failedAttempts.delete(key);
      return { locked: false };
    }

    return { locked: false };
  },

  recordFailure(req) {
    const key = this.getKey(req);
    const now = Date.now();
    let record = failedAttempts.get(key);

    if (!record || now > record.firstAttempt + this.windowMs) {
      record = { count: 1, firstAttempt: now, lockoutUntil: null };
    } else {
      record.count += 1;
    }

    if (record.count >= this.maxAttempts) {
      record.lockoutUntil = now + this.lockoutMs;
    }

    failedAttempts.set(key, record);
    return record;
  },

  reset(req) {
    const key = this.getKey(req);
    failedAttempts.delete(key);
  },

  clearAll() {
    failedAttempts.clear();
    for (const store of allRateLimitStores) {
      store.clear();
    }
  },
};

function clearRateLimits() {
  failedAttempts.clear();
  for (const store of allRateLimitStores) {
    store.clear();
  }
}

module.exports = {
  rateLimiter,
  loginAttemptTracker,
  clearRateLimits,
};
