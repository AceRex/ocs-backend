const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const Testimonial = require('../src/models/Testimonial');
const bcrypt = require('bcryptjs');
const { signToken } = require('../src/utils/jwt');
require('./setup');

describe('Testimonials Endpoints (/api/testimonials & /api/admin/testimonials)', () => {
  let adminToken;
  let userToken;

  beforeEach(async () => {
    const user = await User.create({
      email: 'user@church.org',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'First Church',
      role: 'user',
      graceExpiresAt: User.computeGraceExpiry(3),
    });
    userToken = signToken(user).token;

    const admin = await User.create({
      email: 'admin@churchocs.com',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'OCS Admin',
      role: 'admin',
      graceExpiresAt: User.computeGraceExpiry(12),
    });
    adminToken = signToken(admin).token;
  });

  describe('POST /api/testimonials', () => {
    it('creates a testimonial in pending status (never auto-approved)', async () => {
      const res = await request(app)
        .post('/api/testimonials')
        .send({
          name: 'Pastor David',
          churchName: 'Bethel Church',
          message: 'OCS transformed our Sunday service projection!',
          rating: 5,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();

      const saved = await Testimonial.findById(res.body.id);
      expect(saved.status).toBe('pending');
      expect(saved.approvedAt).toBeNull();
    });

    it('rejects missing fields with 400', async () => {
      const res = await request(app)
        .post('/api/testimonials')
        .send({ name: 'Pastor David' })
        .expect(400);

      expect(res.body.error).toBe('missing_fields');
    });

    it('rejects invalid rating outside 1-5 with 400', async () => {
      const res = await request(app)
        .post('/api/testimonials')
        .send({
          name: 'Pastor David',
          churchName: 'Bethel',
          message: 'Good app',
          rating: 10,
        })
        .expect(400);

      expect(res.body.error).toBe('invalid_rating');
    });
  });

  describe('GET /api/testimonials (Public)', () => {
    beforeEach(async () => {
      // Seed 1 pending, 1 rejected, 2 approved
      await Testimonial.create({
        name: 'Pending User',
        churchName: 'Church A',
        message: 'Pending message',
        status: 'pending',
      });
      await Testimonial.create({
        name: 'Rejected User',
        churchName: 'Church B',
        message: 'Spam message',
        status: 'rejected',
      });
      await Testimonial.create({
        name: 'Approved User 1',
        churchName: 'Church C',
        message: 'Approved message 1',
        status: 'approved',
        approvedAt: new Date(),
      });
      await Testimonial.create({
        name: 'Approved User 2',
        churchName: 'Church D',
        message: 'Approved message 2',
        status: 'approved',
        approvedAt: new Date(),
      });
    });

    it('returns ONLY approved testimonials and never leaks pending or rejected ones', async () => {
      const res = await request(app).get('/api/testimonials').expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.testimonials).toHaveLength(2);
      const names = res.body.testimonials.map((t) => t.name);
      expect(names).toContain('Approved User 1');
      expect(names).toContain('Approved User 2');
      expect(names).not.toContain('Pending User');
      expect(names).not.toContain('Rejected User');
    });
  });

  describe('Admin Testimonial Management', () => {
    let pendingId;

    beforeEach(async () => {
      const pending = await Testimonial.create({
        name: 'Review Candidate',
        churchName: 'Test Church',
        message: 'Please approve me',
        status: 'pending',
      });
      pendingId = pending.id;
    });

    it('allows admin to list all testimonials including pending/rejected', async () => {
      const res = await request(app)
        .get('/api/admin/testimonials')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.byStatus).toBeDefined();
    });

    it('allows admin to approve a testimonial and sets approvedAt', async () => {
      const res = await request(app)
        .patch(`/api/admin/testimonials/${pendingId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'approved' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.testimonial.status).toBe('approved');
      expect(res.body.testimonial.approvedAt).toBeDefined();

      // Now it shows up in public endpoint
      const publicRes = await request(app).get('/api/testimonials').expect(200);
      expect(publicRes.body.testimonials.some((t) => t.name === 'Review Candidate')).toBe(true);
    });

    it('blocks regular user from admin testimonials routes with 403', async () => {
      await request(app)
        .get('/api/admin/testimonials')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      await request(app)
        .patch(`/api/admin/testimonials/${pendingId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ status: 'approved' })
        .expect(403);
    });
  });
});
