const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { connectToDatabase } = require('../config/db');

/**
 * Authentication middleware.
 * Verifies JWT token signature, checks token revocation, fetches user,
 * and confirms the user's trial grace period has not expired.
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers['x-access-token'];
    if (!authHeader) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication token is required',
      });
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : authHeader.trim();

    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Authentication token is missing',
      });
    }

    // Verify token signature & expiry
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'token_expired',
          message: 'Token has expired',
        });
      }
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid authentication token',
      });
    }

    await connectToDatabase();

    // Check if token was explicitly revoked
    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ tokenId: decoded.jti });
      if (revoked) {
        return res.status(401).json({
          error: 'token_revoked',
          message: 'Token has been revoked',
        });
      }
    }

    // Find active user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        error: 'user_not_found',
        message: 'User account not found',
      });
    }

    // Check if user was globally logged out across all devices (e.g. device limit exceeded)
    if (user.lastLoggedOutAllAt && decoded.iat && (decoded.iat * 1000) < new Date(user.lastLoggedOutAllAt).getTime()) {
      return res.status(401).json({
        error: 'token_revoked',
        message: 'Session has been logged out across all devices. Please log in again.',
      });
    }

    // Re-check grace period on every request (Task 3.3 requirement)
    if (user.graceExpiresAt && new Date() > new Date(user.graceExpiresAt)) {
      return res.status(403).json({
        error: 'trial_expired',
        message: 'Your 3-month trial grace period has expired. Please contact support.',
      });
    }

    // Attach user & token context
    req.user = user;
    req.token = token;
    req.tokenPayload = decoded;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional authentication middleware for endpoints like POST /tickets
 * Attaches user if a valid token is present, but allows anonymous requests to proceed.
 */
async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.headers['x-access-token'];
  if (!authHeader) {
    req.user = null;
    return next();
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : authHeader.trim();

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = verifyToken(token);
    await connectToDatabase();

    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ tokenId: decoded.jti });
      if (revoked) {
        req.user = null;
        return next();
      }
    }

    const user = await User.findById(decoded.userId);
    if (
      user &&
      (!user.lastLoggedOutAllAt || !decoded.iat || (decoded.iat * 1000) >= new Date(user.lastLoggedOutAllAt).getTime()) &&
      (!user.graceExpiresAt || new Date() <= new Date(user.graceExpiresAt))
    ) {
      req.user = user;
      req.token = token;
      req.tokenPayload = decoded;
    } else {
      req.user = null;
    }
  } catch (err) {
    // If token invalid, proceed as anonymous
    req.user = null;
  }

  next();
}

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
};
