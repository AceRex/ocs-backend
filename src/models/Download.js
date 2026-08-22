const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    churchName: {
      type: String,
      trim: true,
      default: null,
    },
    platform: {
      type: String,
      required: true,
      enum: ['macos', 'windows', 'android', 'ios'],
      index: true,
    },
    appVersion: {
      type: String,
      required: true,
    },
    ipCountry: {
      type: String,
      default: 'UNKNOWN',
      index: true,
    },
    referrer: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
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

const Download =
  mongoose.models.Download || mongoose.model('Download', downloadSchema);

module.exports = Download;
