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
