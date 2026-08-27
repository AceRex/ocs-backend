const express = require("express");
const mongoose = require("mongoose");
const PlanPermission = require("../models/PlanPermission");
const User = require("../models/User");
const SubscriptionHistory = require("../models/SubscriptionHistory");
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
  { key: "session.recording", name: "Automated Session & Sermon Recording", category: "sessions", description: "Automatic synchronized MP4 and audio recording with timer", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "session.bumper", name: "Video Bumpers & Transitions", category: "sessions", description: "Pre-service and post-service bumper video clips and intros", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "presentation.intro", name: "Service Intro Video Bumpers", category: "presentation", description: "Automated pre-service video bumpers and welcome loops", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "presentation.outro", name: "Service Outro & Benediction Wraps", category: "presentation", description: "Automated service conclusion video wraps and announcements", enabledTiers: ["large", "premium"], isSystem: true },

  // Documents & Presentation
  { key: "presentation.basic", name: "General Presentation Engine", category: "presentation", description: "Multi-slide presentation player with quick-cue controls", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "presentation.multi_pptx", name: "Unlimited PowerPoint PPTX Decks", category: "presentation", description: "Import and manage multiple PPTX decks concurrently", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "pdf.view", name: "PDF Viewer & Sermon Notes", category: "documents", description: "Render and advance PDF documents on sanctuary screens", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "pdf.edit", name: "PDF In-App Editor & Annotator", category: "documents", description: "Real-time PDF page reordering, cropping, and text callouts", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "slides.use", name: "Custom Slide Designer", category: "presentation", description: "Full slide creation tool with background media and scripture inserts", enabledTiers: ["standard", "large", "premium"], isSystem: true },
  { key: "scene.basic", name: "Standard Scene Management", category: "presentation", description: "Save and recall stage layouts and sanctuary projection scenes", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
  { key: "scene.animations", name: "Dynamic Scene Animations", category: "presentation", description: "Keyframed lower-third and lyric slide element animations", enabledTiers: ["large", "premium"], isSystem: true },
  { key: "scene.transitions", name: "Cinematic Transitions (Cut, Dissolve, Wipe)", category: "presentation", description: "Broadcast-grade hardware-accelerated video transitions", enabledTiers: ["large", "premium"], isSystem: true },

  // Worship & Lyrics
  { key: "song.basic", name: "Hymn & Song Lyrics Projection", category: "worship", description: "Searchable chord & lyric projection library with live verse jumping", enabledTiers: ["trial", "free", "mini", "standard", "large", "premium"], isSystem: true },
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
 * GET /api/permissions/history & /api/admin/subscription-history
 * Fetch transaction & plan upgrade history logs
 */
router.get("/history", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { page = 1, limit = 50, search = "", plan = "" } = req.query;

    const query = {};
    if (search) {
      const searchRegex = new RegExp(search.trim(), "i");
      query.$or = [
        { userName: searchRegex },
        { userEmail: searchRegex },
        { churchName: searchRegex },
        { transactionReference: searchRegex },
      ];
    }
    if (plan && plan !== "all") {
      query.$or = [{ previousPlan: plan }, { newPlan: plan }];
    }

    const total = await SubscriptionHistory.countDocuments(query);
    const history = await SubscriptionHistory.find(query)
      .sort({ upgradedAt: -1, createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      history,
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
    const {
      subscriptionTier,
      extendMonths = 0,
      reason,
      billingCycle,
      paymentMethod,
      transactionReference,
    } = req.body;

    const validTiers = ["trial", "free", "mini", "standard", "large", "premium", "mini_setup", "standard_setup", "large_setup", "premium_setup"];
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

    const previousPlan = user.subscriptionTier || "trial";
    const normalizedNewTier = subscriptionTier ? subscriptionTier.replace(/_setup$/, "") : previousPlan;

    if (subscriptionTier) {
      user.subscriptionTier = normalizedNewTier;
    }

    const now = new Date();
    const months = Number(extendMonths) > 0 ? Number(extendMonths) : (normalizedNewTier === "trial" ? 2 : 1);
    const newExpiry = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    if (["mini", "standard", "large", "premium"].includes(normalizedNewTier)) {
      user.subscriptionStartedAt = now;
      user.subscriptionExpiresAt = newExpiry;
      user.graceExpiresAt = newExpiry;
    } else if (normalizedNewTier === "trial") {
      user.trialStartedAt = now;
      user.trialEndsAt = newExpiry;
      user.graceExpiresAt = newExpiry;
      user.subscriptionExpiresAt = null;
    } else if (normalizedNewTier === "free") {
      user.subscriptionExpiresAt = null;
      user.trialEndsAt = now;
      user.graceExpiresAt = now;
    }

    // Update license quotas
    const quotas = User.PLAN_QUOTAS?.[normalizedNewTier] || User.PLAN_QUOTAS?.free || { maxDesktops: 1, maxMobileUsers: 3 };
    if (!user.licenseQuotas) {
      user.licenseQuotas = { activeDesktops: [], activeMobileUsers: [] };
    }
    user.licenseQuotas.maxDesktops = quotas.maxDesktops;
    user.licenseQuotas.maxMobileUsers = quotas.maxMobileUsers;

    await user.save();

    const remainingDays = typeof user.getRemainingDays === "function" ? user.getRemainingDays() : (typeof user.getTrialRemainingDays === "function" ? user.getTrialRemainingDays() : 30);

    // Record transaction in SubscriptionHistory
    try {
      await SubscriptionHistory.create({
        userId: user._id,
        userName: user.name || "",
        userEmail: user.email,
        churchName: user.churchName || "",
        previousPlan,
        newPlan: user.subscriptionTier,
        upgradedAt: now,
        durationMonths: months,
        daysRemaining: remainingDays,
        newExpiryDate: user.subscriptionExpiresAt || user.trialEndsAt || user.graceExpiresAt,
        changedBy: req.user ? {
          id: req.user.id || req.user._id,
          name: req.user.name || "Admin",
          email: req.user.email || "",
          role: req.user.role || "admin",
        } : { role: "system" },
        action: req.user?.role === "super_admin" || req.user?.role === "admin" ? "admin_tier_change" : "user_upgrade",
        reason: reason || `Tier changed from ${previousPlan.toUpperCase()} to ${user.subscriptionTier.toUpperCase()}`,
        billingCycle: billingCycle || (months >= 12 ? "annually" : months >= 6 ? "semi-annual" : "monthly"),
        paymentMethod: paymentMethod || "admin_assigned",
        transactionReference: transactionReference || `TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      });
    } catch (histErr) {
      console.warn("Failed to create SubscriptionHistory record:", histErr);
    }

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
        trialRemainingDays: remainingDays,
        daysRemaining: remainingDays,
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
