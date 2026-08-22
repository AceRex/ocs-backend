const request = require('supertest');
const app = require('../src/app');
require('./setup');

describe('CORS Configuration & Desktop App Headerless Requests', () => {
  it('allows direct desktop app requests without an Origin header', async () => {
    const res = await request(app)
      .post('/api/auth/validate-token')
      .send({ token: 'fake.token' });

    // Should not be rejected by CORS middleware
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('sets Access-Control-Allow-Origin for configured FRONTEND_URL', async () => {
    const res = await request(app)
      .options('/api/auth/validate-token')
      .set('Origin', 'https://churchocs.com')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe('https://churchocs.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
