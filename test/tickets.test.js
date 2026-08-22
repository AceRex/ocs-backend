const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const Ticket = require('../src/models/Ticket');
const TicketNote = require('../src/models/TicketNote');
const bcrypt = require('bcryptjs');
const { signToken } = require('../src/utils/jwt');
require('./setup');

describe('Tickets Endpoints (/api/tickets & /api/admin/tickets)', () => {
  let adminToken;
  let userToken;
  let regularUserId;

  beforeEach(async () => {
    const user = await User.create({
      email: 'member@church.org',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'Grace Church',
      role: 'user',
      graceExpiresAt: User.computeGraceExpiry(3),
    });
    regularUserId = user.id;
    userToken = signToken(user).token;

    const admin = await User.create({
      email: 'admin@churchocs.com',
      passwordHash: await bcrypt.hash('pass123456', 10),
      churchName: 'OCS Support Admin',
      role: 'admin',
      graceExpiresAt: User.computeGraceExpiry(12),
    });
    adminToken = signToken(admin).token;
  });

  describe('POST /api/tickets', () => {
    it('allows anonymous ticket submission', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          email: 'anonymous@church.org',
          subject: 'Projection display issue',
          message: 'Output screen does not detect secondary HDMI monitor.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.ticket).toBeDefined();
      expect(res.body.ticket.status).toBe('open');

      const saved = await Ticket.findById(res.body.ticket.id);
      expect(saved.userId).toBeNull();
    });

    it('automatically attaches userId if request has valid auth token', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          email: 'member@church.org',
          subject: 'NDI streaming setup help',
          message: 'How do I output lower thirds over NDI?',
        })
        .expect(201);

      expect(res.body.success).toBe(true);

      const saved = await Ticket.findById(res.body.ticket.id);
      expect(saved.userId.toString()).toBe(regularUserId);
    });

    it('rejects invalid email with 400', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .send({
          email: 'not-an-email',
          subject: 'Help',
          message: 'Text',
        })
        .expect(400);

      expect(res.body.error).toBe('invalid_email');
    });
  });

  describe('Admin Ticket Management & Notes', () => {
    let ticketId;

    beforeEach(async () => {
      const ticket = await Ticket.create({
        email: 'help@church.org',
        subject: 'Can not connect companion app',
        message: 'QR code scans but pairing hangs.',
        status: 'open',
        priority: 'normal',
      });
      ticketId = ticket.id;
    });

    it('allows admin to list tickets sorted by most recent', async () => {
      const res = await request(app)
        .get('/api/admin/tickets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.tickets[0].subject).toBe('Can not connect companion app');
    });

    it('allows admin to add internal notes and view them in full detail', async () => {
      // Add internal note
      const noteRes = await request(app)
        .post(`/api/admin/tickets/${ticketId}/notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ note: 'Checked firewall logs; port 4000 was blocked on church subnet.' })
        .expect(201);

      expect(noteRes.body.success).toBe(true);
      expect(noteRes.body.note.note).toMatch(/port 4000 was blocked/i);

      // Get ticket detail
      const detailRes = await request(app)
        .get(`/api/admin/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(detailRes.body.ticket).toBeDefined();
      expect(detailRes.body.notes).toHaveLength(1);
      expect(detailRes.body.notes[0].note).toMatch(/port 4000 was blocked/i);
    });

    it('allows admin to update status and priority', async () => {
      const res = await request(app)
        .patch(`/api/admin/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'in_progress', priority: 'high' })
        .expect(200);

      expect(res.body.ticket.status).toBe('in_progress');
      expect(res.body.ticket.priority).toBe('high');
    });

    it('strictly blocks non-admin users from admin ticket endpoints', async () => {
      await request(app)
        .get('/api/admin/tickets')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      await request(app)
        .get(`/api/admin/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      await request(app)
        .post(`/api/admin/tickets/${ticketId}/notes`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ note: 'Malicious note attempt' })
        .expect(403);
    });
  });
});
