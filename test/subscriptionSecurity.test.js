require('./setup');
const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');
describe('Subscription tampering', () => {
  let user, token;
  beforeEach(async () => {
    user = await User.create({ email: 'security@example.com', passwordHash: 'hash', churchName: 'Test' });
    token = signToken(user).token;
  });
  test('rejects fake payment references without granting a plan', async () => {
    await request(app).post('/api/auth/profile/subscription/pay').set('Authorization', `Bearer ${token}`)
      .send({ tier: 'premium', transactionReference: 'arbitrary-reference' }).expect(503);
    expect((await User.findById(user._id)).subscriptionTier).toBe('trial');
  });
  test('does not let users reset a trial', async () => {
    await request(app).post('/api/auth/profile/subscription/change').set('Authorization', `Bearer ${token}`)
      .send({ tier: 'trial' }).expect(403);
  });
  test('free downgrades preserve existing expiry', async () => {
    const expiry = user.graceExpiresAt.getTime();
    await request(app).post('/api/auth/profile/subscription/change').set('Authorization', `Bearer ${token}`)
      .send({ tier: 'free' }).expect(200);
    expect((await User.findById(user._id)).graceExpiresAt.getTime()).toBe(expiry);
  });
});
