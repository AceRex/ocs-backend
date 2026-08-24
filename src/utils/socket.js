const { Server } = require('socket.io');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    socket.on('join:admin', () => {
      socket.join('admin-room');
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
