const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const Payment = require('../models/Payment');
const User = require('../models/User');
const SubscriptionHistory = require('../models/SubscriptionHistory');
const { connectToDatabase } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { paymentConfig, flutterwave, matchesPayment, validWebhook } = require('../utils/flutterwave');
const { pricing, verifyQuote } = require('../utils/local-pricing');
const router = express.Router();
const limiter = rateLimiter({ max: 20 });

// Expired customers must be able to purchase a renewal; token revocation and
// account identity are still checked by the same authentication middleware.
function paymentAuth(req, res, next) {
  req.allowExpiredSubscription = true;
  return authMiddleware(req, res, next);
}

async function activate(reference, transactionId, owner) {
  await connectToDatabase();
  if (!/^\d+$/.test(String(transactionId))) throw Object.assign(new Error('Invalid transaction ID'), { status: 400 });
  if (typeof reference !== 'string' || !reference.startsWith('wave-')) throw Object.assign(new Error('Invalid payment reference'), { status: 400 });
  const payment = await Payment.findOne({ reference, ...(owner ? { userId: owner } : {}) });
  if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404 });
  const user = await User.findById(payment.userId);
  if (!user) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (!process.env.FLW_SECRET_KEY) throw Object.assign(new Error('Payments are not configured'), { status: 503 });
  const verified = await flutterwave(`transactions/${transactionId}/verify`);
  if (!matchesPayment(verified, payment, user.email, transactionId)) throw Object.assign(new Error('Payment has not been verified'), { status: 400 });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const claim = await Payment.findOneAndUpdate({ _id: payment._id, status: 'pending' },
        { $set: { status: 'paid', transactionId: String(transactionId), paidAt: new Date() } }, { session, new: true });
      if (!claim) return; // Successful webhook or callback already applied this payment.
      const account = await User.findById(payment.userId).session(session);
      if (!account) throw new Error('Account was removed');
      const previousPlan = account.subscriptionTier;
      const now = new Date();
      const days = { monthly: 30, 'semi-annual': 180, annually: 365 }[payment.billingCycle];
      account.subscriptionTier = payment.tier;
      account.subscriptionStartedAt = now;
      const start = previousPlan === payment.tier ? Math.max(now.getTime(), account.subscriptionExpiresAt?.getTime() || 0) : now.getTime();
      account.subscriptionExpiresAt = new Date(start + days * 86400000);
      account.graceExpiresAt = account.subscriptionExpiresAt;
      const quotas = User.PLAN_QUOTAS[payment.tier];
      account.licenseQuotas.maxDesktops = quotas.maxDesktops;
      account.licenseQuotas.maxMobileUsers = quotas.maxMobileUsers;
      await account.save({ session });
      await SubscriptionHistory.create([{
        userId: account._id, userName: account.name || '', userEmail: account.email,
        churchName: account.churchName || '', previousPlan, newPlan: payment.tier,
        upgradedAt: now, durationMonths: days / 30, daysRemaining: days,
        newExpiryDate: account.subscriptionExpiresAt,
        changedBy: { id: account.id, email: account.email, role: account.role },
        action: 'payment_activation', reason: 'Verified Flutterwave payment',
        billingCycle: payment.billingCycle, paymentMethod: 'flutterwave', transactionReference: reference,
      }], { session });
    });
  } finally { await session.endSession(); }
  return { success: true, reference };
}

router.get('/payments/pricing', async (req, res, next) => {
  try { res.json(await pricing(req)); } catch (err) { next(err); }
});

router.post('/payments/checkout', limiter, paymentAuth, async (req, res, next) => {
  try {
    const { tier, billingCycle = 'monthly' } = req.body;
    const { amount, currency } = req.body.quote ? verifyQuote(req.body.quote, tier, billingCycle) : paymentConfig(tier, billingCycle);
    const redirect = new URL('/profile', env.FRONTEND_URL);
    if (redirect.protocol !== 'https:') throw Object.assign(new Error('Checkout requires a public HTTPS frontend'), { status: 503 });
    await connectToDatabase();
    await Payment.init(); // Ensure replay protection indexes exist before accepting money.
    const reference = `wave-${crypto.randomUUID()}`;
    await Payment.create({ reference, userId: req.user._id, tier, billingCycle, amount, currency });
    const checkout = await flutterwave('payments', {
      tx_ref: reference, amount, currency, redirect_url: redirect.href,
      customer: { email: req.user.email, name: req.user.name || req.user.email },
      customizations: { title: 'wave.io subscription' },
    });
    const url = new URL(checkout.link);
    if (url.protocol !== 'https:' || !['checkout.flutterwave.com', ...(process.env.FLW_SECRET_KEY?.startsWith('FLWSECK_TEST-') ? ['checkout-v2.dev-flutterwave.com'] : [])].includes(url.hostname)) throw new Error('Invalid checkout URL');
    res.json({ success: true, checkoutUrl: url.href, reference });
  } catch (err) { next(err); }
});

router.post('/payments/verify', limiter, paymentAuth, async (req, res, next) => {
  try { res.json(await activate(req.body.reference, req.body.transactionId, req.user._id)); }
  catch (err) { next(err); }
});

// Flutterwave v3 Standard webhook authentication (verif-hash).
router.post('/payments/webhook', async (req, res, next) => {
  if (!validWebhook(req.headers['verif-hash'])) return res.status(401).json({ error: 'invalid_webhook' });
  if (req.body.event !== 'charge.completed') return res.json({ success: true });
  try { res.json(await activate(req.body.data?.tx_ref, req.body.data?.id)); }
  catch (err) { next(err); }
});
module.exports = router;
