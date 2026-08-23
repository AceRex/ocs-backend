const express = require('express');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const downloadRoutes = require('./routes/downloads');
const testimonialRoutes = require('./routes/testimonials');
const ticketRoutes = require('./routes/tickets');
const faqRoutes = require('./routes/faqs');
const permissionsRoutes = require('./routes/permissions');

const app = express();

// Trust proxy headers for IP resolution in Netlify / Cloudflare / Load Balancers
app.set('trust proxy', true);

// Middleware stack
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check endpoints
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    service: 'ocs-backend',
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Mount API routes under both /api and root to handle direct and proxied calls cleanly
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api', downloadRoutes);
app.use('/', downloadRoutes);

app.use('/api', testimonialRoutes);
app.use('/', testimonialRoutes);

app.use('/api', ticketRoutes);
app.use('/', ticketRoutes);

app.use('/api', faqRoutes);
app.use('/', faqRoutes);

app.use('/api/permissions', permissionsRoutes);
app.use('/api/admin/permissions', permissionsRoutes);
app.use('/permissions', permissionsRoutes);
app.use('/admin/permissions', permissionsRoutes);

// Handle 404 for unhandled routes
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
  });
});

// Centralized error handling
app.use(errorHandler);

module.exports = app;
