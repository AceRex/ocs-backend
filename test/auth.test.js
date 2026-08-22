const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const RevokedToken = require('../src/models/RevokedToken');
require('./setup');

describe('Auth Endpoints (/api/auth)', () => {
  const testUser = {
    email: 'pastor@gracechurch.org',
    password: 'SecurePassword123!',
    churchName: 'Grace Community Church',
  };

  describe('POST /api/auth/signup', () => {
    it('successfully signs up a new user, computes 3-month grace period, and returns JWT', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send(testUser)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.churchName).toBe(testUser.churchName);
      expect(res.body.user.role).toBe('church_admin');
      expect(res.body.user.passwordHash).toBeUndefined(); // Guardrail: never return hash

      // Verify graceExpiresAt is approx 3 months in future
      const graceDate = new Date(res.body.user.graceExpiresAt);
      const now = new Date();
      const diffMonths = (graceDate.getFullYear() - now.getFullYear()) * 12 + (graceDate.getMonth() - now.getMonth());
      expect(diffMonths).toBe(3);
    });

    it('rejects duplicate email with 409 email_exists', async () => {
      await request(app).post('/api/auth/signup').send(testUser).expect(201);

      const res = await request(app)
        .post('/api/auth/signup')
        .send(testUser)
        .expect(409);

      expect(res.body.error).toBe('email_exists');
    });

    it('rejects invalid email format with 400', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...testUser, email: 'not-an-email' })
        .expect(400);

      expect(res.body.error).toBe('invalid_email');
    });

    it('rejects weak password with 400', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...testUser, password: '123' })
        .expect(400);

      expect(res.body.error).toBe('weak_password');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(testUser);
    });

    it('successfully logs in with valid credentials and returns JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
    });

    it('rejects wrong password with 401 invalid_credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: 'WrongPassword999!' })
        .expect(401);

      expect(res.body.error).toBe('invalid_credentials');
    });

    it('blocks login with 403 trial_expired if graceExpiresAt has passed', async () => {
      // Artificially backdate graceExpiresAt in the database
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await User.updateOne({ email: testUser.email.toLowerCase() }, { graceExpiresAt: expiredDate });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(403);

      expect(res.body.error).toBe('trial_expired');
      expect(res.body.message).toMatch(/trial grace period has expired/i);
    });
  });

  describe('POST /api/auth/validate-token', () => {
    let validToken;

    beforeEach(async () => {
      const res = await request(app).post('/api/auth/signup').send(testUser);
      validToken = res.body.token;
    });

    it('validates active token successfully', async () => {
      const res = await request(app)
        .post('/api/auth/validate-token')
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
    });

    it('accepts token in Authorization header as well as body', async () => {
      const res = await request(app)
        .post('/api/auth/validate-token')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(res.body.valid).toBe(true);
    });

    it('returns valid: false, reason: trial_expired if user grace period expired after issuance', async () => {
      // Artificially expire the user
      const expiredDate = new Date(Date.now() - 1000);
      await User.updateOne({ email: testUser.email.toLowerCase() }, { graceExpiresAt: expiredDate });

      const res = await request(app)
        .post('/api/auth/validate-token')
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe('trial_expired');
    });

    it('returns valid: false, reason: token_revoked after token revocation', async () => {
      // Revoke the token
      await request(app)
        .post('/api/auth/revoke')
        .send({ token: validToken })
        .expect(200);

      // Validate again
      const res = await request(app)
        .post('/api/auth/validate-token')
        .send({ token: validToken })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe('token_revoked');
    });

    it('returns valid: false, reason: invalid_token for malformed token', async () => {
      const res = await request(app)
        .post('/api/auth/validate-token')
        .send({ token: 'malformed.fake.jwt' })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason).toBe('invalid_token');
    });
  });

  describe('GET /api/auth/me', () => {
    let token;

    beforeEach(async () => {
      const res = await request(app).post('/api/auth/signup').send(testUser);
      token = res.body.token;
    });

    it('returns user profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.churchName).toBe(testUser.churchName);
    });

    it('rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/auth/me').expect(401);
      expect(res.body.error).toBe('unauthorized');
    });
  });
});
