const mongoose = require('mongoose');

const revokedTokenSchema = new mongoose.Schema(
  {
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      default: Date.now,
      // Automatically clean up expired revocations after 30 days
      expires: 30 * 24 * 60 * 60,
    },
  },
  {
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const RevokedToken =
  mongoose.models.RevokedToken ||
  mongoose.model('RevokedToken', revokedTokenSchema);

module.exports = RevokedToken;
