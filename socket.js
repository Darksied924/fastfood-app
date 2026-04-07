const jwt = require('jsonwebtoken');
const db = require('./db');
const config = require('./config');

let io = null;

const setSocketServer = (server) => {
  io = server;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        throw new Error('Missing auth token');
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const users = await db.query('SELECT id, role FROM users WHERE id = ?', [decoded.id]);

      if (users.length === 0) {
        throw new Error('User not found');
      }

      socket.user = users[0];
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) return;

    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);

    if (user.role === 'delivery') {
      socket.join(`delivery:${user.id}`);
    }
  });

  return io;
};

const getIo = () => io;

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

const emitToDelivery = (deliveryId, event, payload) => {
  if (!io || !deliveryId) return;
  io.to(`delivery:${deliveryId}`).emit(event, payload);
};

const emitToRole = (role, event, payload) => {
  if (!io || !role) return;
  io.to(`role:${role}`).emit(event, payload);
};

module.exports = {
  setSocketServer,
  getIo,
  emitToUser,
  emitToDelivery,
  emitToRole
};
