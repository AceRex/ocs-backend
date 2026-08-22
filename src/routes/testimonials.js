const express = require('express');
const Testimonial = require('../models/Testimonial');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { rateLimiter } = require('../middleware/rateLimiter');
const { connectToDatabase } = require('../config/db');

const router = express.Router();

// Rate limiter for public testimonial submissions (max 10 per hour per IP)
const testimonialSubmitLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many testimonial submissions from this IP. Please try again later.',
});

/**
 * POST /testimonials
 * Public submission of a testimonial.
 * Always created with status: 'pending'.
 * Rate limited.
 */
router.post('/testimonials', testimonialSubmitLimiter, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { name, churchName, message, rating } = req.body;

    if (!name || !churchName || !message) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'Name, church name, and message are required',
      });
    }

    let parsedRating = null;
    if (rating !== undefined && rating !== null) {
      parsedRating = Number(rating);
      if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
        return res.status(400).json({
          error: 'invalid_rating',
          message: 'Rating must be a number between 1 and 5',
        });
      }
    }

    const testimonial = await Testimonial.create({
      name: String(name).trim(),
      churchName: String(churchName).trim(),
      message: String(message).trim(),
      rating: parsedRating,
      status: 'pending', // Strictly enforce pending
      submittedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Testimonial submitted successfully and is pending review',
      id: testimonial.id,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /testimonials
 * Public endpoint. Returns ONLY status: 'approved' testimonials.
 * Never leaks pending or rejected testimonials.
 */
router.get('/testimonials', async (req, res, next) => {
  try {
    await connectToDatabase();

    const { limit = 20, page = 1 } = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    // Filter strictly for approved status
    const filter = { status: 'approved' };

    const [testimonials, total] = await Promise.all([
      Testimonial.find(filter)
        .sort({ approvedAt: -1, submittedAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .select('name churchName message rating approvedAt'),
      Testimonial.countDocuments(filter),
    ]);

    res.json({
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
      testimonials,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/testimonials
 * Admin-only endpoint. Returns testimonials across all statuses (pending, approved, rejected).
 * Supports filtering by status.
 */
router.get(
  '/admin/testimonials',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { status, limit = 50, page = 1 } = req.query;
      const filter = {};

      if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        filter.status = status;
      }

      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
      const skip = (parsedPage - 1) * parsedLimit;

      const [testimonials, total] = await Promise.all([
        Testimonial.find(filter)
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(parsedLimit),
        Testimonial.countDocuments(filter),
      ]);

      const counts = await Testimonial.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);

      const byStatus = { pending: 0, approved: 0, rejected: 0 };
      counts.forEach((c) => {
        byStatus[c._id] = c.count;
      });

      res.json({
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        byStatus,
        testimonials,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /admin/testimonials/:id
 * Admin-only endpoint to approve or reject a testimonial.
 * Sets approvedAt when status is updated to 'approved'.
 */
router.patch(
  '/admin/testimonials/:id',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({
          error: 'invalid_status',
          message: 'Status must be one of: approved, rejected, pending',
        });
      }

      const updates = { status };
      if (status === 'approved') {
        updates.approvedAt = new Date();
      } else {
        updates.approvedAt = null;
      }

      const testimonial = await Testimonial.findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
      });

      if (!testimonial) {
        return res.status(404).json({
          error: 'not_found',
          message: 'Testimonial not found',
        });
      }

      res.json({
        success: true,
        message: `Testimonial marked as ${status}`,
        testimonial,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
