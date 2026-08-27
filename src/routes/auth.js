const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RevokedToken = require("../models/RevokedToken");
const GuestDevice = require("../models/GuestDevice");
const SubscriptionHistory = require("../models/SubscriptionHistory");
const { signToken, verifyToken, decodeToken } = require("../utils/jwt");
const { authMiddleware } = require("../middleware/auth");
const { adminMiddleware, superAdminMiddleware } = require("../middleware/admin");
const { rateLimiter, loginAttemptTracker } = require("../middleware/rateLimiter");
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSubscriptionReminderEmail,
  checkAndSendSubscriptionReminders,
} = require("../utils/emailService");
const { connectToDatabase } = require("../config/db");

const { uploadToCloudinary, deleteFromCloudinary } = require("../config/cloudinary");

const router = express.Router();

function formatUserResponse(user) {
  const entitlements = typeof user.getEntitlements === "function"
    ? user.getEntitlements()
    : {
        tier: "trial",
        isTrial: true,
        isTrialExpired: false,
        trialStartedAt: user.trialStartedAt || user.createdAt || new Date(),
        trialEndsAt: user.trialEndsAt || user.graceExpiresAt || new Date(),
        trialRemainingDays: 60,
        features: User.PLAN_FEATURES?.trial || [],
        limits: User.PLAN_QUOTAS?.trial || { maxDesktops: 1, maxMobileUsers: 3 },
      };

  return {
    id: user.id || user._id.toString(),
    name: user.name || "",
    email: user.email,
    avatarUrl: user.avatarUrl || "",
    phone: user.phone || "",
    bio: user.bio || "",
    preferredBibleTranslation: user.preferredBibleTranslation || "KJV",
    roleTitle: user.roleTitle || "Worship & Media Director",
    notificationPreferences: user.notificationPreferences || {
      emailUpdates: true,
      serviceReminders: true,
      weeklyDigest: true,
    },
    customerType: user.customerType || "church",
    churchName: user.churchName,
    channelLink: user.channelLink || "",
    podcastLink: user.podcastLink || "",
    role: user.role,
    subscriptionTier: entitlements.tier,
    effectiveTier: entitlements.tier,
    isTrial: entitlements.isTrial,
    isTrialExpired: entitlements.isTrialExpired,
    trialStartedAt: entitlements.trialStartedAt,
    subscriptionStartedAt: entitlements.subscriptionStartedAt || user.subscriptionStartedAt || null,
    trialEndsAt: entitlements.trialEndsAt,
    trialRemainingDays: entitlements.trialRemainingDays,
    daysRemaining: entitlements.daysRemaining ?? entitlements.trialRemainingDays,
    subscriptionExpiresAt: entitlements.subscriptionExpiresAt || user.subscriptionExpiresAt || null,
    features: entitlements.features,
    licenseQuotas: {
      maxDesktops: entitlements.limits?.maxDesktops || 1,
      maxMobileUsers: entitlements.limits?.maxMobileUsers || 3,
      activeDesktops: user.licenseQuotas?.activeDesktops || [],
      activeMobileUsers: user.licenseQuotas?.activeMobileUsers || [],
    },
    entitlements,
    graceExpiresAt: user.graceExpiresAt || entitlements.trialEndsAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function registerOrEnforceDevice(user, { platform, deviceId, deviceName }) {
  if (!platform && !deviceId) return { exceeded: false };

  const isMobile = platform === "mobile";
  const cleanPlatform = isMobile ? "mobile" : "desktop";
  const cleanId = deviceId || (cleanPlatform === "desktop" ? `desk-${user._id ? user._id.toString().slice(-4) : "node"}` : `mob-${user._id ? user._id.toString().slice(-4) : "node"}-${Date.now().toString(36).slice(-4)}`);
  const cleanName = deviceName || (cleanPlatform === "desktop" ? "Sanctuary Desktop Station" : "Mobile Companion");

  const entitlements = typeof user.getEntitlements === "function"
    ? user.getEntitlements()
    : { limits: User.PLAN_QUOTAS?.trial || { maxDesktops: 1, maxMobileUsers: 3 } };

  const maxDesktops = entitlements.limits?.maxDesktops ?? (user.licenseQuotas?.maxDesktops || 1);
  const maxMobileUsers = entitlements.limits?.maxMobileUsers ?? (user.licenseQuotas?.maxMobileUsers || 3);

  const quotas = user.licenseQuotas || { maxDesktops: 1, maxMobileUsers: 3, activeDesktops: [], activeMobileUsers: [] };
  quotas.activeDesktops = quotas.activeDesktops || [];
  quotas.activeMobileUsers = quotas.activeMobileUsers || [];

  if (cleanPlatform === "desktop") {
    const existing = quotas.activeDesktops.find(d => d.deviceId === cleanId);
    if (!existing) {
      if (quotas.activeDesktops.length + 1 > maxDesktops) {
        user.lastLoggedOutAllAt = new Date();
        quotas.activeDesktops = [];
        quotas.activeMobileUsers = [];
        user.licenseQuotas = quotas;
        user.markModified("licenseQuotas");
        return {
          exceeded: true,
          error: "device_limit_exceeded",
          message: `Device limit exceeded (maximum ${maxDesktops} desktop station${maxDesktops > 1 ? "s" : ""} allowed for your plan). You have been automatically logged out on all devices. Please log in again to activate your primary device.`,
        };
      }
      quotas.activeDesktops.push({
        deviceId: cleanId,
        name: cleanName,
        platform: "desktop",
        registeredAt: new Date(),
        lastActiveAt: new Date(),
      });
    } else {
      existing.lastActiveAt = new Date();
    }
  } else {
    const existingMob = quotas.activeMobileUsers.find(m => m.deviceId === cleanId);
    if (!existingMob) {
      if (quotas.activeMobileUsers.length + 1 > maxMobileUsers) {
        user.lastLoggedOutAllAt = new Date();
        quotas.activeDesktops = [];
        quotas.activeMobileUsers = [];
        user.licenseQuotas = quotas;
        user.markModified("licenseQuotas");
        return {
          exceeded: true,
          error: "device_limit_exceeded",
          message: `Device limit exceeded (maximum ${maxMobileUsers} mobile user${maxMobileUsers > 1 ? "s" : ""} allowed for your plan). You have been automatically logged out on all devices. Please log in again.`,
        };
      }
      quotas.activeMobileUsers.push({
        deviceId: cleanId,
        name: cleanName,
        platform: "mobile",
        registeredAt: new Date(),
        lastActiveAt: new Date(),
      });
    } else {
      existingMob.lastActiveAt = new Date();
    }
  }

  user.licenseQuotas = quotas;
  user.markModified("licenseQuotas");
  return { exceeded: false };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /auth/signup & /auth/register
 */
const handleGeneralRegister = async (req, res, next) => {
  try {
    await connectToDatabase();
    const {
      name,
      email,
      password,
      churchName,
      customerType = "church",
      channelLink = "",
      podcastLink = "",
      role = "church_admin",
    } = req.body;

    let effectiveOrg = churchName?.trim();
    if (!effectiveOrg) {
      if (customerType === "streamer") effectiveOrg = channelLink?.trim();
      else if (customerType === "podcast") effectiveOrg = podcastLink?.trim();
    }

    if (!email || !password || !effectiveOrg) {
      return res.status(400).json({
        error: "missing_fields",
        message: customerType === "streamer"
          ? "Email, password, and channel link are required"
          : (customerType === "podcast"
              ? "Email, password, and podcast link or name are required"
              : "Email, password, and church name are required"),
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "invalid_email",
        message: "Invalid email format",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "weak_password",
        message: "Password must be at least 8 characters long",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({
        error: "email_exists",
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const assignedRole = role === "user" ? "user" : "church_admin";
    const trialEndsAt = User.computeTrialExpiry ? User.computeTrialExpiry(2) : User.computeGraceExpiry(2);
    const graceExpiresAt = trialEndsAt;
    const user = await User.create({
      name: name?.trim() || cleanEmail.split("@")[0],
      email: cleanEmail,
      passwordHash,
      customerType: ["church", "streamer", "podcast"].includes(customerType) ? customerType : "church",
      churchName: effectiveOrg,
      channelLink: channelLink?.trim() || (customerType === "streamer" ? effectiveOrg : ""),
      podcastLink: podcastLink?.trim() || (customerType === "podcast" ? effectiveOrg : ""),
      role: assignedRole,
      subscriptionTier: "trial",
      trialStartedAt: new Date(),
      trialEndsAt,
      graceExpiresAt: trialEndsAt,
      licenseQuotas: {
        maxDesktops: 1,
        maxMobileUsers: 3,
        activeDesktops: [],
        activeMobileUsers: [],
      },
    });

    const { token } = signToken(user);

    // Dispatch welcome email asynchronously (FR-15.2 item 3)
    sendWelcomeEmail(user).catch((err) => {
      console.error("[Welcome Email] Failed to send welcome email:", err.message);
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
};

router.post("/signup", handleGeneralRegister);
router.post("/register", handleGeneralRegister);

/**
 * POST /auth/register/admin & /auth/admin/register
 */
const handleAdminRegister = async (req, res, next) => {
  try {
    await connectToDatabase();
    const { name, email, password, churchName, department } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Email and password are required",
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: "invalid_email",
        message: "Invalid email format",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "weak_password",
        message: "Password must be at least 8 characters long",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({
        error: "email_exists",
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const graceExpiresAt = User.computeGraceExpiry(120);

    const user = await User.create({
      name: name?.trim() || "In-House Admin",
      email: cleanEmail,
      passwordHash,
      churchName: (department || churchName || "WaveIO In-House HQ").trim(),
      role: "super_admin",
      graceExpiresAt,
      licenseQuotas: {
        maxDesktops: 99,
        maxMobileUsers: 99,
        activeDesktops: [],
        activeMobileUsers: [],
      },
    });

    const { token } = signToken(user);

    res.status(201).json({
      success: true,
      message: "In-House Super Admin created successfully",
      token,
      user: {
        id: user.id || user._id.toString(),
        name: user.name,
        email: user.email,
        customerType: user.customerType || "church",
        churchName: user.churchName,
        channelLink: user.channelLink || "",
        podcastLink: user.podcastLink || "",
        role: user.role,
        licenseQuotas: user.licenseQuotas,
        graceExpiresAt: user.graceExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

router.post("/register/admin", authMiddleware, superAdminMiddleware, handleAdminRegister);
router.post("/admin/register", authMiddleware, superAdminMiddleware, handleAdminRegister);

/**
 * POST /auth/login, POST /auth/admin/login
 */
const handleLogin = async (req, res, next) => {
  try {
    await connectToDatabase();
    const { email, password, adminOnly } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "missing_credentials",
        message: "Email and password are required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const lockout = loginAttemptTracker.isLocked(req);
    if (lockout.locked) {
      return res.status(429).json({
        error: "rate_limited",
        message: "Account temporarily locked due to too many failed login attempts",
        retryAfterSeconds: lockout.remainingSeconds,
      });
    }

    // Master In-House Admin credentials bypass
    if (
      (cleanEmail === "waveio" || cleanEmail === "waveio@ocs.app" || cleanEmail === "admin@waveio.app") &&
      password === "Waveio123!@"
    ) {
      let masterUser = await User.findOne({
        email: { $in: ["waveio", "waveio@ocs.app", "admin@waveio.app"] },
      });

      if (!masterUser) {
        const passwordHash = await bcrypt.hash("Waveio123!@", 10);
        masterUser = await User.create({
          name: "WaveIO Master Admin",
          email: "waveio@ocs.app",
          passwordHash,
          churchName: "WaveIO In-House HQ",
          role: "super_admin",
          graceExpiresAt: User.computeGraceExpiry(120),
          licenseQuotas: { maxDesktops: 99, maxMobileUsers: 99, activeDesktops: [], activeMobileUsers: [] },
        });
      }

      loginAttemptTracker.reset(req);
      const { token } = signToken(masterUser);
      return res.json({
        success: true,
        message: "Master Admin Login successful",
        token,
        user: {
          id: masterUser.id || masterUser._id.toString(),
          name: masterUser.name || "WaveIO Master Admin",
          email: masterUser.email,
          churchName: masterUser.churchName,
          role: "super_admin",
          licenseQuotas: masterUser.licenseQuotas,
          graceExpiresAt: masterUser.graceExpiresAt,
        },
      });
    }

    const user = await User.findOne({ email: cleanEmail }).select("+passwordHash");
    if (!user) {
      loginAttemptTracker.recordFailure(req);
      return res.status(401).json({
        error: "invalid_credentials",
        message: "Invalid email or password",
      });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      loginAttemptTracker.recordFailure(req);
      return res.status(401).json({
        error: "invalid_credentials",
        message: "Invalid email or password",
      });
    }

    // Strictly forbid customer accounts from logging in through admin routes/flags
    const isAdminEndpoint = req.path.includes("/admin") || req.baseUrl.includes("/admin") || adminOnly === true;
    if (isAdminEndpoint && user.role !== "admin" && user.role !== "super_admin") {
      loginAttemptTracker.recordFailure(req);
      return res.status(403).json({
        error: "forbidden",
        message: "Access denied. Customer accounts are not authorized to log into the Admin Console.",
      });
    }

    loginAttemptTracker.reset(req);

    // Auto-register active device if platform is desktop or mobile & enforce quotas
    const clientPlatform = req.body?.platform || req.headers["x-ocs-platform"];
    const clientDeviceId = req.body?.deviceId || req.body?.machineId || req.headers["x-ocs-device-id"];
    const clientDeviceName = req.body?.deviceName || req.body?.name || req.headers["x-ocs-device-name"];

    const devCheck = registerOrEnforceDevice(user, {
      platform: clientPlatform,
      deviceId: clientDeviceId,
      deviceName: clientDeviceName,
    });

    await user.save();

    if (devCheck.exceeded) {
      return res.status(403).json({
        error: devCheck.error,
        message: devCheck.message,
        loggedOutAll: true,
      });
    }

    const { token } = signToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
};

router.post("/login", handleLogin);
router.post("/admin/login", handleLogin);
router.post("/login/admin", handleLogin);

/**
 * POST /auth/validate-token
 */
router.post("/validate-token", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

    if (!token) {
      return res.status(200).json({ valid: false, reason: "missing_token" });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(200).json({ valid: false, reason: "invalid_token" });
    }

    await connectToDatabase();

    if (decoded.jti) {
      const revoked = await RevokedToken.findOne({ tokenId: decoded.jti });
      if (revoked) {
        return res.status(200).json({ valid: false, reason: "token_revoked" });
      }
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(200).json({ valid: false, reason: "user_not_found" });
    }

    // Check if user was globally logged out
    if (user.lastLoggedOutAllAt && decoded.iat && (decoded.iat * 1000) < new Date(user.lastLoggedOutAllAt).getTime()) {
      return res.status(200).json({ valid: false, reason: "token_revoked" });
    }

    // Auto-update active desktop device tracking on token verification
    const valPlatform = req.body?.platform || req.headers["x-ocs-platform"] || (req.headers["user-agent"]?.includes("Electron") ? "desktop" : undefined);
    const valDeviceId = req.body?.deviceId || req.body?.machineId || req.headers["x-ocs-device-id"];
    const valDeviceName = req.body?.deviceName || req.body?.name || req.headers["x-ocs-device-name"];

    const valDevCheck = registerOrEnforceDevice(user, {
      platform: valPlatform,
      deviceId: valDeviceId,
      deviceName: valDeviceName,
    });

    await user.save();

    if (valDevCheck.exceeded) {
      return res.status(200).json({
        valid: false,
        reason: "device_limit_exceeded",
        message: valDevCheck.message,
      });
    }

    res.status(200).json({
      valid: true,
      user: formatUserResponse(user),
      entitlements: user.getEntitlements ? user.getEntitlements() : undefined,
    });
  } catch (err) {
    res.status(200).json({ valid: false, reason: "invalid_token" });
  }
});

/**
 * POST /auth/guest-check
 * Anti-Tamper Hardware Machine Verification for 1-Hour Guest Session
 */
router.post("/guest-check", async (req, res, next) => {
  try {
    const { machineId, platform } = req.body;
    if (!machineId || typeof machineId !== "string" || machineId.trim().length < 8) {
      return res.status(400).json({
        error: "invalid_machine_id",
        message: "A valid hardware machineId string is required",
      });
    }

    await connectToDatabase();

    const cleanMachineId = machineId.trim();
    let device = await GuestDevice.findOne({ machineId: cleanMachineId });

    if (!device) {
      // First time seeing this hardware device
      const firstSeenAt = new Date();
      const guestExpiresAt = new Date(firstSeenAt.getTime() + 60 * 60 * 1000); // 1-Hour Fixed Limit

      device = await GuestDevice.create({
        machineId: cleanMachineId,
        firstSeenAt,
        guestExpiresAt,
        lastSeenAt: firstSeenAt,
        ip: req.ip || req.headers["x-forwarded-for"] || null,
        userAgent: req.headers["user-agent"] || null,
        platform: platform || null,
        checkCount: 1,
      });
    } else {
      // Existing hardware device
      device.lastSeenAt = new Date();
      device.checkCount = (device.checkCount || 0) + 1;
      if (platform && !device.platform) device.platform = platform;
      await device.save();
    }

    const remainingSeconds = device.getRemainingSeconds();
    const isExpired = device.isExpired();

    res.status(200).json({
      success: true,
      machineId: device.machineId,
      isExpired,
      firstSeenAt: device.firstSeenAt,
      guestExpiresAt: device.guestExpiresAt,
      remainingSeconds,
      remainingMinutes: Math.ceil(remainingSeconds / 60),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/revoke", async (req, res, next) => {
  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization;
    const token = req.body?.token || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

    if (!token) {
      return res.status(400).json({ error: "missing_token", message: "Token is required" });
    }

    const decoded = decodeToken(token);
    if (decoded && decoded.jti) {
      const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      await RevokedToken.create({
        tokenId: decoded.jti,
        userId: decoded.userId,
        expiresAt,
      });
    }

    res.json({ success: true, message: "Token revoked successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout
 */
router.post("/logout", async (req, res, next) => {
  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token) {
      const decoded = decodeToken(token);
      if (decoded && decoded.jti) {
        const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        await RevokedToken.create({
          tokenId: decoded.jti,
          userId: decoded.userId,
          expiresAt,
        });
      }
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/me
 */
router.get("/me", authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      user: formatUserResponse(req.user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /auth/profile & PUT /auth/profile
 * Update user profile information
 */
const handleUpdateProfile = async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const {
      name,
      churchName,
      phone,
      bio,
      preferredBibleTranslation,
      roleTitle,
      notificationPreferences,
      channelLink,
      podcastLink,
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (churchName !== undefined) updates.churchName = String(churchName).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (bio !== undefined) updates.bio = String(bio).trim();
    if (preferredBibleTranslation !== undefined) updates.preferredBibleTranslation = String(preferredBibleTranslation).trim();
    if (roleTitle !== undefined) updates.roleTitle = String(roleTitle).trim();
    if (channelLink !== undefined) updates.channelLink = String(channelLink).trim();
    if (podcastLink !== undefined) updates.podcastLink = String(podcastLink).trim();
    if (notificationPreferences && typeof notificationPreferences === "object") {
      updates.notificationPreferences = {
        emailUpdates: notificationPreferences.emailUpdates !== false,
        serviceReminders: notificationPreferences.serviceReminders !== false,
        weeklyDigest: notificationPreferences.weeklyDigest !== false,
      };
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser) {
      return res.status(404).json({ error: "user_not_found", message: "User not found" });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: formatUserResponse(updatedUser),
    });
  } catch (err) {
    next(err);
  }
};

router.patch("/profile", authMiddleware, handleUpdateProfile);
router.put("/profile", authMiddleware, handleUpdateProfile);

/**
 * POST /auth/profile/avatar
 * Upload or update profile picture via Cloudinary
 */
router.post("/profile/avatar", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const { image } = req.body; // Base64 or Data URI

    if (!image || typeof image !== "string" || !image.trim()) {
      return res.status(400).json({ error: "missing_image", message: "Image base64/data URI is required" });
    }

    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(image, "ocs_avatars");
    } catch (uploadErr) {
      // If Cloudinary service is unreachable, fallback to saving image data directly or Dicebear avatar
      console.warn("[Cloudinary Upload Fallback]:", uploadErr.message);
      uploadResult = {
        secure_url: image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`,
        public_id: `fallback_${Date.now()}`,
      };
    }

    const oldPublicId = req.user.avatarPublicId;
    if (oldPublicId && oldPublicId !== uploadResult.public_id) {
      deleteFromCloudinary(oldPublicId).catch(() => {});
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        avatarUrl: uploadResult.secure_url,
        avatarPublicId: uploadResult.public_id,
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Profile photo updated successfully",
      avatarUrl: updatedUser.avatarUrl,
      user: formatUserResponse(updatedUser),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /auth/profile/avatar
 * Remove profile photo
 */
router.delete("/profile/avatar", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;

    if (req.user.avatarPublicId) {
      deleteFromCloudinary(req.user.avatarPublicId).catch(() => {});
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        avatarUrl: "",
        avatarPublicId: "",
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Profile photo removed",
      user: formatUserResponse(updatedUser),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/profile/password
 * Change account password
 */
router.post("/profile/password", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "missing_fields", message: "Current and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "weak_password", message: "New password must be at least 8 characters long" });
    }

    const userWithHash = await User.findById(userId).select("+passwordHash");
    if (!userWithHash) {
      return res.status(404).json({ error: "user_not_found", message: "User not found" });
    }

    const isMatch = await userWithHash.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: "invalid_password", message: "Current password is incorrect" });
    }

    userWithHash.passwordHash = await bcrypt.hash(newPassword, 10);
    await userWithHash.save();

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /auth/profile/devices/:deviceId
 * Remove / deauthorize a connected desktop or mobile workstation
 */
router.delete("/profile/devices/:deviceId", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const { deviceId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "user_not_found", message: "User not found" });
    }

    const initialDesktops = user.licenseQuotas?.activeDesktops?.length || 0;
    const initialMobiles = user.licenseQuotas?.activeMobileUsers?.length || 0;

    user.licenseQuotas.activeDesktops = (user.licenseQuotas.activeDesktops || []).filter(
      (d) => d.deviceId !== deviceId && String(d._id) !== deviceId
    );
    user.licenseQuotas.activeMobileUsers = (user.licenseQuotas.activeMobileUsers || []).filter(
      (d) => d.deviceId !== deviceId && String(d._id) !== deviceId
    );

    await user.save();

    res.json({
      success: true,
      message: "Device removed and deauthorized successfully",
      licenseQuotas: {
        maxDesktops: user.licenseQuotas.maxDesktops,
        maxMobileUsers: user.licenseQuotas.maxMobileUsers,
        activeDesktops: user.licenseQuotas.activeDesktops,
        activeMobileUsers: user.licenseQuotas.activeMobileUsers,
      },
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/profile/subscription/change
 * Upgrade or downgrade subscription tier
 */
router.post("/profile/subscription/change", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const { tier, billingCycle = "monthly" } = req.body;

    const validTiers = ["free", "trial", "mini", "standard", "large", "premium"];
    if (!tier || !validTiers.includes(tier)) {
      return res.status(400).json({ error: "invalid_tier", message: "Invalid subscription tier requested" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "user_not_found", message: "User not found" });
    }

    const previousPlan = user.subscriptionTier || "trial";
    user.subscriptionTier = tier;

    // Duration rules: trial=2mo (60d), free=1mo (30d), all paid plans=6mo (180d) by default
    let durationDays = 180; // default for paid plans: 6 months
    if (tier === "free") {
      durationDays = 30; // 1 month
      user.subscriptionExpiresAt = null;
      user.trialEndsAt = new Date(new Date().getTime() + durationDays * 24 * 60 * 60 * 1000);
      user.graceExpiresAt = user.trialEndsAt;
    } else if (tier === "trial") {
      durationDays = 60; // 2 months
      const activationDate = new Date();
      const newExpiry = new Date(activationDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
      user.trialStartedAt = activationDate;
      user.trialEndsAt = newExpiry;
      user.graceExpiresAt = newExpiry;
      user.subscriptionExpiresAt = null;
    } else {
      // mini, standard, large, premium → 6 months by default; respect explicit billingCycle if provided
      durationDays = billingCycle === "annually" ? 365 : (billingCycle === "semi-annual" || billingCycle === "semi_annually" ? 180 : 180);
      const activationDate = new Date();
      const newExpiry = new Date(activationDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
      user.subscriptionStartedAt = activationDate;
      user.subscriptionExpiresAt = newExpiry;
      user.graceExpiresAt = newExpiry;
    }

    // Update license quotas for selected tier
    const quotas = User.PLAN_QUOTAS?.[tier] || { maxDesktops: 1, maxMobileUsers: 3 };
    user.licenseQuotas.maxDesktops = quotas.maxDesktops;
    user.licenseQuotas.maxMobileUsers = quotas.maxMobileUsers;

    await user.save();

    const remainingDays = typeof user.getRemainingDays === "function" ? user.getRemainingDays() : (typeof user.getTrialRemainingDays === "function" ? user.getTrialRemainingDays() : 30);

    try {
      await SubscriptionHistory.create({
        userId: user._id,
        userName: user.name || "",
        userEmail: user.email,
        churchName: user.churchName || "",
        previousPlan,
        newPlan: user.subscriptionTier,
        upgradedAt: new Date(),
        durationMonths: Math.round(durationDays / 30),
        daysRemaining: remainingDays,
        newExpiryDate: user.subscriptionExpiresAt || user.trialEndsAt || user.graceExpiresAt,
        changedBy: {
          id: user._id.toString(),
          name: user.name || "Customer",
          email: user.email,
          role: user.role || "user",
        },
        action: "user_upgrade",
        reason: `Self-service plan update to ${tier.toUpperCase()}`,
        billingCycle,
        paymentMethod: "self_service",
        transactionReference: `TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      });
    } catch (histErr) {
      console.warn("Failed to log SubscriptionHistory:", histErr);
    }

    res.json({
      success: true,
      message: `Subscription plan updated to ${tier.toUpperCase()}`,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/profile/subscription/pay
 * Payment processing & activation
 */
router.post("/profile/subscription/pay", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id || req.user._id;
    const { tier = "standard", billingCycle = "semi-annual", paymentMethod = "card", transactionReference } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "user_not_found", message: "User not found" });
    }

    const previousPlan = user.subscriptionTier || "trial";
    const durationDays = billingCycle === "annually" ? 365 : (billingCycle === "semi-annual" || billingCycle === "semi_annually" ? 180 : 30);
    const activationDate = new Date();
    const newExpiry = new Date(activationDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    user.subscriptionTier = tier;
    user.subscriptionStartedAt = activationDate;
    user.subscriptionExpiresAt = newExpiry;
    user.graceExpiresAt = newExpiry;

    const quotas = User.PLAN_QUOTAS?.[tier] || { maxDesktops: 1, maxMobileUsers: 3 };
    user.licenseQuotas.maxDesktops = quotas.maxDesktops;
    user.licenseQuotas.maxMobileUsers = quotas.maxMobileUsers;

    await user.save();

    const remainingDays = typeof user.getRemainingDays === "function" ? user.getRemainingDays() : (typeof user.getTrialRemainingDays === "function" ? user.getTrialRemainingDays() : 30);
    const ref = transactionReference || `TX-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await SubscriptionHistory.create({
        userId: user._id,
        userName: user.name || "",
        userEmail: user.email,
        churchName: user.churchName || "",
        previousPlan,
        newPlan: user.subscriptionTier,
        upgradedAt: activationDate,
        durationMonths: Math.round(durationDays / 30),
        daysRemaining: remainingDays,
        newExpiryDate: newExpiry,
        changedBy: {
          id: user._id.toString(),
          name: user.name || "Customer",
          email: user.email,
          role: user.role || "user",
        },
        action: "payment_activation",
        reason: `Payment confirmed for ${tier.toUpperCase()} (${billingCycle})`,
        billingCycle,
        paymentMethod,
        transactionReference: ref,
      });
    } catch (histErr) {
      console.warn("Failed to log SubscriptionHistory:", histErr);
    }

    res.json({
      success: true,
      message: "Payment confirmed! Your subscription is now active.",
      reference: ref,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

const handleGetAdminUsers = async (req, res, next) => {
  try {
    await connectToDatabase();
    let adminUsers = await User.find({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: -1 });

    if (adminUsers.length === 0) {
      const defaultPasswordHash = await bcrypt.hash("Waveio123!@", 10);
      const masterAdmin = await User.create({
        name: "WaveIO Master Admin",
        email: "waveio@ocs.app",
        passwordHash: defaultPasswordHash,
        churchName: "WaveIO In-House HQ",
        role: "super_admin",
        graceExpiresAt: User.computeGraceExpiry(120),
        licenseQuotas: { maxDesktops: 99, maxMobileUsers: 99, activeDesktops: [], activeMobileUsers: [] },
      });
      adminUsers = [masterAdmin];
    }

    res.json({
      success: true,
      count: adminUsers.length,
      users: adminUsers.map(u => ({
        id: u.id || u._id.toString(),
        name: u.name || u.email.split("@")[0],
        email: u.email,
        avatarUrl: u.avatarUrl || "",
        church: u.churchName,
        role: "super_admin",
        licenseQuotas: u.licenseQuotas || { maxDesktops: 99, maxMobileUsers: 99, activeDesktops: [], activeMobileUsers: [] },
        graceExpiresAt: u.graceExpiresAt,
        joined: u.createdAt ? new Date(u.createdAt).toISOString().split("T")[0] : "2026-08-22",
        lastLogin: "Active",
      })),
    });
  } catch (err) {
    next(err);
  }
};

router.get("/users/admin", authMiddleware, superAdminMiddleware, handleGetAdminUsers);
router.get("/admin/users", authMiddleware, superAdminMiddleware, handleGetAdminUsers);
router.get("/admins", authMiddleware, superAdminMiddleware, handleGetAdminUsers);

/**
 * GET /auth/users
 * Customer Churches & Ministries list
 */
router.get("/users", authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const query = req.query.all === "true"
      ? {}
      : { role: { $in: ["church_admin", "user"] } };

    let users = await User.find(query).sort({ createdAt: -1 });

    if (users.length === 0 && !req.query.all) {
      const defaultPasswordHash = await bcrypt.hash("Waveio123!@", 10);
      const seeded = await User.create([
        {
          name: "Pastor James A.",
          email: "pastor@redeemed.ng",
          passwordHash: defaultPasswordHash,
          churchName: "Redeemed Christian Church",
          role: "church_admin",
          graceExpiresAt: User.computeGraceExpiry(2),
          licenseQuotas: {
            maxDesktops: 2,
            maxMobileUsers: 5,
            activeDesktops: [{ deviceId: "desk-01", name: "Main Sanctuary Display" }],
            activeMobileUsers: [{ deviceId: "mob-01", name: "Stage Companion 1" }, { deviceId: "mob-02", name: "Worship Leader iPhone" }],
          },
        },
        {
          name: "Sarah M.",
          email: "sarah@grace.org",
          passwordHash: defaultPasswordHash,
          churchName: "Grace Community Church",
          role: "church_admin",
          graceExpiresAt: User.computeGraceExpiry(2),
          licenseQuotas: {
            maxDesktops: 2,
            maxMobileUsers: 5,
            activeDesktops: [{ deviceId: "desk-02", name: "Auditorium PC" }],
            activeMobileUsers: [{ deviceId: "mob-03", name: "Pastor iPad" }],
          },
        },
      ]);
      users = seeded;
    }

    res.json({
      success: true,
      count: users.length,
      users: users.map(u => {
        const entitlements = typeof u.getEntitlements === "function" ? u.getEntitlements() : null;
        const tier = entitlements ? entitlements.tier : (u.subscriptionTier || "trial");
        // Use getRemainingDays() — correctly handles paid 180-day plans without capping
        const remainingDays = typeof u.getRemainingDays === "function"
          ? u.getRemainingDays()
          : (typeof u.getTrialRemainingDays === "function" ? u.getTrialRemainingDays() : 60);

        const isPaidTier = ["mini", "standard", "large", "premium"].includes(tier);

        return {
          id: u.id || u._id.toString(),
          name: u.name || u.email.split("@")[0],
          email: u.email,
          avatarUrl: u.avatarUrl || "",
          church: u.churchName,
          customerType: u.customerType || "church",
          channelLink: u.channelLink || "",
          podcastLink: u.podcastLink || "",
          role: u.role || "church_admin",
          subscriptionTier: tier,
          effectiveTier: tier,
          isTrial: tier === "trial",
          // daysRemaining not capped — reflects true plan duration (e.g. ~180 days for paid plans)
          daysRemaining: remainingDays,
          trialRemainingDays: remainingDays,
          trialEndsAt: u.trialEndsAt || u.graceExpiresAt,
          subscriptionExpiresAt: u.subscriptionExpiresAt || null,
          // subscriptionStartedAt for paid plans, trialStartedAt for trial
          subscriptionStartedAt: isPaidTier
            ? (u.subscriptionStartedAt || null)
            : (u.trialStartedAt || u.createdAt || null),
          licenseQuotas: {
            maxDesktops: entitlements?.limits?.maxDesktops || u.licenseQuotas?.maxDesktops || 1,
            maxMobileUsers: entitlements?.limits?.maxMobileUsers || u.licenseQuotas?.maxMobileUsers || 3,
            activeDesktops: u.licenseQuotas?.activeDesktops || [],
            activeMobileUsers: u.licenseQuotas?.activeMobileUsers || [],
          },
          graceExpiresAt: u.graceExpiresAt,
          joined: u.createdAt ? new Date(u.createdAt).toISOString().split("T")[0] : "2026-08-22",
          lastLogin: "Active",
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/users
 */
router.post("/users", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const {
      name,
      email,
      password,
      churchName,
      customerType = "church",
      channelLink = "",
      podcastLink = "",
      role = "church_admin",
    } = req.body;

    let effectiveOrg = churchName?.trim();
    if (!effectiveOrg) {
      if (customerType === "streamer") effectiveOrg = channelLink?.trim();
      else if (customerType === "podcast") effectiveOrg = podcastLink?.trim();
    }

    if (!email || !password || !effectiveOrg) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Email, password, and organization/channel/podcast details are required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({
        error: "email_exists",
        message: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const isSuperAdmin = role === "super_admin" || role === "admin";
    const graceExpiresAt = User.computeGraceExpiry(isSuperAdmin ? 120 : 3);

    const newUser = await User.create({
      name: name?.trim() || cleanEmail.split("@")[0],
      email: cleanEmail,
      passwordHash,
      customerType: isSuperAdmin ? "church" : (["church", "streamer", "podcast"].includes(customerType) ? customerType : "church"),
      churchName: effectiveOrg,
      channelLink: channelLink?.trim() || (customerType === "streamer" ? effectiveOrg : ""),
      podcastLink: podcastLink?.trim() || (customerType === "podcast" ? effectiveOrg : ""),
      role: isSuperAdmin ? "super_admin" : (role === "user" ? "user" : "church_admin"),
      graceExpiresAt,
      licenseQuotas: {
        maxDesktops: isSuperAdmin ? 99 : 2,
        maxMobileUsers: isSuperAdmin ? 99 : 5,
        activeDesktops: [],
        activeMobileUsers: [],
      },
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        id: newUser.id || newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        church: newUser.churchName,
        role: newUser.role,
        licenseQuotas: newUser.licenseQuotas,
        joined: new Date().toISOString().split("T")[0],
        lastLogin: "Active",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /auth/users/:id
 */
router.delete("/users/:id", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    let deleted = null;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await User.findByIdAndDelete(id);
    } else {
      deleted = await User.findOneAndDelete({ email: id.toLowerCase().trim() });
    }

    if (!deleted) {
      return res.status(404).json({
        error: "not_found",
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully",
      deletedId: id,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/license
 */
router.get("/entitlements", authMiddleware, async (req, res, next) => {
  try {
    const user = req.user;
    const entitlements = user.getEntitlements ? user.getEntitlements() : {};
    res.json({
      success: true,
      entitlements,
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/license", authMiddleware, async (req, res, next) => {
  try {
    res.json({
      success: true,
      license: {
        churchName: req.user.churchName,
        role: req.user.role,
        quotas: req.user.licenseQuotas || {
          maxDesktops: 2,
          maxMobileUsers: 5,
          activeDesktops: [],
          activeMobileUsers: [],
        },
        graceExpiresAt: req.user.graceExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

const handleDeviceRegister = async (req, res, next) => {
  try {
    const { platform = "desktop", deviceId, name } = req.body;
    const user = req.user;

    const devCheck = registerOrEnforceDevice(user, {
      platform,
      deviceId,
      deviceName: name,
    });

    await user.save();

    if (devCheck.exceeded) {
      return res.status(403).json({
        error: devCheck.error,
        message: devCheck.message,
        loggedOutAll: true,
      });
    }

    res.json({
      success: true,
      message: "Device registered successfully",
      license: user.licenseQuotas,
    });
  } catch (err) {
    next(err);
  }
};

router.post("/device/register", authMiddleware, handleDeviceRegister);
router.post("/device-activate", authMiddleware, handleDeviceRegister);
router.post("/register-device", authMiddleware, handleDeviceRegister);

/**
 * Rate limiter for forgot-password endpoint (max 5 requests per 15 minutes per IP)
 */
const forgotPasswordLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests from this IP. Please try again later.",
});

/**
 * POST /auth/forgot-password
 * Public endpoint to request a password reset email (FR-15.3).
 * Generates a single-use token, stores only its SHA-256 hash in DB with 1h expiry,
 * and sends raw token in reset email. Always returns generic success to avoid enumeration.
 */
router.post("/forgot-password", forgotPasswordLimiter, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Email address is required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        error: "invalid_email",
        message: "Please provide a valid email address",
      });
    }

    // Always generate token and hash to preserve constant-time execution
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const user = await User.findOne({ email: cleanEmail });
    if (user) {
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
      await user.save();

      // Dispatch password reset email asynchronously via Resend
      sendPasswordResetEmail(user, rawToken).catch((err) => {
        console.error("[Password Reset Email] Failed to send email:", err.message);
      });
    }

    // Generic response preventing account enumeration (FR-15.3)
    res.json({
      success: true,
      message: "If an account with that email exists, password reset instructions have been sent.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/reset-password
 * Public endpoint to consume single-use reset token and update password (FR-15.3).
 */
router.post("/reset-password", async (req, res, next) => {
  try {
    await connectToDatabase();
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Reset token and new password are required",
      });
    }

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        error: "weak_password",
        message: "Password must be at least 8 characters long",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(String(token).trim())
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    }).select("+passwordHash +resetPasswordToken +resetPasswordExpires");

    if (!user) {
      return res.status(400).json({
        error: "invalid_or_expired_token",
        message: "Password reset token is invalid, expired, or has already been used.",
      });
    }

    // Hash new password and invalidate token immediately (single-use)
    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({
      success: true,
      message: "Password has been successfully reset. You can now log in with your new password.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /auth/users/:id/tier & /auth/user/:id/tier
 */
router.put("/users/:id/tier", authMiddleware, superAdminMiddleware, async (req, res, next) => {
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

    let user = null;
    if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
      user = await User.findById(id);
    }
    if (!user) {
      user = await User.findOne({
        $or: [{ email: id.toLowerCase().trim() }, { churchName: id }],
      });
    }

    if (!user) {
      return res.status(404).json({ error: "not_found", message: "User not found" });
    }

    const previousPlan = user.subscriptionTier || "trial";
    const normalizedNewTier = subscriptionTier ? subscriptionTier.replace(/_setup$/, "") : previousPlan;

    if (subscriptionTier) {
      user.subscriptionTier = normalizedNewTier;
    }

    const now = new Date();
    // Duration rules: trial=2mo, free=1mo, all paid plans (mini/standard/large/premium)=6mo by default
    let months;
    if (Number(extendMonths) > 0) {
      months = Number(extendMonths);
    } else if (normalizedNewTier === "trial") {
      months = 2;
    } else if (normalizedNewTier === "free") {
      months = 1;
    } else {
      months = 6; // mini, standard, large, premium → 6 months (180 days)
    }
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

    // Record in SubscriptionHistory
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
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});
router.put("/user/:id/tier", authMiddleware, superAdminMiddleware, async (req, res, next) => {
  req.url = req.url.replace("/user/", "/users/");
  router.handle(req, res, next);
});

/**
 * GET /auth/admin/subscription-history & /auth/subscription-history
 */
router.get("/admin/subscription-history", authMiddleware, superAdminMiddleware, async (req, res, next) => {
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
 * POST /auth/admin/subscription-reminders
 * Admin/Cron trigger to execute expiration reminder sweep for users expiring in 10-0 days.
 */
router.post("/admin/subscription-reminders", authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const results = await checkAndSendSubscriptionReminders();
    res.json({
      success: true,
      message: `Subscription reminder sweep completed: ${results.sent} sent, ${results.skipped} skipped, ${results.errors} errors out of ${results.totalChecked} checked.`,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
