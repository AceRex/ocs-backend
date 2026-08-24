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
 * List suggestions with status, category, sorting, and pagination (default 10 per page)
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { status, category, search, sortBy = 'popular', limit = 10, page = 1 } = req.query;

    const query = { isPublic: { $ne: false } };
    if (status && status !== 'all') query.status = status;
    if (category && category !== 'all') query.category = category;
    if (search && String(search).trim()) {
      const regex = new RegExp(String(search).trim(), 'i');
      query.$or = [
        { title: regex },
        { description: regex },
        { church: regex },
        { name: regex },
      ];
    }

    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    let sortObj = { upvotes: -1, createdAt: -1 };
    if (sortBy === 'newest') {
      sortObj = { createdAt: -1 };
    } else if (sortBy === 'comments') {
      sortObj = { 'comments.0': -1, createdAt: -1 };
    } else if (sortBy === 'highest_upvotes') {
      sortObj = { upvotes: -1, downvotes: 1 };
    }

    const [suggestions, total] = await Promise.all([
      Suggestion.find(query).sort(sortObj).skip(skip).limit(parsedLimit).lean(),
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
    const { voterKey } = req.body || {};

    const updateOps = { $inc: { upvotes: 1 } };
    if (voterKey) {
      updateOps.$push = {
        voters: { voterKey: String(voterKey), voteType: 'up', createdAt: new Date() },
      };
    }

    const suggestion = await Suggestion.findByIdAndUpdate(
      id,
      updateOps,
      { new: true }
    );

    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    res.json({
      success: true,
      upvotes: suggestion.upvotes,
      downvotes: suggestion.downvotes || 0,
      suggestion,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /suggestions/:id/downvote
 * Downvote a suggestion
 */
router.post('/suggestions/:id/downvote', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { voterKey } = req.body || {};

    const updateOps = { $inc: { downvotes: 1 } };
    if (voterKey) {
      updateOps.$push = {
        voters: { voterKey: String(voterKey), voteType: 'down', createdAt: new Date() },
      };
    }

    const suggestion = await Suggestion.findByIdAndUpdate(
      id,
      updateOps,
      { new: true }
    );

    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    res.json({
      success: true,
      upvotes: suggestion.upvotes,
      downvotes: suggestion.downvotes || 0,
      suggestion,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /suggestions/:id/comments
 * Add a community comment to a feature idea / mini blog
 */
router.post('/suggestions/:id/comments', optionalAuthMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { name, email, church, content } = req.body;

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'missing_content', message: 'Comment content is required' });
    }

    const newComment = {
      commentId: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: (name || (req.user ? req.user.name : 'Church Volunteer')).trim(),
      email: (email || (req.user ? req.user.email : '')).trim(),
      church: (church || (req.user ? req.user.churchName : 'Ministry Partner')).trim(),
      content: String(content).trim(),
      createdAt: new Date(),
    };

    const suggestion = await Suggestion.findByIdAndUpdate(
      id,
      { $push: { comments: newComment } },
      { new: true }
    );

    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    emitAdminNotification({
      id: `sug-cm-${newComment.commentId}`,
      type: 'suggestion',
      title: `New Comment on: "${suggestion.title}"`,
      summary: `${newComment.name} (${newComment.church}): "${newComment.content.slice(0, 100)}..."`,
      category: 'Suggestion Discussion',
      status: suggestion.status,
      badge: 'Community Comment',
      timestamp: newComment.createdAt,
      targetUrl: '/admin/suggestions',
      isUnread: true,
    });

    res.status(201).json({
      success: true,
      message: 'Comment posted successfully',
      comment: newComment,
      comments: suggestion.comments,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /suggestions/:id/comments/:commentId
 * Admin deletes an inappropriate comment
 */
router.delete('/suggestions/:id/comments/:commentId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id, commentId } = req.params;

    const suggestion = await Suggestion.findByIdAndUpdate(
      id,
      { $pull: { comments: { commentId } } },
      { new: true }
    );

    if (!suggestion) {
      return res.status(404).json({ error: 'not_found', message: 'Suggestion not found' });
    }

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      comments: suggestion.comments,
    });
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

    const userEmail = (req.user?.email || '').toLowerCase();
    const userName = (req.user?.name || '').toLowerCase().replace(/\s+/g, '');
    const userHandle = userEmail.split('@')[0];

    const feed = notifications
      .filter((n) => {
        if (n.status === 'tagged' && n.metadata) {
          const authorEmail = (n.metadata.authorEmail || n.metadata.author || '').toLowerCase();
          const taggedList = (n.metadata.tagged || []).map((t) => String(t).toLowerCase());

          // If the requesting user is the author who created the tag note, do NOT send them this notification
          if (authorEmail && userEmail && authorEmail === userEmail) {
            return false;
          }

          // If the requesting user is NOT one of the tagged users, do NOT send them this notification
          const isMeTagged = taggedList.some((t) => t === userEmail || t === userName || t === userHandle);
          if (!isMeTagged) {
            return false;
          }
        }
        return true;
      })
      .map((n) => ({
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
        metadata: n.metadata || {},
      }));

    const userUnreadCount = feed.filter((n) => n.isUnread).length;

    res.json({
      success: true,
      counts: {
        totalUnread: userUnreadCount,
        unreadSuggestions: unreadSuggestionsCount,
        openTickets: openTicketsCount,
        totalSuggestions: recentSuggestions.length,
        totalTickets: recentTickets.length,
        totalNotifications: feed.length,
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
