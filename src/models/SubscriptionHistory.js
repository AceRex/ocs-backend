const mongoose = require("mongoose");

const subscriptionHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userName: {
      type: String,
      default: "",
    },
    userEmail: {
      type: String,
      required: true,
      index: true,
    },
    churchName: {
      type: String,
      default: "",
      index: true,
    },
    previousPlan: {
      type: String,
      required: true,
      enum: ["trial", "free", "mini", "standard", "large", "premium", "mini_setup", "standard_setup", "large_setup", "premium_setup"],
      default: "trial",
    },
    newPlan: {
      type: String,
      required: true,
      enum: ["trial", "free", "mini", "standard", "large", "premium", "mini_setup", "standard_setup", "large_setup", "premium_setup"],
    },
    upgradedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    durationMonths: {
      type: Number,
      default: 1,
    },
    daysRemaining: {
      type: Number,
      default: 30,
    },
    newExpiryDate: {
      type: Date,
      default: null,
    },
    changedBy: {
      id: { type: String, default: null },
      name: { type: String, default: "System" },
      email: { type: String, default: "" },
      role: { type: String, default: "admin" },
    },
    action: {
      type: String,
      enum: ["admin_upgrade", "admin_tier_change", "user_upgrade", "trial_extension", "system_reset", "payment_activation"],
      default: "admin_tier_change",
    },
    reason: {
      type: String,
      default: "Plan upgrade / tier adjustment",
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "semi-annual", "semi_annually", "annually", "lifetime", "custom"],
      default: "monthly",
    },
    paymentMethod: {
      type: String,
      default: "admin_assigned",
    },
    transactionReference: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

subscriptionHistorySchema.index({ createdAt: -1 });
subscriptionHistorySchema.index({ userEmail: 1, createdAt: -1 });

module.exports = mongoose.model("SubscriptionHistory", subscriptionHistorySchema);
