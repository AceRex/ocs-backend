const mongoose = require('mongoose');

const guestDeviceSchema = new mongoose.Schema(
  {
    machineId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    guestExpiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    ip: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    platform: {
      type: String,
      default: null,
    },
    checkCount: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

guestDeviceSchema.methods.isExpired = function () {
  return Date.now() >= new Date(this.guestExpiresAt).getTime();
};

guestDeviceSchema.methods.getRemainingSeconds = function () {
  const diffMs = new Date(this.guestExpiresAt).getTime() - Date.now();
  return Math.max(0, Math.floor(diffMs / 1000));
};

const GuestDevice =
  mongoose.models.GuestDevice || mongoose.model('GuestDevice', guestDeviceSchema);

module.exports = GuestDevice;
