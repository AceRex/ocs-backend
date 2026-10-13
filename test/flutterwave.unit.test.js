const { matchesPayment, validWebhook, paymentConfig } = require('../src/utils/flutterwave');
const payment = { reference: 'wave-reference', amount: 2000, currency: 'NGN' };
const transaction = { id: 42, status: 'successful', tx_ref: 'wave-reference', amount: 2000, currency: 'NGN', customer: { email: 'buyer@example.com' } };
describe('Flutterwave payment verification', () => {
  test('accepts a verified matching transaction', () => expect(matchesPayment(transaction, payment, 'buyer@example.com', 42)).toBe(true));
  test.each([
    ['status', 'failed'], ['tx_ref', 'attacker-reference'], ['currency', 'USD'],
    ['amount', 1], ['amount', 'NaN'], ['id', 99], ['customer', { email: 'attacker@example.com' }],
  ])('rejects mismatched %s', (field, value) => expect(matchesPayment({ ...transaction, [field]: value }, payment, 'buyer@example.com', 42)).toBe(false));
  test('requires configured prices and currency', () => {
    delete process.env.FLW_SECRET_KEY;
    expect(() => paymentConfig('standard', 'monthly')).toThrow('not configured');
    expect(() => paymentConfig('standard', 'invalid')).toThrow('Invalid');
  });
  test('authenticates webhooks and rejects missing or wrong hashes', () => {
    process.env.FLW_WEBHOOK_SECRET = 'server-secret';
    expect(validWebhook('server-secret')).toBe(true);
    expect(validWebhook('attacker')).toBe(false);
    expect(validWebhook(undefined)).toBe(false);
    delete process.env.FLW_WEBHOOK_SECRET;
    expect(validWebhook('')).toBe(false);
  });
});
