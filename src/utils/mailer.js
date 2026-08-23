/**
 * Mailer module adapter.
 * Re-exports unified emailService methods for transactional messaging via Resend.
 */
const emailService = require('./emailService');

module.exports = emailService;
