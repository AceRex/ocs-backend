const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { signToken, verifyToken, decodeToken } = require('../utils/jwt');
const { authMiddleware } = require('../middleware/auth');
const { loginAttemptTracker } = require('../middleware/rateLimiter');
const env = require('../config/env');
const { connectToDatabase } = require('../config/db');

const router = express.Router();

/**
 * POST /auth/signup
 * Register a new organization / church account.
 * Automatically computes graceExpiresAt based on GRACE_PERIOD_MONTHS.
 */
router.post('/signup', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { email, password, churchName } = req.body;

    // Validation
    if (!email || !password || !churchName) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'Email, password, and church name are required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email',
        message: 'Please provide a valid email address',
      });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        error: 'weak_password',
        message: 'Password must be at least 8 characters long',
      });
    }

    // Check duplicate
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({
        error: 'email_exists',
        message: 'An account with this email address already exists',
      });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Compute graceExpiresAt (e.g. 3 months from now)
    const graceExpiresAt = User.computeGraceExpiry(env.GRACE_PERIOD_MONTHS);

    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      churchName: churchName.trim(),
      role: 'user',
      graceExpiresAt,
    });

    // Auto-login: issue JWT
    const { token } = signToken(user);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        churchName: user.churchName,
        role: user.role,
        graceExpiresAt: user.graceExpiresAt,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/login
 * Log in with email and password.
 * Rate limited to prevent brute force.
 * Checks trial grace period and returns distinct 'trial_expired' on expiry.
 */
router.post('/login', async (req, res, next) => {
  try {
    await connectToDatabase();

    // Check rate limit lockout
    const lockStatus = loginAttemptTracker.isLocked(req);
    if (lockStatus.locked) {
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many failed login attempts. Please try again in ${lockStatus.remainingSeconds} seconds.`,
        retryAfterSeconds: lockStatus.remainingSeconds,
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        error: 'missing_credentials',
        message: 'Email and password are required',
      });
    }

    // Find user with passwordHash
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select('+passwordHash');

    if (!user) {
      loginAttemptTracker.recordFailure(req);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    // Verify password hash
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      loginAttemptTracker.recordFailure(req);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    // Successful password match — reset failed attempts tracker
    loginAttemptTracker.reset(req);

    // Check 3-month trial grace period
    if (user.graceExpiresAt && new Date() > new Date(user.graceExpiresAt)) {
      return res.status(403).json({
        error: 'trial_expired',
        message:
          'Your 3-month trial grace period has expired. Please contact support or renew your subscription.',
        graceExpiresAt: user.graceExpiresAt,
      });
    }

    // Issue JWT
    const { token } = signToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        churchName: user.churchName,
        role: user.role,
        graceExpiresAt: user.graceExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/validate-token
 * Validate token signature, revocation status, and user grace period.
 * Re-checks user's grace expiry on every call (Task 3.3).
 */
router.post('/validate-token', async (req, res, next) => {
  try {
    await connectToDatabase();

    const authHeader = req.headers.authorization || req.headers['x-access-token'];
    let token = req.body?.token;

    if (!token && authHeader) {
      token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : authHeader.trim();
    }

    if (!token) {
      return res.status(200).json({
        valid: false,
        reason: 'missing_token',
        message: 'No token provided',
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(200).json({
          valid: false,
          reason: 'token_expired',
          message: 'Token has expired',
        });
      }
      return res.status(200).json({
        valid: false,
        reason: 'invalid_token',
        message: 'Invalid token signature',
      });
    }

    // Check revocation in database
    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ tokenId: decoded.jti });
      if (revoked) {
        return res.status(200).json({
          valid: false,
          reason: 'token_revoked',
          message: 'Token has been revoked',
        });
      }
    }

    // Check user in database
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(200).json({
        valid: false,
        reason: 'user_not_found',
        message: 'Associated user account no longer exists',
      });
    }

    // Re-check grace period on every call
    if (user.graceExpiresAt && new Date() > new Date(user.graceExpiresAt)) {
      return res.status(200).json({
        valid: false,
        reason: 'trial_expired',
        message: 'Your 3-month trial grace period has expired',
      });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        churchName: user.churchName,
        role: user.role,
        graceExpiresAt: user.graceExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/revoke
 * Add token's jti to revokedTokens collection. Called on explicit logout.
 */
router.post('/revoke', async (req, res, next) => {
  try {
    await connectToDatabase();

    const authHeader = req.headers.authorization || req.headers['x-access-token'];
    let token = req.body?.token;

    if (!token && authHeader) {
      token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : authHeader.trim();
    }

    if (!token) {
      return res.status(400).json({
        error: 'missing_token',
        message: 'Token is required to revoke',
      });
    }

    const decoded = decodeToken(token);
    if (!decoded || !decoded.jti) {
      return res.status(400).json({
        error: 'invalid_token',
        message: 'Token does not contain a valid revocation ID (jti)',
      });
    }

    // Store in revokedTokens collection
    await RevokedToken.findOneAndUpdate(
      { tokenId: decoded.jti },
      { tokenId: decoded.jti, revokedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Token revoked successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/me
 * Return currently authenticated user profile.
 */
router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      churchName: req.user.churchName,
      role: req.user.role,
      graceExpiresAt: req.user.graceExpiresAt,
      createdAt: req.user.createdAt,
    },
  });
});

module.exports = router;
