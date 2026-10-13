const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tier: { type: String, required: true },
  billingCycle: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  transactionId: { type: String, unique: true, sparse: true },
  paidAt: Date,
}, { timestamps: true });
module.exports = mongoose.model('Payment', schema);
