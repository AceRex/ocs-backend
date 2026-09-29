const { Server } = require('socket.io');
const { verifyToken } = require('./jwt');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow mobile/desktop (undefined origin) or valid OCS domains
        if (!origin) return callback(null, true);
        const allowedPatterns = [
          /^https:\/\/(www\.)?churchocs\.com$/,
          /^https:\/\/ocs-web-three\.vercel\.app$/,
          /^https:\/\/ocs-web-three(-[a-z0-9-]+)?\.vercel\.app$/,
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
          /^capacitor:\/\/localhost$/,
          /^ionic:\/\/localhost$/,
        ];
        const isAllowed = allowedPatterns.some((p) => p.test(origin));
        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin denied for WebSocket'));
        }
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    socket.on('join:admin', (data) => {
      try {
        const token =
          (typeof data === 'string' ? data : data?.token) ||
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (!token) {
          socket.emit('error', { error: 'unauthorized', message: 'Authentication token required for admin room' });
          return;
        }

        const decoded = verifyToken(token);
        const role = decoded?.role;

        if (role !== 'admin' && role !== 'super_admin' && role !== 'church_admin') {
          socket.emit('error', { error: 'forbidden', message: 'Admin role required to join admin room' });
          return;
        }

        socket.join('admin-room');
        socket.emit('joined:admin', { success: true, room: 'admin-room' });
      } catch (err) {
        socket.emit('error', { error: 'invalid_token', message: 'Token verification failed for admin room' });
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitAdminNotification(payload) {
  if (payload && payload.id) {
    try {
      const AdminNotification = require('../models/AdminNotification');
      AdminNotification.findOneAndUpdate(
        { notificationId: String(payload.id) },
        {
          notificationId: String(payload.id),
          type: payload.type || 'system',
          title: payload.title || 'Notification',
          summary: payload.summary || '',
          category: payload.category || 'General',
          status: payload.status || 'new',
          badge: payload.badge || '',
          timestamp: payload.timestamp || new Date(),
          targetUrl: payload.targetUrl || '/admin/notifications',
          isUnread: payload.isUnread !== undefined ? payload.isUnread : true,
          metadata: payload.metadata || {},
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch((err) => {
        // Silently catch persistence error if db is initializing
      });
    } catch (e) {}
  }

  if (!io) return;
  try {
    io.emit('admin:notification', payload);
    io.to('admin-room').emit('admin:notification', payload);
  } catch (err) {
    console.error('[WebSocket] emitAdminNotification error:', err.message);
  }
}

function emitAdminMetrics(payload) {
  if (!io) return;
  try {
    io.emit('admin:metrics', payload);
    io.to('admin-room').emit('admin:metrics', payload);
  } catch (err) {
    console.error('[WebSocket] emitAdminMetrics error:', err.message);
  }
}

module.exports = {
  initSocket,
  getIO,
  emitAdminNotification,
  emitAdminMetrics,
};
