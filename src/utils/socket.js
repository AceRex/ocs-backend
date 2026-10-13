const { Server } = require('socket.io');
const { verifyToken } = require('./jwt');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { connectToDatabase } = require('../config/db');

async function currentAdmin(token) {
  const decoded = verifyToken(token);
  await connectToDatabase();
  if (decoded.jti && await RevokedToken.exists({ tokenId: decoded.jti })) throw new Error('Revoked token');
  const user = await User.findById(decoded.userId);
  if (!user || !['admin', 'super_admin'].includes(user.role)) throw new Error('Admin access required');
  if (user.lastLoggedOutAllAt && (!decoded.iat || decoded.iat * 1000 <= new Date(user.lastLoggedOutAllAt).getTime())) throw new Error('Logged out');
  if (user.graceExpiresAt && Date.now() > new Date(user.graceExpiresAt).getTime()) throw new Error('Expired account');
  return user;
}

async function emitToCurrentAdmins(event, payload) {
  if (!io) return;
  const sockets = await io.in('admin-room').fetchSockets();
  await Promise.all(sockets.map(async (socket) => {
    try {
      await currentAdmin(socket.data.adminToken);
      socket.emit(event, payload);
    } catch (_) {
      socket.leave('admin-room');
    }
  }));
}

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Allow mobile/desktop (undefined origin) or valid OCS domains
        if (!origin) return callback(null, true);
        const isAllowed = require('../middleware/cors').isOriginAllowed(origin);
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
    socket.on('join:admin', async (data) => {
      try {
        const token =
          (typeof data === 'string' ? data : data?.token) ||
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (!token) {
          socket.emit('error', { error: 'unauthorized', message: 'Authentication token required for admin room' });
          return;
        }

        await currentAdmin(token);
        socket.data.adminToken = token;
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
    emitToCurrentAdmins('admin:notification', payload).catch((err) => console.error('[WebSocket] notification dispatch failed:', err.message));
  } catch (err) {
    console.error('[WebSocket] emitAdminNotification error:', err.message);
  }
}

function emitAdminMetrics(payload) {
  if (!io) return;
  try {
    emitToCurrentAdmins('admin:metrics', payload).catch((err) => console.error('[WebSocket] metrics dispatch failed:', err.message));
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
