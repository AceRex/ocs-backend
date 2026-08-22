const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address",
      ],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false, // Do not return passwordHash by default
    },
    churchName: {
      type: String,
      required: [true, "Church / Organization name is required"],
      trim: true,
    },
    role: {
      type: String,
      enum: ["super_admin", "church_admin", "user", "admin"],
      default: "church_admin", // Registered users are Church Admins by default
      index: true,
    },
    // Desktop & Mobile sharing limits for Church Admins
    licenseQuotas: {
      maxDesktops: {
        type: Number,
        default: 2, // Maximum 2 desktop applications per church license
      },
      maxMobileUsers: {
        type: Number,
        default: 5, // Maximum 5 mobile companion devices per church license
      },
      activeDesktops: [
        {
          deviceId: { type: String, trim: true },
          name: { type: String, default: "Sanctuary Desktop" },
          platform: { type: String, default: "desktop" },
          registeredAt: { type: Date, default: Date.now },
          lastActiveAt: { type: Date, default: Date.now },
        },
      ],
      activeMobileUsers: [
        {
          deviceId: { type: String, trim: true },
          name: { type: String, default: "Worship Stage Companion" },
          platform: { type: String, default: "mobile" },
          registeredAt: { type: Date, default: Date.now },
          lastActiveAt: { type: Date, default: Date.now },
        },
      ],
    },
    churchAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    graceExpiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

// Method to verify candidate password against stored bcrypt hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error("Password hash not loaded on user model");
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Static helper to compute grace expiry date from months
userSchema.methods.isGraceExpired = function () {
  if (!this.graceExpiresAt) return false;
  return new Date() > new Date(this.graceExpiresAt);
};

userSchema.statics.computeGraceExpiry = function (months = 3, startDate = new Date()) {
  const expiry = new Date(startDate);
  expiry.setMonth(expiry.getMonth() + months);
  return expiry;
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
