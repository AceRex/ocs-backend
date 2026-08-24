const express = require('express');
const Ticket = require('../models/Ticket');
const TicketNote = require('../models/TicketNote');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { rateLimiter } = require('../middleware/rateLimiter');
const { connectToDatabase } = require('../config/db');
const { sendTicketNotification, sendTicketStatusNotification } = require('../utils/mailer');
const { emitAdminNotification } = require('../utils/socket');

const router = express.Router();

// Rate limiter for ticket submissions (max 15 per hour per IP)
const ticketSubmitLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: 'Too many support tickets submitted from this IP. Please try again later.',
});

/**
 * POST /tickets
 * Public/User support ticket submission.
 * Attaches userId automatically if valid token provided, otherwise null.
 * Rate limited.
 */
router.post(
  '/tickets',
  ticketSubmitLimiter,
  optionalAuthMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { email, subject, message, priority } = req.body;

      if (!email || !subject || !message) {
        return res.status(400).json({
          error: 'missing_fields',
          message: 'Email, subject, and message are required',
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'invalid_email',
          message: 'Please provide a valid email address',
        });
      }

      let validPriority = 'normal';
      if (priority && ['low', 'normal', 'high'].includes(priority)) {
        validPriority = priority;
      }

      const ticket = await Ticket.create({
        userId: req.user ? req.user.id : null,
        email: String(email).toLowerCase().trim(),
        subject: String(subject).trim(),
        message: String(message).trim(),
        status: 'open',
        priority: validPriority,
      });

      // Dispatch real-time email notification to admins
      sendTicketNotification(ticket).catch((err) => {
        console.error('[Ticket Notification] Failed to send email:', err);
      });

      // Dispatch real-time WebSocket notification to Admin panel
      emitAdminNotification({
        id: `ticket-${ticket.id}`,
        type: 'complaint',
        title: `Support Ticket: "${ticket.subject}"`,
        summary: `From ${ticket.email} (${ticket.priority.toUpperCase()} Priority) — ${ticket.message.slice(0, 100)}...`,
        category: 'Support',
        status: ticket.status,
        badge: ticket.priority === 'high' ? 'High Priority' : 'Complaint / Support',
        timestamp: ticket.createdAt,
        targetUrl: '/admin/complaints',
        isUnread: true,
      });

      res.status(201).json({
        success: true,
        message: 'Support ticket submitted successfully',
        ticket: {
          id: ticket.id,
          email: ticket.email,
          subject: ticket.subject,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /tickets
 * Protected endpoint for authenticated users / admins.
 * - Admin: sees all tickets with optional filtering.
 * - User: sees only their own tickets (matching their userId or email).
 */
router.get('/tickets', authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { status, priority, limit = 50, page = 1 } = req.query;
    const filter = {};

    if (req.user.role !== 'admin') {
      filter.$or = [{ userId: req.user.id }, { email: req.user.email }];
    }

    if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
      filter.status = status;
    }
    if (priority && ['low', 'normal', 'high'].includes(priority)) {
      filter.priority = priority;
    }

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [tickets, total] = await Promise.all([
      Ticket.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .populate('userId', 'email churchName role'),
      Ticket.countDocuments(filter),
    ]);

    res.json({
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
      tickets,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/tickets
 * Admin-only list of support tickets with status & priority filtering.
 * Sorted by most recent first.
 */
router.get(
  '/admin/tickets',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { status, priority, limit = 50, page = 1 } = req.query;
      const filter = {};

      if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
        filter.status = status;
      }
      if (priority && ['low', 'normal', 'high'].includes(priority)) {
        filter.priority = priority;
      }

      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
      const skip = (parsedPage - 1) * parsedLimit;

      const [tickets, total] = await Promise.all([
        Ticket.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsedLimit)
          .populate('userId', 'email churchName role'),
        Ticket.countDocuments(filter),
      ]);

      const counts = await Ticket.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);

      const byStatus = { open: 0, in_progress: 0, resolved: 0 };
      counts.forEach((c) => {
        byStatus[c._id] = c.count;
      });

      res.json({
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        byStatus,
        tickets,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /admin/tickets/:id
 * Admin-only endpoint returning full ticket details including internal notes.
 */
router.get(
  '/admin/tickets/:id',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { id } = req.params;

      const ticket = await Ticket.findById(id).populate(
        'userId',
        'email churchName role'
      );
      if (!ticket) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Ticket not found',
        });
      }

      // Fetch all internal admin notes for this ticket
      const notes = await TicketNote.find({ ticketId: id }).sort({
        createdAt: 1,
      });

      res.json({
        ticket,
        notes,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /admin/tickets/:id
 * Admin-only endpoint to update ticket status or priority.
 */
router.patch(
  '/admin/tickets/:id',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { id } = req.params;
      const { status, priority } = req.body;

      const updates = {};
      if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
        updates.status = status;
      }
      if (priority && ['low', 'normal', 'high'].includes(priority)) {
        updates.priority = priority;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: 'invalid_update',
          message: 'Provide status or priority to update',
        });
      }

      const oldTicket = await Ticket.findById(id);
      if (!oldTicket) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Ticket not found',
        });
      }

      const statusChanged = status && status !== oldTicket.status;

      const ticket = await Ticket.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
      });

      if (statusChanged && ticket.email) {
        sendTicketStatusNotification(ticket, status).catch((err) => {
          console.error('[Ticket Status Notification] Failed to send email:', err);
        });
      }

      res.json({
        success: true,
        message: 'Ticket updated successfully',
        ticket,
      });
    } catch (err) {
      next(err);
    }
  }
);
router.patch('/tickets/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { status, priority } = req.body;
    const updates = {};
    if (status && ['open', 'in_progress', 'resolved'].includes(status)) updates.status = status;
    if (priority && ['low', 'normal', 'high'].includes(priority)) updates.priority = priority;

    const oldTicket = await Ticket.findById(id);
    if (!oldTicket) return res.status(404).json({ error: 'not_found', message: 'Ticket not found' });

    const ticket = await Ticket.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (status && status !== oldTicket.status && ticket.email) {
      sendTicketStatusNotification(ticket, status).catch(() => {});
    }
    res.json({ success: true, message: 'Ticket updated successfully', ticket });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/tickets/:id/notes
 * Admin-only endpoint to add an internal note.
 * Never exposed through any public endpoint.
 */
router.post(
  '/admin/tickets/:id/notes',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { id } = req.params;
      const { note } = req.body;

      if (!note || !String(note).trim()) {
        return res.status(400).json({
          error: 'missing_note',
          message: 'Note content is required',
        });
      }

      const ticket = await Ticket.findById(id);
      if (!ticket) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Ticket not found',
        });
      }

      const ticketNote = await TicketNote.create({
        ticketId: id,
        note: String(note).trim(),
      });

      res.status(201).json({
        success: true,
        message: 'Internal note added successfully',
        note: ticketNote,
      });
    } catch (err) {
      next(err);
    }
  }
);
router.post('/tickets/:id/notes', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;
    const { note } = req.body;
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'missing_note', message: 'Note is required' });
    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ error: 'not_found', message: 'Ticket not found' });
    const ticketNote = await TicketNote.create({ ticketId: id, note: String(note).trim() });
    res.status(201).json({ success: true, message: 'Internal note added successfully', note: ticketNote });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
