const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

/**
 * Generate a signed JWT token with a unique jti (JWT ID).
 * Payload matches AUTH_CONTRACT.md expectations:
 * - userId: User ID
 * - email: User email
 * - role: 'user' | 'admin'
 * - org: Church / Org name
 * - tier: 'standard' | 'pro' | 'enterprise'
 * - jti: Unique token ID for revocation tracking
 */
function signToken(user, options = {}) {
  const jti = uuidv4();
  const payload = {
    userId: user.id || user._id,
    email: user.email,
    role: user.role || 'user',
    org: user.churchName,
    tier: 'standard',
    jti,
  };

  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  const token = jwt.sign(payload, secret, {
    expiresIn: env.JWT_EXPIRY,
    ...options,
  });

  return { token, jti, payload };
}

/**
 * Verify a JWT token signature and expiration.
 */
function verifyToken(token) {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.verify(token, secret);
}

/**
 * Decode a token without verification (for inspection).
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  signToken,
  verifyToken,
  decodeToken,
};
