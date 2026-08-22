require('dotenv').config();

const env = {
  get NODE_ENV() {
    return process.env.NODE_ENV || 'development';
  },
  get PORT() {
    return parseInt(process.env.PORT || '5001', 10);
  },
  get MONGODB_URI() {
    return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ocs';
  },
  get JWT_SECRET() {
    return process.env.JWT_SECRET || 'ocs_dev_secret_jwt_key_should_be_overridden_in_prod';
  },
  get JWT_EXPIRY() {
    return process.env.JWT_EXPIRY || '30d';
  },
  get GRACE_PERIOD_MONTHS() {
    return parseInt(process.env.GRACE_PERIOD_MONTHS || '3', 10);
  },
  get FRONTEND_URL() {
    return process.env.FRONTEND_URL || 'https://churchocs.com';
  },
};

// Validate critical secrets in production/runtime
if (!env.JWT_SECRET && env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
}

module.exports = env;
