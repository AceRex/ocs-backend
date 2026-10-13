const crypto = require('crypto');

function paymentConfig(tier, billingCycle) {
  if (!['mini', 'standard', 'large', 'premium'].includes(tier) || !['monthly', 'semi-annual', 'annually'].includes(billingCycle)) {
    throw Object.assign(new Error('Invalid plan or billing cycle'), { status: 400 });
  }
  const prices = JSON.parse(process.env.FLW_PLAN_PRICES || '{}');
  const amount = Number(prices[tier]?.[billingCycle]);
  const currency = process.env.FLW_CURRENCY;
  if (!process.env.FLW_SECRET_KEY || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency || '')) {
    throw Object.assign(new Error('Flutterwave payments are not configured'), { status: 503 });
  }
  return { amount, currency };
}

async function flutterwave(path, body) {
  const response = await fetch(`https://api.flutterwave.com/v3/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || result.status !== 'success' || !result.data) {
    throw Object.assign(new Error('Payment provider could not complete this request'), { status: 502 });
  }
  return result.data;
}

function matchesPayment(transaction, payment, _email, transactionId) {
  return transaction.status === 'successful'
    && String(transaction.id) === String(transactionId)
    && transaction.tx_ref === payment.reference
    && transaction.currency === payment.currency
    && Number.isFinite(Number(transaction.amount))
    && Number(transaction.amount) >= payment.amount;
}

function validWebhook(hash) {
  const secret = process.env.FLW_WEBHOOK_SECRET;
  if (!secret || typeof hash !== 'string') return false;
  const a = Buffer.from(hash); const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { paymentConfig, flutterwave, matchesPayment, validWebhook };
