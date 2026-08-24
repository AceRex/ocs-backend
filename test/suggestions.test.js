const request = require('supertest');
const app = require('../src/app');
const Suggestion = require('../src/models/Suggestion');
const Ticket = require('../src/models/Ticket');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');
require('./setup');

describe('Suggestions & Admin Notification Feed API (/api/suggestions & /api/admin/notifications)', () => {
  describe('POST /api/suggestions', () => {
    it('creates a new feature suggestion', async () => {
      const res = await request(app)
        .post('/api/suggestions')
        .send({
          name: 'Pastor James',
          email: 'james@grace.org',
          church: 'Grace Sanctuary',
          category: 'Live Presentation & Projection',
          impact: 'critical',
          title: 'Independent Stage Timers',
          description: 'Allow pulpit timers to count down independently of main display.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.suggestionId).toMatch(/^SUG-\d+/);
      expect(res.body.suggestion.title).toBe('Independent Stage Timers');
    });

    it('rejects missing required fields with 400', async () => {
      const res = await request(app)
        .post('/api/suggestions')
        .send({ name: 'Incomplete' })
        .expect(400);

      expect(res.body.error).toBe('missing_fields');
    });
  });

  describe('GET /api/suggestions & Upvoting', () => {
    let suggestionId;

    beforeEach(async () => {
      const s = await Suggestion.create({
        name: 'Bro Luke',
        email: 'luke@test.org',
        title: 'Auto Scripture Translation',
        description: 'Auto translate scriptures in real time.',
      });
      suggestionId = s._id.toString();
    });

    it('returns list of suggestions', async () => {
      const res = await request(app).get('/api/suggestions').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.suggestions.length).toBeGreaterThanOrEqual(1);
    });

    it('increments upvotes on POST /api/suggestions/:id/upvote', async () => {
      const res = await request(app)
        .post(`/api/suggestions/${suggestionId}/upvote`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.upvotes).toBe(2);
    });
  });

  describe('GET /api/admin/notifications', () => {
    let adminToken;

    beforeEach(async () => {
      const adminUser = await User.create({
        name: 'Master Admin',
        email: `admin_${Date.now()}@ocs.app`,
        passwordHash: 'hash123',
        role: 'super_admin',
        churchName: 'HQ',
        graceExpiresAt: new Date(Date.now() + 86400000),
      });
      adminToken = signToken(adminUser).token;

      await Suggestion.create({
        name: 'Pastor Sarah',
        email: 'sarah@faith.org',
        title: 'Mobile Roster Sync',
        description: 'Sync weekly service roster to mobile app.',
        isReadByAdmin: false,
      });

      await Ticket.create({
        email: 'media@citychurch.org',
        subject: 'Display Aspect Ratio',
        message: 'Need 21:9 ultra-wide support.',
        status: 'open',
        priority: 'high',
      });
    });

    it('aggregates live notification feed for admin console', async () => {
      const res = await request(app)
        .get('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.counts.unreadSuggestions).toBeGreaterThanOrEqual(1);
      expect(res.body.counts.openTickets).toBeGreaterThanOrEqual(1);
      expect(res.body.feed.length).toBeGreaterThanOrEqual(2);

      const types = res.body.feed.map((f) => f.type);
      expect(types).toContain('suggestion');
      expect(types).toContain('complaint');
    });

    it('blocks unauthenticated access with 401', async () => {
      await request(app).get('/api/admin/notifications').expect(401);
    });
  });
});
