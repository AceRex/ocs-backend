require("dotenv").config();

const env = {
  get NODE_ENV() {
    return process.env.NODE_ENV || "development";
  },
  get PORT() {
    return parseInt(process.env.PORT || "5001", 10);
  },
  get MONGODB_URI() {
    return process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ocs";
  },
  get JWT_SECRET() {
    if (!process.env.JWT_SECRET) {
      throw new Error(
        "FATAL: JWT_SECRET environment variable is required. Application startup aborted.",
      );
    }
    return process.env.JWT_SECRET;
  },
  get JWT_EXPIRY() {
    return process.env.JWT_EXPIRY || "30d";
  },
  get GRACE_PERIOD_MONTHS() {
    return parseInt(process.env.GRACE_PERIOD_MONTHS || "3", 10);
  },
  get FRONTEND_URL() {
    return process.env.FRONTEND_URL || "http://localhost:5173";
  },
  get NOTIFICATION_EMAILS() {
    return (
      process.env.NOTIFICATION_EMAILS ||
      ""
    );
  },
  get RESEND_API_KEY() {
    return process.env.RESEND_API_KEY || "";
  },
  get RESEND_FROM_EMAIL() {
    return process.env.RESEND_FROM_EMAIL || "OCS <onboarding@resend.dev>";
  },
  get SMTP_HOST() {
    return process.env.SMTP_HOST || process.env.EMAIL_HOST || "";
  },
  get SMTP_PORT() {
    return parseInt(
      process.env.SMTP_PORT || process.env.EMAIL_PORT || "587",
      10,
    );
  },
  get SMTP_USER() {
    return (
      process.env.SMTP_USER ||
      process.env.EMAIL_USER ||
      process.env.GMAIL_USER ||
      ""
    );
  },
  get SMTP_PASS() {
    return (
      process.env.SMTP_PASS ||
      process.env.EMAIL_PASS ||
      process.env.GMAIL_APP_PASSWORD ||
      ""
    );
  },
  get FROM_EMAIL() {
    return (
      process.env.FROM_EMAIL ||
      `"OCS Support" <${process.env.SMTP_USER || "notifications@churchocs.com"}>`
    );
  },
};

if (process.env.NODE_ENV === "production") {
  for (const key of ["MONGODB_URI", "FRONTEND_URL"]) {
    if (!process.env[key]) throw new Error(`FATAL: ${key} is required in production`);
  }
  const frontend = new URL(process.env.FRONTEND_URL);
  if (frontend.protocol !== "https:") throw new Error("FATAL: FRONTEND_URL must use HTTPS in production");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes("REQUIRED_GENERATE")) {
    throw new Error("FATAL: JWT_SECRET must be a strong secret of at least 32 characters");
  }
}

// Validate critical secrets at startup: refuse to start without JWT_SECRET
if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required. Application startup aborted.",
  );
}

module.exports = env;
