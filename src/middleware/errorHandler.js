const env = require('../config/env');

/**
 * Centralized error handler.
 * Sanitizes errors, formats responses consistently, and never leaks sensitive data.
 */
function errorHandler(err, req, res, next) {
  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      error: 'duplicate_entry',
      message: `An account with this ${field} already exists`,
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      error: 'validation_error',
      message: messages[0] || 'Invalid request data',
      errors: messages,
    });
  }

  // CastError (e.g. invalid MongoDB ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'invalid_id',
      message: `Invalid ID format for ${err.path}`,
    });
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'invalid_token',
      message: 'Invalid authentication token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'token_expired',
      message: 'Authentication token has expired',
    });
  }

  // Default server error
  const status = err.status || err.statusCode || 500;
  const response = {
    error: err.error || 'server_error',
    message: err.message || 'An unexpected error occurred',
  };

  if (env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(status).json(response);
}

module.exports = errorHandler;
