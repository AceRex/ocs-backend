const express = require('express');
const Suggestion = require('../models/Suggestion');
const Ticket = require('../models/Ticket');
const Testimonial = require('../models/Testimonial');
const User = require('../models/User');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { rateLimiter } = require('../middleware/rateLimiter');
const { connectToDatabase } = require('../config/db');
const { emitAdminNotification } = require('../utils/socket');

const router = express.Router();

const suggestionSubmitLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many suggestions submitted from this IP. Please try again later.',
});

/**
 * POST /suggestions
 * Submit a new feature request or workflow idea
 */
router.post('/suggestions', suggestionSubmitLimiter, optionalAuthMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { name, email, church, category, impact, title, description } = req.body;

    if (!email || !title || !description) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'Email, title, and description are required',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'invalid_email',
        message: 'Please provide a valid email address',
      });
    }

    const suggestion = await Suggestion.create({
      userId: req.user ? req.user.id : null,
      name: (name || email.split('@')[0]).trim(),
      email: email.toLowerCase().trim(),
      church: (church || 'General Ministry').trim(),
      category: (category || 'Live Presentation & Projection').trim(),
      impact: ['nice_to_have', 'high_value', 'critical'].includes(impact) ? impact : 'high_value',
      title: title.trim(),
      description: description.trim(),
      status: 'under_review',
      isReadByAdmin: false,
    });

    emitAdminNotification({
      id: `sug-${suggestion._id}`,
      type: 'suggestion',
      title: `New Feature Idea: "${suggestion.title}"`,
      summary: `${suggestion.name} (${suggestion.church || 'Ministry'}) proposed: ${suggestion.description.slice(0, 100)}...`,
      category: suggestion.category,
      status: suggestion.status,
      badge: suggestion.impact === 'critical' ? 'Critical Impact' : 'Suggestion',
      timestamp: suggestion.createdAt,
      targetUrl: '/admin/suggestions',
      isUnread: true,
    });

    res.status(201).json({
      success: true,
      id: suggestion._id.toString(),
      suggestionId: suggestion.suggestionId,
      suggestion,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /suggestions
 * List suggestions with status, category, and search filters
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { status, category, search, limit = 50, page = 1 } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (category && category !== 'all') query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { church: { $regex: search, $options: 'i' } },
      ];
    }

    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [suggestions, total] = await Promise.all([
      Suggestion.find(query).sort({ upvotes: -1, createdAt: -1 }).skip(skip).limit(parsedLimit),
      Suggestion.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: suggestions.length,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
      suggestions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /suggestions/:id/upvote
 * Upvote a suggestion
 */
router.post('/suggestions/:id/upvote', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    const suggestion = await Suggestion.findByIdAndUpdate(
      id,
      { $inc: { upvotes: 1 } },
      { new: true }
    );

    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    res.json({ success: true, upvotes: suggestion.upvotes });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /suggestions/:id
 * Admin updates status or notes
 */
router.patch('/suggestions/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { status, adminNotes, isPublic, isReadByAdmin } = req.body;

    const updates = {};
    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (isPublic !== undefined) updates.isPublic = isPublic;
    if (isReadByAdmin !== undefined) updates.isReadByAdmin = isReadByAdmin;

    const suggestion = await Suggestion.findByIdAndUpdate(id, updates, { new: true });
    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    res.json({ success: true, suggestion });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /suggestions/:id
 * Admin deletes a suggestion
 */
router.delete('/suggestions/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const deleted = await Suggestion.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }
    res.json({ success: true, message: 'Suggestion deleted' });
  } catch (err) {
    next(err);
  }
});

const AdminNotification = require('../models/AdminNotification');

/**
 * GET /admin/notifications
 * Unified Live Monitoring & Notification Feed for Admin Panel:
 * Tracks new Suggestions, Testimonials, Support Tickets / Complaints, and Users.
 * Fully supports read/unread persistence and category filtering.
 */
router.get('/admin/notifications', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { type, isUnread, limit = 50 } = req.query;

    const [
      recentSuggestions,
      recentTickets,
      recentTestimonials,
      recentUsers,
    ] = await Promise.all([
      Suggestion.find().sort({ createdAt: -1 }).limit(20).lean(),
      Ticket.find().sort({ createdAt: -1 }).limit(20).lean(),
      Testimonial.find().sort({ createdAt: -1 }).limit(20).lean(),
      User.find().sort({ createdAt: -1 }).limit(20).select('name email churchName createdAt role').lean(),
    ]);

    // Backfill into AdminNotification collection if not already recorded
    const syncOps = [];

    for (const s of recentSuggestions) {
      syncOps.push(
        AdminNotification.updateOne(
          { notificationId: `sug-${s._id}` },
          {
            $setOnInsert: {
              notificationId: `sug-${s._id}`,
              type: 'suggestion',
              title: `New Feature Idea: "${s.title}"`,
              summary: `${s.name} (${s.church || 'Ministry'}) proposed: ${s.description.slice(0, 100)}...`,
              category: s.category || 'Feature Request',
              status: s.status || 'new',
              badge: s.impact === 'critical' ? 'Critical Impact' : 'Suggestion',
              timestamp: s.createdAt,
              targetUrl: '/admin/suggestions',
              isUnread: !s.isReadByAdmin,
              metadata: { suggestionId: s._id },
            },
          },
          { upsert: true }
        )
      );
    }

    for (const t of recentTickets) {
      syncOps.push(
        AdminNotification.updateOne(
          { notificationId: `ticket-${t._id}` },
          {
            $setOnInsert: {
              notificationId: `ticket-${t._id}`,
              type: 'complaint',
              title: `Support Ticket: "${t.subject}"`,
              summary: `From ${t.email} (${(t.priority || 'medium').toUpperCase()} Priority) — ${(t.message || '').slice(0, 100)}...`,
              category: t.category || 'Support',
              status: t.status || 'open',
              badge: t.priority === 'high' ? 'High Priority' : 'Support Ticket',
              timestamp: t.createdAt,
              targetUrl: '/admin/complaints',
              isUnread: t.status === 'open',
              metadata: { ticketId: t._id },
            },
          },
          { upsert: true }
        )
      );
    }

    for (const tm of recentTestimonials) {
      syncOps.push(
        AdminNotification.updateOne(
          { notificationId: `testim-${tm._id}` },
          {
            $setOnInsert: {
              notificationId: `testim-${tm._id}`,
              type: 'testimonial',
              title: `Church Testimonial: ${tm.author || tm.name || 'Pastor'}`,
              summary: `${tm.church || 'Church'}: "${(tm.quote || tm.content || tm.message || '').slice(0, 100)}..."`,
              category: 'Testimonials',
              status: 'received',
              badge: `${tm.stars || 5} Stars`,
              timestamp: tm.createdAt,
              targetUrl: '/admin/testimonials',
              isUnread: true,
              metadata: { testimonialId: tm._id },
            },
          },
          { upsert: true }
        )
      );
    }

    for (const u of recentUsers) {
      syncOps.push(
        AdminNotification.updateOne(
          { notificationId: `user-${u._id}` },
          {
            $setOnInsert: {
              notificationId: `user-${u._id}`,
              type: 'user',
              title: `New Registration: ${u.churchName || u.name}`,
              summary: `${u.name} (${u.email}) created an OCS account.`,
              category: 'Registration',
              status: u.role || 'church_admin',
              badge: 'New User',
              timestamp: u.createdAt,
              targetUrl: '/admin/users',
              isUnread: false,
              metadata: { userId: u._id },
            },
          },
          { upsert: true }
        )
      );
    }

    if (syncOps.length > 0) {
      await Promise.allSettled(syncOps);
    }

    // Build filter for notifications query
    const filter = { isArchived: { $ne: true } };
    if (type && type !== 'all') {
      filter.type = type;
    }
    if (isUnread === 'true') {
      filter.isUnread = true;
    } else if (isUnread === 'false') {
      filter.isUnread = false;
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    const [notifications, totalUnread, unreadSuggestionsCount, openTicketsCount] = await Promise.all([
      AdminNotification.find(filter)
        .sort({ timestamp: -1, createdAt: -1 })
        .limit(parsedLimit)
        .lean(),
      AdminNotification.countDocuments({ isArchived: { $ne: true }, isUnread: true }),
      Suggestion.countDocuments({ isReadByAdmin: false }),
      Ticket.countDocuments({ status: 'open' }),
    ]);

    const feed = notifications.map((n) => ({
      id: n.notificationId,
      type: n.type,
      title: n.title,
      summary: n.summary,
      category: n.category,
      status: n.status,
      badge: n.badge,
      timestamp: n.timestamp || n.createdAt,
      targetUrl: n.targetUrl,
      isUnread: n.isUnread,
    }));

    res.json({
      success: true,
      counts: {
        totalUnread,
        unreadSuggestions: unreadSuggestionsCount,
        openTickets: openTicketsCount,
        totalSuggestions: recentSuggestions.length,
        totalTickets: recentTickets.length,
        totalNotifications: notifications.length,
      },
      feed,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH & POST /admin/notifications/:id/read
 * Mark a single notification as read
 */
const markNotificationReadHandler = async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    const notif = await AdminNotification.findOneAndUpdate(
      { notificationId: id },
      { isUnread: false },
      { new: true }
    );

    // If it's a suggestion, sync isReadByAdmin on Suggestion
    if (id.startsWith('sug-')) {
      const sugId = id.replace('sug-', '');
      await Suggestion.findByIdAndUpdate(sugId, { isReadByAdmin: true }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification: notif,
    });
  } catch (err) {
    next(err);
  }
};

router.patch('/admin/notifications/:id/read', authMiddleware, adminMiddleware, markNotificationReadHandler);
router.post('/admin/notifications/:id/read', authMiddleware, adminMiddleware, markNotificationReadHandler);

/**
 * PATCH & POST /admin/notifications/:id/unread
 * Mark a single notification as unread
 */
const markNotificationUnreadHandler = async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    const notif = await AdminNotification.findOneAndUpdate(
      { notificationId: id },
      { isUnread: true },
      { new: true }
    );

    if (id.startsWith('sug-')) {
      const sugId = id.replace('sug-', '');
      await Suggestion.findByIdAndUpdate(sugId, { isReadByAdmin: false }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Notification marked as unread',
      notification: notif,
    });
  } catch (err) {
    next(err);
  }
};

router.patch('/admin/notifications/:id/unread', authMiddleware, adminMiddleware, markNotificationUnreadHandler);
router.post('/admin/notifications/:id/unread', authMiddleware, adminMiddleware, markNotificationUnreadHandler);

/**
 * PATCH & POST /admin/notifications/mark-all-read
 * Mark all notifications as read
 */
const markAllNotificationsReadHandler = async (req, res, next) => {
  try {
    await connectToDatabase();

    await Promise.all([
      AdminNotification.updateMany({ isArchived: { $ne: true } }, { isUnread: false }),
      Suggestion.updateMany({}, { isReadByAdmin: true }),
    ]);

    res.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (err) {
    next(err);
  }
};

router.patch('/admin/notifications/mark-all-read', authMiddleware, adminMiddleware, markAllNotificationsReadHandler);
router.post('/admin/notifications/mark-all-read', authMiddleware, adminMiddleware, markAllNotificationsReadHandler);

/**
 * DELETE /admin/notifications/:id
 * Delete or archive a single notification
 */
router.delete('/admin/notifications/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    await AdminNotification.findOneAndUpdate(
      { notificationId: id },
      { isArchived: true, isUnread: false }
    );

    res.json({
      success: true,
      message: 'Notification archived successfully',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/notifications/clear-read
 * Clear all read notifications
 */
router.delete('/admin/notifications/clear-read', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const result = await AdminNotification.updateMany(
      { isUnread: false },
      { isArchived: true }
    );

    res.json({
      success: true,
      message: 'All read notifications cleared',
      count: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
