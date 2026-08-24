const express = require('express');
const Download = require('../models/Download');
const { resolveCountry } = require('../utils/geoip');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const { connectToDatabase } = require('../config/db');
const { emitAdminNotification, emitAdminMetrics } = require('../utils/socket');

const router = express.Router();

/**
 * POST /downloads
 * Public endpoint to log download events.
 * Accepts optional email/churchName, platform, appVersion, referrer.
 * Derives country server-side from IP address.
 */
router.post('/downloads', optionalAuthMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { platform, appVersion, email, churchName, referrer } = req.body;

    if (!platform || !appVersion) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'Platform and appVersion are required',
      });
    }

    const validPlatforms = ['macos', 'windows', 'android', 'ios'];
    if (!validPlatforms.includes(platform.toLowerCase())) {
      return res.status(400).json({
        error: 'invalid_platform',
        message: `Platform must be one of: ${validPlatforms.join(', ')}`,
      });
    }

    // Resolve IP country server-side
    const ipCountry = resolveCountry(req);

    const download = await Download.create({
      userId: req.user ? req.user.id : null,
      email: email || (req.user ? req.user.email : null),
      churchName: churchName || (req.user ? req.user.churchName : null),
      platform: platform.toLowerCase(),
      appVersion: String(appVersion).trim(),
      ipCountry,
      referrer: referrer ? String(referrer).trim() : null,
    });

    emitAdminNotification({
      id: `dl-${download.id}`,
      type: 'download',
      title: `App Download: ${platform.toUpperCase()} (v${appVersion})`,
      summary: `${email || churchName || 'A user'} downloaded OCS for ${platform.toUpperCase()}${ipCountry ? ` from ${ipCountry}` : ''}.`,
      category: 'Downloads',
      status: 'completed',
      badge: platform.toUpperCase(),
      timestamp: download.createdAt,
      targetUrl: '/admin/downloads',
      isUnread: true,
    });

    emitAdminMetrics({ type: 'download:created', platform: platform.toLowerCase() });

    res.status(201).json({
      success: true,
      message: 'Download logged successfully',
      id: download.id,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/downloads
 * Admin-only endpoint for download analytics and metrics.
 * Supports filtering by platform, startDate, endDate.
 * Returns totals by platform, totals by country, and timeline aggregates.
 */
router.get(
  '/admin/downloads',
  authMiddleware,
  adminMiddleware,
  async (req, res, next) => {
    try {
      await connectToDatabase();

      const { platform, startDate, endDate, search, limit = 50, page = 1 } = req.query;

      const filter = {};
      if (platform && platform.toLowerCase() !== 'all') {
        filter.platform = platform.toLowerCase();
      }

      if (search && String(search).trim()) {
        const regex = new RegExp(String(search).trim(), 'i');
        filter.$or = [
          { email: regex },
          { churchName: regex },
          { appVersion: regex },
          { ipCountry: regex },
        ];
      }

      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }

      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
      const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
      const skip = (parsedPage - 1) * parsedLimit;

      // Fetch paginated downloads
      const [downloads, total] = await Promise.all([
        Download.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsedLimit),
        Download.countDocuments(filter),
      ]);

      // Aggregate counts by platform
      const platformCounts = await Download.aggregate([
        { $match: filter },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
      ]);

      const byPlatform = {
        macos: 0,
        windows: 0,
        android: 0,
        ios: 0,
      };
      platformCounts.forEach((p) => {
        if (p._id) {
          byPlatform[p._id.toLowerCase()] = p.count;
        }
      });

      // Aggregate counts by day and platform for the chart
      const timelineAgg = await Download.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              platform: '$platform',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]);

      const timelineMap = {};
      timelineAgg.forEach((item) => {
        const d = item._id.date;
        const p = (item._id.platform || 'macos').toLowerCase();
        if (!timelineMap[d]) {
          timelineMap[d] = {
            date: d,
            month: d.slice(5),
            macos: 0,
            windows: 0,
            android: 0,
            ios: 0,
            total: 0,
          };
        }
        timelineMap[d][p] = (timelineMap[d][p] || 0) + item.count;
        timelineMap[d].total += item.count;
      });

      const dailyTimeline = Object.values(timelineMap);

      res.json({
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
        byPlatform,
        dailyTimeline,
        downloads,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
