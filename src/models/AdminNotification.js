const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['complaint', 'suggestion', 'download', 'testimonial', 'user', 'system'],
      default: 'system',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
    },
    status: {
      type: String,
      default: 'new',
    },
    badge: {
      type: String,
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    targetUrl: {
      type: String,
      default: '/admin/notifications',
    },
    isUnread: {
      type: Boolean,
      default: true,
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const AdminNotification =
  mongoose.models.AdminNotification ||
  mongoose.model('AdminNotification', adminNotificationSchema);

module.exports = AdminNotification;
