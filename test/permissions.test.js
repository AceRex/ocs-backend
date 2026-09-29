const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');
const { signToken } = require('../src/utils/jwt');
require('./setup');

describe('Permissions Endpoints (/api/permissions)', () => {
  let userToken;

  beforeEach(async () => {
    const user = await User.create({
      email: 'member@church.org',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'Grace Church',
      role: 'user',
      graceExpiresAt: User.computeGraceExpiry(3),
    });
    userToken = signToken(user).token;
  });

  it('rejects unauthenticated GET /api/permissions with 401', async () => {
    const res = await request(app)
      .get('/api/permissions')
      .expect(401);

    expect(res.body.error).toBe('unauthorized');
  });

  it('allows authenticated GET /api/permissions with valid token', async () => {
    const res = await request(app)
      .get('/api/permissions')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.tiers)).toBe(true);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.tierFeatures).toBeDefined();
  });
});
