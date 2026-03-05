const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const { errorResponse } = require('../utils/response.util');

const protect = async (req, res, next) => {
  try {
    let token;

    // Get token from header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return errorResponse(res, 'Not authorized to access this route', 401);
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get user from token
    const users = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [decoded.id]
    );

    if (users.length === 0) {
      return errorResponse(res, 'User not found', 401);
    }

    req.user = users[0];
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return errorResponse(res, 'Not authorized to access this route', 401);
  }
};

const restrictTo = (...roles) => {
  const allowedRoles = roles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean);

  return (req, res, next) => {
    const userRole = String(req.user?.role || '').trim().toLowerCase();

    if (!allowedRoles.includes(userRole)) {
      logger.warn(
        `Forbidden action blocked for user ${req.user?.id || 'unknown'} with role "${req.user?.role}". Allowed roles: ${allowedRoles.join(', ')}`
      );
      return errorResponse(res, 'You do not have permission to perform this action', 403);
    }
    next();
  };
};

module.exports = {
  protect,
  restrictTo
};
