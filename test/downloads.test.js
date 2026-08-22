const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const bcrypt = require('bcryptjs');
const { signToken } = require('../src/utils/jwt');
require('./setup');

describe('Downloads Endpoints (/api/downloads & /api/admin/downloads)', () => {
  let adminToken;
  let userToken;

  beforeEach(async () => {
    // Create regular user
    const user = await User.create({
      email: 'user@church.org',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'First Church',
      role: 'user',
      graceExpiresAt: User.computeGraceExpiry(3),
    });
    userToken = signToken(user).token;

    // Create admin user
    const admin = await User.create({
      email: 'admin@churchocs.com',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'OCS Global Admin',
      role: 'admin',
      graceExpiresAt: User.computeGraceExpiry(12),
    });
    adminToken = signToken(admin).token;
  });

  describe('POST /api/downloads', () => {
    it('logs an anonymous download event with platform and version', async () => {
      const res = await request(app)
        .post('/api/downloads')
        .send({
          platform: 'macos',
          appVersion: '1.2.0',
          referrer: 'https://google.com',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('attaches user info when download request is authenticated', async () => {
      const res = await request(app)
        .post('/api/downloads')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          platform: 'windows',
          appVersion: '1.2.0',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('rejects invalid platform with 400', async () => {
      const res = await request(app)
        .post('/api/downloads')
        .send({
          platform: 'linux-unsupported',
          appVersion: '1.0.0',
        })
        .expect(400);

      expect(res.body.error).toBe('invalid_platform');
    });
  });

  describe('GET /api/admin/downloads', () => {
    beforeEach(async () => {
      // Seed a few downloads
      await request(app).post('/api/downloads').send({ platform: 'macos', appVersion: '1.0.0' });
      await request(app).post('/api/downloads').send({ platform: 'macos', appVersion: '1.1.0' });
      await request(app).post('/api/downloads').send({ platform: 'windows', appVersion: '1.0.0' });
    });

    it('allows admin to fetch downloads analytics with platform breakdown', async () => {
      const res = await request(app)
        .get('/api/admin/downloads')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.byPlatform.macos).toBe(2);
      expect(res.body.byPlatform.windows).toBe(1);
      expect(res.body.byPlatform.android).toBe(0);
      expect(Array.isArray(res.body.downloads)).toBe(true);
    });

    it('blocks regular user with 403 forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/downloads')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.error).toBe('forbidden');
    });

    it('blocks unauthenticated request with 401 unauthorized', async () => {
      const res = await request(app).get('/api/admin/downloads').expect(401);
      expect(res.body.error).toBe('unauthorized');
    });
  });
});
