const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RevokedToken = require("../models/RevokedToken");
const { signToken, verifyToken, decodeToken } = require("../utils/jwt");
const { authMiddleware } = require("../middleware/auth");
const { loginAttemptTracker } = require("../middleware/rateLimiter");
const { connectToDatabase } = require("../config/db");

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
    name: user.name,
    email: user.email,
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
    trialEndsAt: entitlements.trialEndsAt,
    trialRemainingDays: entitlements.trialRemainingDays,
    features: entitlements.features,
    licenseQuotas: {
      maxDesktops: entitlements.limits?.maxDesktops || 1,
      maxMobileUsers: entitlements.limits?.maxMobileUsers || 3,
      activeDesktops: user.licenseQuotas?.activeDesktops || [],
      activeMobileUsers: user.licenseQuotas?.activeMobileUsers || [],
    },
    entitlements,
    graceExpiresAt: user.graceExpiresAt || entitlements.trialEndsAt,
  };
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
    const graceExpiresAt = User.computeGraceExpiry(3);

    const trialEndsAt = User.computeTrialExpiry ? User.computeTrialExpiry(2) : User.computeGraceExpiry(2);
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

router.post("/register/admin", handleAdminRegister);
router.post("/admin/register", handleAdminRegister);

/**
 * POST /auth/login
 */
router.post("/login", async (req, res, next) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

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

    loginAttemptTracker.reset(req);
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
});

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

    res.status(200).json({
      valid: true,
      user: formatUserResponse(user),
      entitlements: user.getEntitlements ? user.getEntitlements() : undefined,
    });
  } catch (err) {
    res.status(200).json({ valid: false, reason: "invalid_token" });
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

router.get("/users/admin", handleGetAdminUsers);
router.get("/admin/users", handleGetAdminUsers);
router.get("/admins", handleGetAdminUsers);

/**
 * GET /auth/users
 * Customer Churches & Ministries list
 */
router.get("/users", async (req, res, next) => {
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
          graceExpiresAt: User.computeGraceExpiry(3),
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
          graceExpiresAt: User.computeGraceExpiry(3),
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
      users: users.map(u => ({
        id: u.id || u._id.toString(),
        name: u.name || u.email.split("@")[0],
        email: u.email,
        church: u.churchName,
        customerType: u.customerType || "church",
        channelLink: u.channelLink || "",
        podcastLink: u.podcastLink || "",
        role: u.role || "church_admin",
        licenseQuotas: u.licenseQuotas || { maxDesktops: 2, maxMobileUsers: 5, activeDesktops: [], activeMobileUsers: [] },
        graceExpiresAt: u.graceExpiresAt,
        joined: u.createdAt ? new Date(u.createdAt).toISOString().split("T")[0] : "2026-08-22",
        lastLogin: "Active",
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/users
 */
router.post("/users", async (req, res, next) => {
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
router.delete("/users/:id", async (req, res, next) => {
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

/**
 * POST /auth/device/register
 */
router.post("/device/register", authMiddleware, async (req, res, next) => {
  try {
    const { platform, deviceId, name } = req.body;

    if (!platform || !deviceId) {
      return res.status(400).json({
        error: "missing_device_info",
        message: "Platform (desktop/mobile) and deviceId are required",
      });
    }

    const user = req.user;
    const quotas = user.licenseQuotas || { maxDesktops: 2, maxMobileUsers: 5, activeDesktops: [], activeMobileUsers: [] };

    if (platform === "desktop") {
      const exists = quotas.activeDesktops.find(d => d.deviceId === deviceId);
      if (!exists) {
        if (quotas.activeDesktops.length >= (quotas.maxDesktops || 2)) {
          return res.status(403).json({
            error: "desktop_quota_exceeded",
            message: "Desktop device limit reached (Maximum 2 desktop apps per church license). Please unbind a previous station.",
          });
        }
        quotas.activeDesktops.push({
          deviceId,
          name: name || "Sanctuary Display Station",
          platform: "desktop",
          registeredAt: new Date(),
          lastActiveAt: new Date(),
        });
      } else {
        exists.lastActiveAt = new Date();
      }
    } else if (platform === "mobile") {
      const exists = quotas.activeMobileUsers.find(m => m.deviceId === deviceId);
      if (!exists) {
        if (quotas.activeMobileUsers.length >= (quotas.maxMobileUsers || 5)) {
          return res.status(403).json({
            error: "mobile_quota_exceeded",
            message: "Mobile companion limit reached (Maximum 5 mobile users per church license).",
          });
        }
        quotas.activeMobileUsers.push({
          deviceId,
          name: name || "Worship Stage Device",
          platform: "mobile",
          registeredAt: new Date(),
          lastActiveAt: new Date(),
        });
      } else {
        exists.lastActiveAt = new Date();
      }
    }

    user.licenseQuotas = quotas;
    await user.save();

    res.json({
      success: true,
      message: "Device registered successfully",
      license: user.licenseQuotas,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;


/**
 * PUT /auth/users/:id/tier & /auth/user/:id/tier
 */
router.put("/users/:id/tier", async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { subscriptionTier, extendMonths = 0 } = req.body;

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
      user: formatUserResponse(user),
    });
  } catch (err) {
    next(err);
  }
});
router.put("/user/:id/tier", async (req, res, next) => {
  req.url = req.url.replace("/user/", "/users/");
  router.handle(req, res, next);
});
