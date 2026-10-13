const jwt = require('jsonwebtoken');
describe('Local currency payment quotes', () => {
  let pricing, verifyQuote, spy;
  beforeEach(() => {
    jest.resetModules();
    ({ pricing, verifyQuote } = require('../src/utils/local-pricing'));
    process.env.FLW_SECRET_KEY = 'FLWSECK_TEST-example';
    process.env.FLW_CURRENCY = 'USD';
    process.env.FLW_PLAN_PRICES = JSON.stringify({ mini: { 'semi-annual': 2 } });
    spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'USD', time_last_update_unix: Math.floor(Date.now() / 1000), rates: { NGN: 1500.123, RWF: 1400.567 } }) });
  });
  afterEach(() => { spy.mockRestore(); delete process.env.FLW_SECRET_KEY; delete process.env.FLW_CURRENCY; delete process.env.FLW_PLAN_PRICES; });
  const req = country => ({ query: { country }, headers: {}, socket: {} });
  test('converts, rounds, caches rates, and locks the displayed NGN amount', async () => {
    const result = await pricing(req('NG'));
    expect(result.currency).toBe('NGN');
    expect(result.plans.mini['semi-annual']).toBe(3000.25);
    expect(verifyQuote(result.quotes.mini['semi-annual'], 'mini', 'semi-annual')).toEqual({ amount: 3000.25, currency: 'NGN' });
    await pricing(req('NG'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.plans.premium).toEqual({});
  });
  test('rounds zero-decimal currencies', async () => { expect((await pricing(req('RW'))).plans.mini['semi-annual']).toBe(2801); });
  test('unknown countries fall back to USD without fetching rates', async () => {
    expect((await pricing(req('ZZ'))).currency).toBe('USD'); expect(spy).not.toHaveBeenCalled();
  });
  test('rejects tampered, expired, wrong-plan, and changed-base-price quotes', async () => {
    const result = await pricing(req('NG'));
    const quote = result.quotes.mini['semi-annual'];
    expect(() => verifyQuote(quote.slice(0, -8) + 'attacker', 'mini', 'semi-annual')).toThrow('quote');
    expect(() => verifyQuote(quote, 'standard', 'semi-annual')).toThrow('quote');
    const decoded = jwt.decode(quote); delete decoded.exp; delete decoded.iat; delete decoded.aud;
    const expired = jwt.sign(decoded, process.env.JWT_SECRET, { expiresIn: -1, audience: 'payment-checkout' });
    expect(() => verifyQuote(expired, 'mini', 'semi-annual')).toThrow('quote');
    process.env.FLW_PLAN_PRICES = JSON.stringify({ mini: { 'semi-annual': 3 } });
    expect(() => verifyQuote(quote, 'mini', 'semi-annual')).toThrow('quote');
  });
  test('rejects stale or invalid exchange rates', async () => {
    spy.mockResolvedValue({ ok: true, json: async () => ({ result: 'success', base_code: 'USD', time_last_update_unix: 1, rates: { NGN: 1500 } }) });
    await expect(pricing(req('NG'))).rejects.toThrow('temporarily unavailable');
  });
});
