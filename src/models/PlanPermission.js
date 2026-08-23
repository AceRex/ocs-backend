const mongoose = require("mongoose");

const planPermissionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["timer", "broadcast", "documents", "presentation", "worship", "system", "custom"],
      default: "custom",
    },
    description: {
      type: String,
      default: "",
    },
    enabledTiers: {
      type: [String],
      default: [],
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PlanPermission", planPermissionSchema);
