const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
require('./setup');

describe('Rate Limiting & Security Gating', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send({
      email: 'testrate@church.org',
      password: 'CorrectPassword123!',
      churchName: 'Test Church',
    });
  });

  it('locks out login after 5 consecutive failed attempts', async () => {
    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testrate@church.org',
          password: `WrongPassword${i}!`,
        });

      if (i < 4) {
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('invalid_credentials');
      }
    }

    // 6th attempt should be blocked with 429 rate_limited
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testrate@church.org',
        password: 'CorrectPassword123!',
      })
      .expect(429);

    expect(blockedRes.body.error).toBe('rate_limited');
    expect(blockedRes.body.retryAfterSeconds).toBeGreaterThan(0);
  });
});
