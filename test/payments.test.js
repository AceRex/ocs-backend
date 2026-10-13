require('./setup');
const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const Payment = require('../src/models/Payment');
const History = require('../src/models/SubscriptionHistory');
const { signToken } = require('../src/utils/jwt');
describe('Flutterwave checkout and atomic activation', () => {
  let user, token, reference, fetchSpy;
  beforeEach(async () => {
    process.env.FLW_SECRET_KEY = 'test-only-key';
    process.env.FLW_CURRENCY = 'NGN';
    process.env.FLW_PLAN_PRICES = JSON.stringify({ standard: { monthly: 2000 } });
    user = await User.create({ email: 'payer@example.com', passwordHash: 'hash', churchName: 'Test' });
    token = signToken(user).token;
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: { link: 'https://checkout.flutterwave.com/test' } }) });
    const checkout = await request(app).post('/api/payments/checkout').set('Authorization', `Bearer ${token}`)
      .send({ tier: 'standard', billingCycle: 'monthly', amount: 1 }).expect(200);
    reference = checkout.body.reference;
    expect((await Payment.findOne({ reference })).amount).toBe(2000);
  });
  afterEach(() => { fetchSpy.mockRestore(); delete process.env.FLW_SECRET_KEY; delete process.env.FLW_CURRENCY; delete process.env.FLW_PLAN_PRICES; });
  function provider(amount = 2000) {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: 'success', data: {
      id: 123, status: 'successful', tx_ref: reference, currency: 'NGN', amount, customer: { email: user.email },
    } }) });
  }
  test('underpayment does not grant a plan', async () => {
    provider(1);
    await request(app).post('/api/payments/verify').set('Authorization', `Bearer ${token}`)
      .send({ reference, transactionId: 123 }).expect(400);
    expect((await User.findById(user._id)).subscriptionTier).toBe('trial');
    expect((await Payment.findOne({ reference })).status).toBe('pending');
  });
  test('verified payments activate once even when callback is replayed', async () => {
    provider();
    const verify = () => request(app).post('/api/payments/verify').set('Authorization', `Bearer ${token}`).send({ reference, transactionId: 123 });
    await verify().expect(200);
    const paid = await User.findById(user._id);
    expect(paid.subscriptionTier).toBe('standard');
    await verify().expect(200);
    expect((await User.findById(user._id)).subscriptionExpiresAt.getTime()).toBe(paid.subscriptionExpiresAt.getTime());
    expect(await History.countDocuments({ transactionReference: reference })).toBe(1);
  });
  test('forged webhooks are rejected without provider calls', async () => {
    const calls = fetchSpy.mock.calls.length;
    await request(app).post('/api/payments/webhook').send({ event: 'charge.completed', data: { id: 123, tx_ref: reference } }).expect(401);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });
});
