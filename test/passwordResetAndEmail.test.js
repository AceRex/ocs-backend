require('./setup');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const app = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const emailService = require('../src/utils/emailService');
const { clearRateLimits } = require('../src/middleware/rateLimiter');

describe('Transactional Email & Password Reset (PRD v1.13 FR-15.1–FR-15.3)', () => {
  let sendEmailSpy;

  beforeEach(() => {
    clearRateLimits();
    sendEmailSpy = jest.spyOn(emailService, 'sendEmail');
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
    clearRateLimits();
  });

  describe('Task 1 & Task 2: Email Utility & Triggers (FR-15.1, FR-15.2)', () => {
    it('Trigger 1: sends notification to staff when new ticket is submitted (FR-15.2 item 1)', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          email: 'pastor@grace.org',
          subject: 'Screen projection issue',
          message: 'Speaker view disconnects after 30 minutes',
          priority: 'high',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(sendEmailSpy).toHaveBeenCalled();
      const lastCall = sendEmailSpy.mock.calls[sendEmailSpy.mock.calls.length - 1][0];
      expect(lastCall.subject).toContain('[New OCS Ticket]');
      expect(lastCall.subject).toContain('HIGH');
      expect(lastCall.html).toContain('pastor@grace.org');
    });

    it('Trigger 2: sends status notification to submitter when admin updates ticket status (FR-15.2 item 2)', async () => {
      // 1. Create a platform staff admin
      const admin = await User.create({
        name: 'Platform Staff Admin',
        email: 'staff_admin@churchocs.com',
        passwordHash: 'hash123',
        churchName: 'WaveIO In-House HQ',
        role: 'admin',
      });
      const { signToken } = require('../src/utils/jwt');
      const { token: adminToken } = signToken(admin);

      // 2. Create a ticket
      const ticket = await Ticket.create({
        email: 'worship_leader@bethel.org',
        subject: 'Song lyrics sync',
        message: 'Need help with chorus repeat',
        status: 'open',
        priority: 'normal',
      });

      sendEmailSpy.mockClear();

      // 3. Admin updates ticket status to resolved
      const patchRes = await request(app)
        .patch(`/api/admin/tickets/${ticket._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'resolved' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.ticket.status).toBe('resolved');

      expect(sendEmailSpy).toHaveBeenCalled();
      const statusEmailCall = sendEmailSpy.mock.calls.find(call => call[0].to === 'worship_leader@bethel.org');
      expect(statusEmailCall).toBeDefined();
      expect(statusEmailCall[0].subject).toContain('Ticket Status Updated');
      expect(statusEmailCall[0].html).toContain('RESOLVED');
    });

    it('Trigger 3: sends welcome email on new account signup (FR-15.2 item 3)', async () => {
      sendEmailSpy.mockClear();

      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'David Adeleke',
          email: 'david@faithchapel.com',
          password: 'Password123!',
          churchName: 'Faith Chapel',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      expect(sendEmailSpy).toHaveBeenCalled();
      const welcomeCall = sendEmailSpy.mock.calls.find(call => call[0].to === 'david@faithchapel.com');
      expect(welcomeCall).toBeDefined();
      expect(welcomeCall[0].subject).toContain('welcome to OCS');
      expect(welcomeCall[0].html).toContain('Hey David,');
      expect(welcomeCall[0].html).toContain('Oluwasegun');
      expect(welcomeCall[0].html).toContain('Founder, OCS');
      expect(welcomeCall[0].html).toContain('Open OCS');
    });
  });

  describe('Task 3: Password Reset Flow (FR-15.3)', () => {
    const testUser = {
      name: 'Pastor Thomas',
      email: 'thomas@gracecity.org',
      password: 'OldPassword123!',
      churchName: 'Grace City Church',
    };

    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(testUser);
      sendEmailSpy.mockClear();
    });

    it('POST /auth/forgot-password: sends reset email with valid 1h token without leaking raw token in DB or response', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: testUser.email });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('password reset instructions have been sent');
      expect(res.body.token).toBeUndefined(); // Raw token never returned in response (Guardrail)

      // Verify email was sent with a valid raw token
      expect(sendEmailSpy).toHaveBeenCalled();
      const emailCall = sendEmailSpy.mock.calls.find(call => call[0].to === testUser.email);
      expect(emailCall).toBeDefined();
      expect(emailCall[0].subject).toBe('Reset your password');
      expect(emailCall[0].html).toContain('Hey Thomas,');
      expect(emailCall[0].html).toContain('Reset Password');
      expect(emailCall[0].html).toContain('1 hour');
      expect(emailCall[0].html).toContain('/reset-password?token=');

      // Verify DB stores only the SHA-256 hash (never raw token) with 1h expiry
      const userInDb = await User.findOne({ email: testUser.email }).select('+resetPasswordToken +resetPasswordExpires');
      expect(userInDb.resetPasswordToken).toBeDefined();
      expect(userInDb.resetPasswordToken).toHaveLength(64); // SHA-256 hex string
      expect(userInDb.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    });

    it('POST /auth/forgot-password: returns generic 200 response for non-existent email (Anti-enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent_user_987@fakedomain.org' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('password reset instructions have been sent');
    });

    it('POST /auth/forgot-password: rejects missing or invalid email format with 400', async () => {
      const res1 = await request(app).post('/api/auth/forgot-password').send({});
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('missing_fields');

      const res2 = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('invalid_email');
    });

    it('Full Password Reset Lifecycle (Task 4): request -> reset -> login with new password -> fail with old', async () => {
      let capturedRawToken = null;
      sendEmailSpy.mockImplementation(async (options) => {
        const match = options.html && options.html.match(/token=([a-f0-9]+)/);
        if (match) {
          capturedRawToken = match[1];
        }
        return { success: true, messageId: 'test_msg_id' };
      });

      // 1. Request password reset
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: testUser.email });
      expect(forgotRes.status).toBe(200);
      expect(capturedRawToken).toBeTruthy();

      // 2. Consume reset token with new password
      const newPassword = 'BrandNewPassword2026!';
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: capturedRawToken,
          password: newPassword,
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);
      expect(resetRes.body.message).toContain('Password has been successfully reset');

      // 3. Confirm login works with new password
      const loginNewRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: newPassword,
        });
      expect(loginNewRes.status).toBe(200);
      expect(loginNewRes.body.token).toBeDefined();

      // 4. Confirm login FAILS with old password
      const loginOldRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });
      expect(loginOldRes.status).toBe(401);

      // 5. Confirm token CANNOT be reused a second time (single-use enforced)
      const reuseRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: capturedRawToken,
          password: 'AnotherPassword999!',
        });
      expect(reuseRes.status).toBe(400);
      expect(reuseRes.body.error).toBe('invalid_or_expired_token');
    });

    it('POST /auth/reset-password: rejects weak password (<8 characters) and missing fields', async () => {
      const res1 = await request(app).post('/api/auth/reset-password').send({ token: 'abc' });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('missing_fields');

      const res2 = await request(app).post('/api/auth/reset-password').send({ token: 'abc', password: 'short' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('weak_password');
    });

    it('POST /auth/reset-password: rejects expired token', async () => {
      const rawToken = 'expired_raw_token_value_sample_12345';
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      await User.findOneAndUpdate(
        { email: testUser.email },
        {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: new Date(Date.now() - 1000), // Expired 1 second ago
        }
      );

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: rawToken,
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_or_expired_token');
    });

    it('POST /auth/forgot-password: rate limiter triggers on 6th rapid attempt from same IP (Task 4)', async () => {
      // 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: testUser.email });
        expect(res.status).toBe(200);
      }

      // 6th request triggers rate limiter
      const blockedRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: testUser.email });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toBe('rate_limited');
      expect(blockedRes.body.message).toContain('Too many password reset requests');
    });
  });

  describe('Subscription Expiration Reminders (10 to 0 Days)', () => {
    it('sends 10-day reminder email matching registration.md template', async () => {
      sendEmailSpy.mockClear();

      const user10Days = await User.create({
        name: 'Johnson Mark',
        email: 'johnson@bethelchapel.org',
        passwordHash: 'hash123',
        churchName: 'Bethel Chapel',
        subscriptionTier: 'standard',
        subscriptionExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });

      const res = await emailService.sendSubscription10DaysReminderEmail(user10Days);
      expect(res.success).toBe(true);
      expect(sendEmailSpy).toHaveBeenCalled();

      const call = sendEmailSpy.mock.calls.find(c => c[0].to === user10Days.email);
      expect(call).toBeDefined();
      expect(call[0].subject).toBe('Your OCS subscription expires in 10 days');
      expect(call[0].html).toContain('Hey Johnson,');
      expect(call[0].html).toContain('OCS Standard subscription');
      expect(call[0].html).toContain('expire in <strong>10 days</strong>');
      expect(call[0].html).toContain('Manage Subscription');
      expect(call[0].html).toContain('The OCS Team');
    });

    it('sends urgent 5-to-0 days reminder email matching registration.md template', async () => {
      sendEmailSpy.mockClear();

      const user3Days = await User.create({
        name: 'Sarah Jenkins',
        email: 'sarah@glorytabernacle.com',
        passwordHash: 'hash123',
        churchName: 'Glory Tabernacle',
        subscriptionTier: 'large',
        subscriptionExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      const res = await emailService.sendSubscriptionUrgentReminderEmail(user3Days, 3);
      expect(res.success).toBe(true);
      expect(sendEmailSpy).toHaveBeenCalled();

      const call = sendEmailSpy.mock.calls.find(c => c[0].to === user3Days.email);
      expect(call).toBeDefined();
      expect(call[0].subject).toContain('Only 3 days left on your OCS subscription');
      expect(call[0].html).toContain('Hey Sarah,');
      expect(call[0].html).toContain('OCS Large subscription');
      expect(call[0].html).toContain('in just 3 days');
      expect(call[0].html).toContain('Renew Subscription');
      expect(call[0].html).toContain('The OCS Team');
    });

    it('sendSubscriptionReminderEmail routes appropriately for 10-day vs urgent <=5 day windows', async () => {
      sendEmailSpy.mockClear();

      const user10 = {
        name: 'Pastor Peter',
        email: 'peter@church.org',
        subscriptionTier: 'mini',
        subscriptionExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      };
      await emailService.sendSubscriptionReminderEmail(user10, 10);
      const call10 = sendEmailSpy.mock.calls.find(c => c[0].to === user10.email);
      expect(call10[0].subject).toContain('expires in 10 days');

      sendEmailSpy.mockClear();
      const user0 = {
        name: 'Pastor James',
        email: 'james@church.org',
        subscriptionTier: 'premium',
        subscriptionExpiresAt: new Date(),
      };
      await emailService.sendSubscriptionReminderEmail(user0, 0);
      const call0 = sendEmailSpy.mock.calls.find(c => c[0].to === user0.email);
      expect(call0[0].subject).toContain('expires today');
    });

    it('checkAndSendSubscriptionReminders executes sweep and handles admin trigger endpoint', async () => {
      sendEmailSpy.mockClear();

      // Create users with various expiration windows
      await User.create({
        name: 'Expiring In 8 Days',
        email: 'user_8days@church.org',
        passwordHash: 'hash123',
        churchName: 'Church 8',
        subscriptionTier: 'standard',
        subscriptionExpiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      });

      await User.create({
        name: 'Expiring In 2 Days',
        email: 'user_2days@church.org',
        passwordHash: 'hash123',
        churchName: 'Church 2',
        subscriptionTier: 'large',
        subscriptionExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });

      await User.create({
        name: 'Expiring In 30 Days (Not In Window)',
        email: 'user_30days@church.org',
        passwordHash: 'hash123',
        churchName: 'Church 30',
        subscriptionTier: 'standard',
        subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const { signToken } = require('../src/utils/jwt');
      const admin = await User.create({
        name: 'Platform Staff',
        email: 'staff_sweep@waveio.app',
        passwordHash: 'hash123',
        churchName: 'WaveIO HQ',
        role: 'admin',
      });
      const { token: adminToken } = signToken(admin);

      // Call admin trigger endpoint
      const res = await request(app)
        .post('/api/auth/admin/subscription-reminders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results.sent).toBeGreaterThanOrEqual(2);

      // Verify emails were dispatched to both users in the 10-0 days window
      const emailsSent = sendEmailSpy.mock.calls.map(c => c[0].to);
      expect(emailsSent).toContain('user_8days@church.org');
      expect(emailsSent).toContain('user_2days@church.org');
      expect(emailsSent).not.toContain('user_30days@church.org');
    });
  });

  describe('Task 5: Security Authorization Guard Regression (FR-13.14)', () => {
    it('rejects tier override from unauthenticated caller and regular admin', async () => {
      const { signToken } = require('../src/utils/jwt');
      const targetUser = await User.create({
        name: 'Target Church',
        email: 'target@church.org',
        passwordHash: 'hash123',
        churchName: 'Target Church',
        subscriptionTier: 'free',
      });

      const regularAdmin = await User.create({
        name: 'Regular Staff Admin',
        email: 'staff@waveio.app',
        passwordHash: 'hash123',
        churchName: 'WaveIO Support',
        role: 'admin', // regular admin, not super_admin
      });
      const { token: adminToken } = signToken(regularAdmin);

      const superAdmin = await User.create({
        name: 'Super Admin',
        email: 'super@waveio.app',
        passwordHash: 'hash123',
        churchName: 'WaveIO Ops',
        role: 'super_admin',
      });
      const { token: superAdminToken } = signToken(superAdmin);

      // 1. Unauthenticated request -> 401
      const unauthRes = await request(app)
        .put(`/api/auth/users/${targetUser._id}/tier`)
        .send({ subscriptionTier: 'premium' });
      expect(unauthRes.status).toBe(401);

      // 2. Regular admin -> 403 Forbidden (FR-13.14 requires super_admin)
      const forbiddenRes = await request(app)
        .put(`/api/auth/users/${targetUser._id}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subscriptionTier: 'premium' });
      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.body.error).toBe('forbidden');

      // 3. Super admin -> 200 OK
      const allowedRes = await request(app)
        .put(`/api/auth/users/${targetUser._id}/tier`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ subscriptionTier: 'premium' });
      expect(allowedRes.status).toBe(200);
      expect(allowedRes.body.user.subscriptionTier).toBe('premium');
    });
  });
});
