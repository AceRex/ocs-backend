const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const RevokedToken = require("../src/models/RevokedToken");
const { signToken } = require("../src/utils/jwt");
require("./setup");

describe("Auth Endpoints (/api/auth)", () => {
  const testUser = {
    email: "pastor@gracechurch.org",
    password: "SecurePassword123!",
    churchName: "Grace Community Church",
  };

  describe("POST /api/auth/signup", () => {
    it("successfully signs up a new user with 2-month trial and Mini features", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send(testUser)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.churchName).toBe(testUser.churchName);
      expect(res.body.user.role).toBe("church_admin");
      expect(res.body.user.passwordHash).toBeUndefined();

      // Verify trial setup (2 months, 60 days, Mini features)
      expect(res.body.user.subscriptionTier).toBe("trial");
      expect(res.body.user.isTrial).toBe(true);
      expect(res.body.user.trialRemainingDays).toBe(60);
      expect(res.body.user.features).toContain("presentation.basic");
      expect(res.body.user.features).toContain("song.basic");
      expect(res.body.user.features).toContain("pdf.view");
      expect(res.body.user.licenseQuotas.maxDesktops).toBe(2);
      expect(res.body.user.licenseQuotas.maxMobileUsers).toBe(5);
    });

    it("accurately calculates 59-60 days left for user registered yesterday", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const user = await User.create({
        name: "Yesterday User",
        email: "yesterday@church.org",
        passwordHash: "hash123",
        churchName: "Yesterday Church",
        trialStartedAt: yesterday,
        createdAt: yesterday,
        // Legacy record that had setMonth(+2) resulting in 61/62 days
        trialEndsAt: new Date(yesterday.getTime() + 62 * 24 * 60 * 60 * 1000),
      });

      expect(user.getTrialRemainingDays()).toBe(59);
    });

    it("rejects duplicate email with 409 email_exists", async () => {
      await request(app).post("/api/auth/signup").send(testUser).expect(201);

      const res = await request(app)
        .post("/api/auth/signup")
        .send(testUser)
        .expect(409);

      expect(res.body.error).toBe("email_exists");
    });

    it("rejects invalid email format with 400", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({ ...testUser, email: "not-an-email" })
        .expect(400);

      expect(res.body.error).toBe("invalid_email");
    });

    it("rejects weak password with 400", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({ ...testUser, password: "123" })
        .expect(400);

      expect(res.body.error).toBe("weak_password");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/api/auth/signup").send(testUser);
    });

    it("successfully logs in with valid credentials and returns JWT with entitlements", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.subscriptionTier).toBe("trial");
      expect(res.body.user.features).toContain("timer.basic");
    });

    it("rejects wrong password with 401 invalid_credentials", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: "WrongPassword999!" })
        .expect(401);

      expect(res.body.error).toBe("invalid_credentials");
    });

    it("automatically downgrades to free tier with Timer & Broadcast only when trial expires", async () => {
      // Backdate trial
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await User.updateOne({ email: testUser.email.toLowerCase() }, { trialEndsAt: expiredDate, graceExpiresAt: expiredDate });

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.subscriptionTier).toBe("free");
      expect(res.body.user.isTrial).toBe(false);
      expect(res.body.user.isTrialExpired).toBe(true);
      expect(res.body.user.features).toEqual([
        "timer.basic",
        "broadcast.basic",
        "presentation.basic",
        "pdf.view",
        "scene.basic",
        "song.basic",
      ]);
      expect(res.body.user.licenseQuotas.maxDesktops).toBe(1);
      expect(res.body.user.licenseQuotas.maxMobileUsers).toBe(3);
    });
  });

  describe("POST /api/auth/validate-token", () => {
    let validToken;

    beforeEach(async () => {
      const res = await request(app).post("/api/auth/signup").send(testUser);
      validToken = res.body.token;
    });

    it("validates active token successfully and returns current entitlements", async () => {
      const res = await request(app)
        .post("/api/auth/validate-token")
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.subscriptionTier).toBe("trial");
    });

    it("accepts token in Authorization header as well as body", async () => {
      const res = await request(app)
        .post("/api/auth/validate-token")
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(res.body.valid).toBe(true);
    });

    it("returns valid: true with free tier when trial expires after token issuance", async () => {
      const expiredDate = new Date(Date.now() - 1000);
      await User.updateOne({ email: testUser.email.toLowerCase() }, { trialEndsAt: expiredDate, graceExpiresAt: expiredDate });

      const res = await request(app)
        .post("/api/auth/validate-token")
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.user.subscriptionTier).toBe("free");
      expect(res.body.user.features).toEqual([
        "timer.basic",
        "broadcast.basic",
        "presentation.basic",
        "pdf.view",
        "scene.basic",
        "song.basic",
      ]);
    });

    it("returns valid: false, reason: token_revoked after token revocation", async () => {
      await request(app)
        .post("/api/auth/revoke")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ token: validToken })
        .expect(200);

      const res = await request(app)
        .post("/api/auth/validate-token")
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe("token_revoked");
    });

    it("rejects token revocation if cryptographic signature is invalid or tampered", async () => {
      // Create a tampered token by modifying the signature
      const tamperedToken = validToken.slice(0, -5) + "XXXXX";
      const res = await request(app)
        .post("/api/auth/revoke")
        .send({ token: tamperedToken })
        .expect(401);

      expect(res.body.error).toBe("invalid_token");
      expect(res.body.message).toContain("cryptographic signature");
    });

    it("returns valid: false, reason: invalid_token for malformed token", async () => {
      const res = await request(app)
        .post("/api/auth/validate-token")
        .send({ token: "malformed.fake.jwt" })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe("invalid_token");
    });
  });

  describe("GET /api/auth/me & GET /api/auth/entitlements", () => {
    let token;

    beforeEach(async () => {
      const res = await request(app).post("/api/auth/signup").send(testUser);
      token = res.body.token;
    });

    it("returns user profile for authenticated user with active trial", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.churchName).toBe(testUser.churchName);
      expect(res.body.user.subscriptionTier).toBe("trial");
    });

    it("returns entitlement details on /api/auth/entitlements", async () => {
      const res = await request(app)
        .get("/api/auth/entitlements")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.entitlements.tier).toBe("trial");
      expect(res.body.entitlements.features).toContain("presentation.basic");
      expect(res.body.entitlements.limits.maxDesktops).toBe(2);
    });

    it("rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/auth/me").expect(401);
      expect(res.body.error).toBe("unauthorized");
    });
  });

  describe("POST /api/auth/guest-check (Hardware Anti-Tamper)", () => {
    const testMachineId = "hw_test_machine_uuid_abcdef123456";

    it("registers new machineId and grants 60-minute guest session", async () => {
      const res = await request(app)
        .post("/api/auth/guest-check")
        .send({ machineId: testMachineId, platform: "darwin" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.machineId).toBe(testMachineId);
      expect(res.body.isExpired).toBe(false);
      expect(res.body.remainingMinutes).toBe(60);
      expect(res.body.remainingSeconds).toBeGreaterThanOrEqual(3590);
    });

    it("persists device and maintains single countdown for subsequent checks", async () => {
      const res = await request(app)
        .post("/api/auth/guest-check")
        .send({ machineId: testMachineId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.isExpired).toBe(false);
    });

    it("flags machine as expired when 1 hour has elapsed", async () => {
      const GuestDevice = require("../src/models/GuestDevice");
      // Create backdated expired device record
      await GuestDevice.create({
        machineId: testMachineId,
        firstSeenAt: new Date(Date.now() - 3605000),
        guestExpiresAt: new Date(Date.now() - 5000),
      });

      const res = await request(app)
        .post("/api/auth/guest-check")
        .send({ machineId: testMachineId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.isExpired).toBe(true);
      expect(res.body.remainingSeconds).toBe(0);
      expect(res.body.remainingMinutes).toBe(0);
    });

    it("rejects missing or invalid machineId with 400", async () => {
      const res = await request(app)
        .post("/api/auth/guest-check")
        .send({ machineId: "short" })
        .expect(400);

      expect(res.body.error).toBe("invalid_machine_id");
    });
  });

  describe("Admin Login Access Control (/api/auth/admin/login)", () => {
    it("rejects customer accounts from logging in to admin console with 403 forbidden", async () => {
      await request(app).post("/api/auth/signup").send(testUser);

      const res = await request(app)
        .post("/api/auth/admin/login")
        .send({ email: testUser.email, password: testUser.password })
        .expect(403);

      expect(res.body.error).toBe("forbidden");
      expect(res.body.message).toContain("Customer accounts are not authorized");
    });

    it("rejects customer accounts when adminOnly flag is true on /api/auth/login", async () => {
      await request(app).post("/api/auth/signup").send(testUser);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: testUser.password, adminOnly: true })
        .expect(403);

      expect(res.body.error).toBe("forbidden");
      expect(res.body.message).toContain("Customer accounts are not authorized");
    });

    it("strictly rejects removed master backdoor credentials on admin login with 401 invalid_credentials", async () => {
      for (const email of ["waveio@ocs.app", "admin@waveio.app", "waveio"]) {
        const res = await request(app)
          .post("/api/auth/admin/login")
          .send({ email, password: "Waveio123!@" })
          .expect(401);
        expect(res.body.error).toBe("invalid_credentials");
      }
    });

    it("strictly rejects removed master backdoor credentials on customer login with 401 invalid_credentials", async () => {
      for (const email of ["waveio@ocs.app", "admin@waveio.app", "waveio"]) {
        const res = await request(app)
          .post("/api/auth/login")
          .send({ email, password: "Waveio123!@" })
          .expect(401);
        expect(res.body.error).toBe("invalid_credentials");
      }
    });

    it("allows legitimately seeded super_admin to log in to admin console successfully", async () => {
      const User = require("../src/models/User");
      const bcrypt = require("bcryptjs");
      const passwordHash = await bcrypt.hash("LegitAdminPass123!", 10);
      await User.create({
        name: "Legit Super Admin",
        email: "superadmin@churchocs.com",
        passwordHash,
        churchName: "Grace Church Global",
        role: "super_admin",
        graceExpiresAt: User.computeGraceExpiry(120),
      });

      const res = await request(app)
        .post("/api/auth/admin/login")
        .send({ email: "superadmin@churchocs.com", password: "LegitAdminPass123!" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe("super_admin");
      expect(res.body.token).toBeDefined();
    });
  });

  describe("Security Enhancements & Vulnerability Mitigations", () => {
    it("rejects Google SSO login with invalid/forged credential token", async () => {
      const res = await request(app)
        .post("/api/auth/google")
        .send({
          email: "victim@churchocs.com",
          credential: "forged.google.token",
        })
        .expect(401);

      expect(res.body.error).toBe("invalid_google_credential");
    });

    it("invalidates old tokens when password is changed", async () => {
      const User = require("../src/models/User");
      const bcrypt = require("bcryptjs");
      const user = await User.create({
        name: "Security Test User",
        email: "sectest@churchocs.com",
        passwordHash: await bcrypt.hash("OldPassword123!", 10),
        churchName: "Security Baptist",
        role: "user",
        graceExpiresAt: User.computeGraceExpiry(3),
      });

      const oldToken = signToken(user).token;

      // Verify old token works initially
      await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${oldToken}`)
        .expect(200);

      // Wait 1100ms to cross second boundary for JWT iat precision
      await new Promise((r) => setTimeout(r, 1100));

      // Change password
      const changeRes = await request(app)
        .post("/api/auth/profile/password")
        .set("Authorization", `Bearer ${oldToken}`)
        .send({
          currentPassword: "OldPassword123!",
          newPassword: "NewSecurePassword123!",
        })
        .expect(200);

      expect(changeRes.body.token).toBeDefined();
      const newToken = changeRes.body.token;

      // Old token must now be rejected as revoked
      const oldCheckRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${oldToken}`)
        .expect(401);

      expect(oldCheckRes.body.error).toBe("token_revoked");

      // New token must work
      await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${newToken}`)
        .expect(200);
    });

    it("rejects non-admin self-service upgrades to paid subscription tiers with 403 payment_required", async () => {
      const User = require("../src/models/User");
      const bcrypt = require("bcryptjs");
      const user = await User.create({
        name: "Regular User",
        email: "reguser@churchocs.com",
        passwordHash: await bcrypt.hash("UserPass123!", 10),
        churchName: "Regular Chapel",
        role: "user",
        subscriptionTier: "trial",
        graceExpiresAt: User.computeGraceExpiry(3),
      });

      const token = signToken(user).token;

      const res = await request(app)
        .post("/api/auth/profile/subscription/change")
        .set("Authorization", `Bearer ${token}`)
        .send({ tier: "premium" })
        .expect(403);

      expect(res.body.error).toBe("payment_required");
    });
  });
});
