const express = require("express");
const PlanPermission = require("../models/PlanPermission");
const User = require("../models/User");
const { connectToDatabase } = require("../config/db");

const { authMiddleware } = require("../middleware/auth");
const { superAdminMiddleware } = require("../middleware/admin");
const router = express.Router();

const INITIAL_PERMISSIONS = [
  // Timer & Broadcast
  { key: "timer.basic", name: "Basic Countdown & Service Timer", category: "timer", description: "Core timer with countdown, count-up, and basic clock projection", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "broadcast.basic", name: "Live Broadcast Output", category: "broadcast", description: "Single-channel display broadcast to primary sanctuary display", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "timer.start_time", name: "Scheduled Start Timer", category: "timer", description: "Schedule custom countdown start times tied to service schedule", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "timer.interval", name: "Interval & Multi-Segment Timers", category: "timer", description: "Configurable interval loops and sermon segment warnings", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "timer.change_view", name: "Custom Timer View & Skins", category: "timer", description: "Customizable timer layouts, high-contrast skins, and stage views", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "presentation.intro", name: "Service Intro Video Bumpers", category: "presentation", description: "Automated pre-service video bumpers and welcome loops", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "presentation.outro", name: "Service Outro & Benediction Wraps", category: "presentation", description: "Automated service conclusion video wraps and announcements", enabledTiers: ["large", "premium"], isSystem: true },

  // Documents & Presentation
  { key: "presentation.basic", name: "General Presentation Engine", category: "presentation", description: "Multi-slide presentation player with quick-cue controls", enabledTiers: ["trial", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "pdf.view", name: "PDF Viewer & Sermon Notes", category: "documents", description: "Render and advance PDF documents on sanctuary screens", enabledTiers: ["trial", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "pdf.edit", name: "PDF In-App Editor & Annotator", category: "documents", description: "Real-time PDF page reordering, cropping, and text callouts", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "slides.use", name: "Custom Slide Designer", category: "presentation", description: "Full slide creation tool with background media and scripture inserts", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "scene.basic", name: "Standard Scene Management", category: "presentation", description: "Save and recall stage layouts and sanctuary projection scenes", enabledTiers: ["trial", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "scene.animations", name: "Dynamic Scene Animations", category: "presentation", description: "Keyframed lower-third and lyric slide element animations", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "scene.transitions", name: "Cinematic Transitions (Cut, Dissolve, Wipe)", category: "presentation", description: "Broadcast-grade hardware-accelerated video transitions", enabledTiers: ["large", "premium"], isSystem: true },

  // Worship & Lyrics
  { key: "song.basic", name: "Hymn & Song Lyrics Projection", category: "worship", description: "Searchable chord & lyric projection library with live verse jumping", enabledTiers: ["trial", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "song.chorus_flow", name: "Interactive Chorus Flow Loop", category: "worship", description: "Dynamic spontaneous chorus/bridge looping and stage cue triggers", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "song.repeat", name: "Custom Song Section Repeat", category: "worship", description: "One-click verse and chorus repeat triggers for worship leaders", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "sing_along", name: "Karaoke-Style Sing Along Guide", category: "worship", description: "Synchronized syllable and lyric bouncing ball guide", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "read_along", name: "Scripture Teleprompter & Read Along", category: "worship", description: "Dynamic congregation scripture reader with confidence prompter", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "premium.full_access", name: "Enterprise Unrestricted Full Access", category: "system", description: "Unconstrained permission bypass unlocking all current and future capabilities", enabledTiers: ["premium"], isSystem: true },
];

async function ensurePermissionsSeeded() {
  const count = await PlanPermission.countDocuments();
  if (count === 0) {
    await PlanPermission.insertMany(INITIAL_PERMISSIONS);
  }
}

/**
 * GET /api/permissions & /api/admin/permissions
 */
router.get("/", async (req, res, next) => {
  try {
    await connectToDatabase();
    await ensurePermissionsSeeded();

    const permissions = await PlanPermission.find().sort({ category: 1, createdAt: 1 });
    const tiers = ["trial", "free", "mini", "standard", "large", "premium"];

    // Build tier-to-features map
    const tierFeatures = {};
    for (const t of tiers) {
      tierFeatures[t] = permissions
        .filter((p) => p.enabledTiers.includes(t))
        .map((p) => p.key);
    }

    res.json({
      success: true,
      tiers,
      permissions,
      tierFeatures,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/permissions & /api/admin/permissions
 * Create a new custom permission
 */
router.post("/", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { key, name, category = "custom", description = "", enabledTiers = [] } = req.body;

    if (!key || !name) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Permission key and name are required",
      });
    }

    const cleanKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
    const existing = await PlanPermission.findOne({ key: cleanKey });

    if (existing) {
      return res.status(409).json({
        error: "permission_exists",
        message: `Permission key "${cleanKey}" already exists`,
      });
    }

    const newPerm = await PlanPermission.create({
      key: cleanKey,
      name: name.trim(),
      category: ["timer", "broadcast", "documents", "presentation", "worship", "system", "custom"].includes(category) ? category : "custom",
      description: description.trim(),
      enabledTiers: Array.isArray(enabledTiers) ? enabledTiers : [],
      isSystem: false,
    });

    res.status(201).json({
      success: true,
      message: `Permission "${newPerm.name}" created successfully`,
      permission: newPerm,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/permissions/toggle & /api/admin/permissions/toggle
 * Toggle permission on/off for a specific tier
 */
router.put("/toggle", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { key, tier, enabled } = req.body;

    if (!key || !tier) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Permission key and tier are required",
      });
    }

    const cleanKey = key.trim().toLowerCase();
    const cleanTier = tier.trim().toLowerCase();

    let perm = await PlanPermission.findOne({ key: cleanKey });
    if (!perm) {
      await ensurePermissionsSeeded();
      perm = await PlanPermission.findOne({ key: cleanKey });
    }

    if (!perm) {
      return res.status(404).json({
        error: "not_found",
        message: `Permission "${cleanKey}" not found`,
      });
    }

    const isCurrentlyEnabled = perm.enabledTiers.includes(cleanTier);
    const shouldEnable = enabled !== undefined ? Boolean(enabled) : !isCurrentlyEnabled;

    if (shouldEnable && !isCurrentlyEnabled) {
      perm.enabledTiers.push(cleanTier);
    } else if (!shouldEnable && isCurrentlyEnabled) {
      perm.enabledTiers = perm.enabledTiers.filter((t) => t !== cleanTier);
    }

    await perm.save();

    res.json({
      success: true,
      message: `Permission "${perm.name}" ${shouldEnable ? "enabled" : "disabled"} for ${cleanTier.toUpperCase()} tier`,
      key: perm.key,
      tier: cleanTier,
      enabled: shouldEnable,
      permission: perm,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/permissions/:key
 */
router.delete("/:key", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { key } = req.params;
    const cleanKey = key.trim().toLowerCase();

    const perm = await PlanPermission.findOne({ key: cleanKey });
    if (!perm) {
      return res.status(404).json({ error: "not_found", message: "Permission not found" });
    }

    if (perm.isSystem) {
      return res.status(400).json({ error: "system_permission", message: "Cannot delete built-in system permission" });
    }

    await PlanPermission.deleteOne({ key: cleanKey });

    res.json({
      success: true,
      message: `Permission "${cleanKey}" deleted successfully`,
      deletedKey: cleanKey,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/permissions/user/:id/tier
 * Update a specific customer user's subscription tier and quotas
 */
const updateUserTierHandler = async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { subscriptionTier, extendMonths = 0 } = req.body;

    const validTiers = ["trial", "free", "mini", "standard", "large", "premium"];
    if (subscriptionTier && !validTiers.includes(subscriptionTier)) {
      return res.status(400).json({ error: "invalid_tier", message: "Invalid subscription tier" });
    }

    let user = null;
    if (mongoose.isValidObjectId(id) || (id && id.match(/^[0-9a-fA-F]{24}$/))) {
      user = await User.findById(id);
    }
    if (!user) {
      user = await User.findOne({
        $or: [{ email: id.toLowerCase().trim() }, { churchName: id }],
      });
    }

    if (!user) {
      return res.status(404).json({ error: "not_found", message: `User "${id}" not found` });
    }

    if (subscriptionTier) {
      user.subscriptionTier = subscriptionTier;
    }

    if (extendMonths > 0) {
      const now = new Date();
      const newExpiry = new Date(now.setMonth(now.getMonth() + Number(extendMonths)));
      user.graceExpiresAt = newExpiry;
      user.subscriptionExpiresAt = newExpiry;
      if (subscriptionTier === "trial") {
        user.trialEndsAt = newExpiry;
      }
    }

    await user.save();

    res.json({
      success: true,
      message: `Updated ${user.churchName} to ${user.subscriptionTier.toUpperCase()} tier`,
      user: {
        id: user.id || user._id.toString(),
        name: user.name,
        email: user.email,
        church: user.churchName,
        subscriptionTier: user.subscriptionTier,
        effectiveTier: typeof user.getEffectiveTier === "function" ? user.getEffectiveTier() : user.subscriptionTier,
        trialRemainingDays: typeof user.getTrialRemainingDays === "function" ? user.getTrialRemainingDays() : 60,
        graceExpiresAt: user.graceExpiresAt,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

router.put("/user/:id/tier", authMiddleware, superAdminMiddleware, updateUserTierHandler);
router.put("/users/:id/tier", authMiddleware, superAdminMiddleware, updateUserTierHandler);

module.exports = router;
