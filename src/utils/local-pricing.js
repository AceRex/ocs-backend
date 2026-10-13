const jwt = require('jsonwebtoken');
const { paymentConfig } = require('./flutterwave');
const { resolveCountry } = require('./geoip');

const countries = { US: 'USD', NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', UG: 'UGX', TZ: 'TZS', RW: 'RWF', GB: 'GBP', CA: 'CAD', ZM: 'ZMW', EG: 'EGP', CM: 'XAF', SN: 'XOF', CI: 'XOF', FR: 'EUR', DE: 'EUR', IE: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', PT: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR' };
let cached, pending;
const unavailable = () => Object.assign(new Error('Local currency prices are temporarily unavailable. Please select USD or try again.'), { status: 503 });
async function rates() {
  if (cached && Date.now() - cached.fetchedAt < 3600000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    const updated = Number(data.time_last_update_unix) * 1000;
    if (!response.ok || data.result !== 'success' || data.base_code !== 'USD' || !Number.isFinite(updated) || Date.now() - updated > 48 * 3600000 || updated > Date.now() + 300000) throw unavailable();
    cached = { rates: data.rates, updated, fetchedAt: Date.now() };
    return cached;
  })().catch(() => { throw unavailable(); }).finally(() => { pending = undefined; });
  return pending;
}
function countryFor(req) {
  const requested = req.query.country;
  if (requested !== undefined && (typeof requested !== 'string' || !/^[A-Z]{2}$/.test(requested))) throw Object.assign(new Error('Invalid country'), { status: 400 });
  return requested || (process.env.VERCEL ? req.headers['x-vercel-ip-country'] : undefined) || resolveCountry(req);
}
function convert(amount, rate, currency) {
  if (!Number.isFinite(rate) || rate <= 0) throw unavailable();
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const converted = Math.round(amount * rate * 10 ** digits) / 10 ** digits;
  if (!Number.isFinite(converted) || converted <= 0) throw unavailable();
  return converted;
}
async function pricing(req) {
  const country = countryFor(req);
  const baseCurrency = process.env.FLW_CURRENCY || null;
  const currency = baseCurrency === 'USD' ? countries[country] || 'USD' : baseCurrency;
  const fx = currency && currency !== baseCurrency ? await rates() : null;
  const plans = {}, quotes = {};
  for (const tier of ['mini', 'standard', 'large', 'premium']) {
    plans[tier] = {}; quotes[tier] = {};
    for (const cycle of ['monthly', 'semi-annual', 'annually']) {
      let config;
      try { config = paymentConfig(tier, cycle); } catch (error) { if (error.status === 503) continue; throw error; }
      const amount = fx ? convert(config.amount, fx.rates?.[currency], currency) : config.amount;
      plans[tier][cycle] = amount;
      quotes[tier][cycle] = jwt.sign({ purpose: 'payment-quote', tier, cycle, country, currency, amount, baseAmount: config.amount, baseCurrency }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m', audience: 'payment-checkout' });
    }
  }
  return { country, currency, plans, quotes, rateUpdatedAt: fx ? new Date(fx.updated).toISOString() : null };
}
function verifyQuote(token, tier, cycle) {
  try {
    const quote = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], audience: 'payment-checkout' });
    const base = paymentConfig(tier, cycle);
    if (quote.purpose !== 'payment-quote' || quote.tier !== tier || quote.cycle !== cycle || quote.baseAmount !== base.amount || quote.baseCurrency !== base.currency || !Number.isFinite(quote.amount) || quote.amount <= 0 || ![base.currency, ...Object.values(countries)].includes(quote.currency)) throw new Error('Invalid quote');
    return { amount: quote.amount, currency: quote.currency };
  } catch (_) { throw Object.assign(new Error('Your price quote has expired or changed. Refresh prices and try again.'), { status: 409 }); }
}
module.exports = { pricing, verifyQuote, convert };
