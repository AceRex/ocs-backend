const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const AccountTier = {
  TRIAL: "trial",
  FREE: "free",
  MINI: "mini",
  STANDARD: "standard",
  LARGE: "large",
  PREMIUM: "premium",
};

const PLAN_FEATURES = {
  free: [
    "timer.basic",
    "broadcast.basic",
    "presentation.basic",
    "pdf.view",
    "scene.basic",
    "song.basic",
  ],
  trial: [
    "timer.basic",
    "broadcast.basic",
    "presentation.basic",
    "pdf.view",
    "scene.basic",
    "song.basic",
  ],
  mini: [
    "timer.basic",
    "broadcast.basic",
    "presentation.basic",
    "pdf.view",
    "scene.basic",
    "song.basic",
  ],
  standard: [
    "timer.basic",
    "broadcast.basic",
    "timer.interval",
    "timer.change_view",
    "session.recording",
    "session.bumper",
    "presentation.basic",
    "pdf.view",
    "slides.use",
    "scene.basic",
    "song.basic",
  ],
  large: [
    "timer.basic",
    "broadcast.basic",
    "timer.start_time",
    "timer.interval",
    "timer.change_view",
    "session.recording",
    "session.bumper",
    "presentation.basic",
    "presentation.multi_pptx",
    "presentation.intro",
    "presentation.outro",
    "pdf.view",
    "pdf.edit",
    "slides.use",
    "scene.basic",
    "scene.animations",
    "scene.transitions",
    "song.basic",
    "song.chorus_flow",
    "song.repeat",
    "sing_along",
    "read_along",
  ],
  premium: [
    "premium.full_access",
    "timer.basic",
    "broadcast.basic",
    "timer.start_time",
    "timer.interval",
    "timer.change_view",
    "session.recording",
    "session.bumper",
    "presentation.basic",
    "presentation.multi_pptx",
    "presentation.intro",
    "presentation.outro",
    "pdf.view",
    "pdf.edit",
    "slides.use",
    "scene.basic",
    "scene.animations",
    "scene.transitions",
    "song.basic",
    "song.chorus_flow",
    "song.repeat",
    "sing_along",
    "read_along",
  ],
};

const PLAN_QUOTAS = {
  free: { maxDesktops: 1, maxMobileUsers: 3 },
  trial: { maxDesktops: 1, maxMobileUsers: 3 },
  mini: { maxDesktops: 1, maxMobileUsers: 5 },
  standard: { maxDesktops: 1, maxMobileUsers: 5 },
  large: { maxDesktops: 2, maxMobileUsers: 5 },
  premium: { maxDesktops: 99, maxMobileUsers: 99 },
};

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
      select: false,
    },
    customerType: {
      type: String,
      enum: ["church", "streamer", "podcast"],
      default: "church",
      index: true,
    },
    churchName: {
      type: String,
      required: [true, "Organization, Channel, or Podcast name is required"],
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: "",
    },
    avatarPublicId: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    bio: {
      type: String,
      trim: true,
      default: "",
    },
    preferredBibleTranslation: {
      type: String,
      trim: true,
      default: "KJV",
    },
    roleTitle: {
      type: String,
      trim: true,
      default: "Worship & Media Director",
    },
    notificationPreferences: {
      emailUpdates: { type: Boolean, default: true },
      serviceReminders: { type: Boolean, default: true },
      weeklyDigest: { type: Boolean, default: true },
    },
    channelLink: {
      type: String,
      trim: true,
      default: "",
    },
    podcastLink: {
      type: String,
      trim: true,
      default: "",
    },
    role: {
      type: String,
      enum: ["super_admin", "church_admin", "user", "admin"],
      default: "church_admin",
      index: true,
    },
    // Subscription & Tier System
    subscriptionTier: {
      type: String,
      enum: ["trial", "free", "mini", "standard", "large", "premium"],
      default: "trial",
      index: true,
    },
    trialStartedAt: {
      type: Date,
      default: Date.now,
    },
    trialEndsAt: {
      type: Date,
      default: function() {
        return new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // Standard 60-day (2-Month) Free Trial
      },
    },
    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
    // Desktop & Mobile quotas & active device tracking
    licenseQuotas: {
      maxDesktops: {
        type: Number,
        default: 1, // Default for 2-month Trial (Mini setup)
      },
      maxMobileUsers: {
        type: Number,
        default: 3, // Default for 2-month Trial (Mini setup)
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
      default: function() {
        return new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // Standard 60-day Free Trial Grace
      },
    },
    // Password reset fields (FR-15.3)
    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
      index: true,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },
    // Subscription reminder tracking fields
    lastSubscriptionReminderSentAt: {
      type: Date,
      default: null,
    },
    lastSubscriptionReminderType: {
      type: String,
      default: null,
    },
    lastLoggedOutAllAt: {
      type: Date,
      default: null,
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
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        return ret;
      },
    },
  }
);

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error("Password hash not loaded on user model");
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.methods.isGraceExpired = function () {
  const trialEnd = this.trialEndsAt || this.graceExpiresAt;
  if (!trialEnd) return false;
  return new Date() > new Date(trialEnd);
};

userSchema.methods.getEffectiveTier = function () {
  if (this.role === "super_admin" || this.role === "admin") {
    return "premium";
  }
  // Check active paid subscription
  if (
    this.subscriptionTier &&
    ["mini", "standard", "large", "premium"].includes(this.subscriptionTier)
  ) {
    if (!this.subscriptionExpiresAt || new Date(this.subscriptionExpiresAt) > new Date()) {
      return this.subscriptionTier;
    }
    // Paid subscription expired → downgrade to free
    return "free";
  }
  // Check active trial
  if (this.subscriptionTier === "trial") {
    const trialEnd = this.trialEndsAt || this.graceExpiresAt;
    if (trialEnd && new Date() <= new Date(trialEnd)) {
      return "trial";
    }
    // Trial expired → free
    return "free";
  }
  // free or anything else
  return "free";
};

userSchema.methods.getRemainingDays = function () {
  const tier = typeof this.getEffectiveTier === "function" ? this.getEffectiveTier() : this.subscriptionTier;
  if (tier === "free") return 0;
  if ((this.role === "super_admin" || this.role === "admin" || tier === "premium") && !this.subscriptionExpiresAt) {
    return 999;
  }

  // If on a paid plan (mini, standard, large, premium) and subscriptionExpiresAt is defined
  if (this.subscriptionExpiresAt && ["mini", "standard", "large", "premium"].includes(this.subscriptionTier)) {
    const diffMs = new Date(this.subscriptionExpiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  const trialStart = this.trialStartedAt || this.createdAt || new Date();
  let trialEnd = this.trialEndsAt || this.graceExpiresAt;

  // Normalize legacy records if trialEnd was initialized via setMonth(+2) resulting in >60 days
  if (trialStart && trialEnd) {
    const totalTrialDays = (new Date(trialEnd).getTime() - new Date(trialStart).getTime()) / (1000 * 60 * 60 * 24);
    if (totalTrialDays > 60) {
      trialEnd = new Date(new Date(trialStart).getTime() + 60 * 24 * 60 * 60 * 1000);
    }
  }

  if (!trialEnd) return 0;
  const diffMs = new Date(trialEnd).getTime() - Date.now();
  if (diffMs <= 0) return 0;

  const remaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.min(60, Math.max(0, remaining));
};

userSchema.methods.getTrialRemainingDays = function () {
  return this.getRemainingDays();
};

userSchema.methods.getEntitlements = function () {
  const tier = this.getEffectiveTier();
  const trialEnd = this.trialEndsAt || this.graceExpiresAt || new Date();
  const remainingDays = this.getRemainingDays();
  const isTrial = tier === "trial";
  const isTrialExpired = !isTrial && tier === "free" && new Date() > new Date(trialEnd);
  const features = PLAN_FEATURES[tier] || PLAN_FEATURES.free;
  const quotas = PLAN_QUOTAS[tier] || PLAN_QUOTAS.free;

  return {
    tier,
    isTrial,
    isTrialExpired,
    trialStartedAt: this.trialStartedAt || this.createdAt || new Date(),
    trialEndsAt: trialEnd,
    trialRemainingDays: remainingDays,
    daysRemaining: remainingDays,
    subscriptionExpiresAt: this.subscriptionExpiresAt,
    features,
    limits: quotas,
  };
};

userSchema.statics.computeGraceExpiry = function (months = 2, startDate = new Date()) {
  const start = new Date(startDate);
  return new Date(start.getTime() + months * 30 * 24 * 60 * 60 * 1000);
};

userSchema.statics.computeTrialExpiry = function (months = 2, startDate = new Date()) {
  const start = new Date(startDate);
  return new Date(start.getTime() + months * 30 * 24 * 60 * 60 * 1000);
};

userSchema.statics.PLAN_FEATURES = PLAN_FEATURES;
userSchema.statics.PLAN_QUOTAS = PLAN_QUOTAS;
userSchema.statics.AccountTier = AccountTier;

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
