const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { generateToken } = require('../utils/token.util');
const { successResponse, errorResponse } = require('../utils/response.util');

// @desc    Register user
// @route   POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  // Check if user exists
  const existingUser = await db.query(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );

  if (existingUser.length > 0) {
    return errorResponse(res, 'User already exists', 400);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);

  // Create user
  const result = await db.query(
    'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)',
    [name, email, hashedPassword, 'customer', phone || null]
  );

  const userId = result.insertId;

  // Generate token
  const token = generateToken(userId);

  logger.info(`New user registered: ${email}`);

  successResponse(res, {
    id: userId,
    name,
    email,
    phone: phone || null,
    role: 'customer',
    token
  }, 'User registered successfully', 201);
});

// @desc    Login user
// @route   POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Check if user exists
  const users = await db.query(
    'SELECT * FROM users WHERE email = ?',
    [email]
  );

  const user = users[0];

  if (!user) {
    return errorResponse(res, 'Invalid credentials', 401);
  }

  // Check password
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return errorResponse(res, 'Invalid credentials', 401);
  }

  // Generate token
  const token = generateToken(user.id);

  logger.info(`User logged in: ${email}`);

  successResponse(res, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token
  }, 'Login successful');
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Find user
  const users = await db.query(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );

  const user = users[0];

  if (!user) {
    // Don't reveal that user doesn't exist
    return successResponse(res, null, 'If your email is registered, you will receive a reset link');
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expiry (1 hour)
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

  // Save to database
  await db.query(
    'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
    [hashedToken, expiry, user.id]
  );

  // In production, send email here
  logger.info(`Password reset requested for: ${email}`);

  // For demo, return token in response
  successResponse(res, { 
    resetToken,
    message: 'In production, this would be emailed. For demo, use this token.' 
  }, 'Reset token generated');
});

// @desc    Reset password
// @route   POST /api/auth/reset-password/:token
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // Hash token
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid token
  const users = await db.query(
    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
    [hashedToken]
  );

  const user = users[0];

  if (!user) {
    return errorResponse(res, 'Invalid or expired token', 400);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);

  // Update password and clear token
  await db.query(
    'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
    [hashedPassword, user.id]
  );

  logger.info(`Password reset completed for user: ${user.id}`);

  successResponse(res, null, 'Password reset successful');
});

// @desc    Get current user
// @route   GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await db.query(
    'SELECT id, name, email, phone, role, created_at, updated_at FROM users WHERE id = ?',
    [req.user.id]
  );

  successResponse(res, user[0]);
});

// @desc    Update current user profile
// @route   PUT /api/auth/profile
const updateProfile = asyncHandler(async (req, res) => {
  const { name, email, phone } = req.body;
  const userId = req.user.id;

  if (email) {
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );

    if (existingUser.length > 0) {
      return errorResponse(res, 'Email is already in use', 400);
    }
  }

  const updates = [];
  const values = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }

  if (email) {
    updates.push('email = ?');
    values.push(email);
  }

  if (phone) {
    updates.push('phone = ?');
    values.push(phone);
  }

  if (updates.length === 0) {
    return errorResponse(res, 'No valid fields to update', 400);
  }

  values.push(userId);

  await db.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  const updatedUser = await db.query(
    'SELECT id, name, email, phone, role, created_at, updated_at FROM users WHERE id = ?',
    [userId]
  );

  logger.info(`Profile updated for user: ${userId}`);

  successResponse(res, updatedUser[0], 'Profile updated successfully');
});

// @desc    Update password
// @route   PUT /api/auth/update-password
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const users = await db.query(
    'SELECT * FROM users WHERE id = ?',
    [req.user.id]
  );

  const user = users[0];

  // Check current password
  const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

  if (!isPasswordValid) {
    return errorResponse(res, 'Current password is incorrect', 401);
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, config.bcryptRounds);

  // Update password
  await db.query(
    'UPDATE users SET password = ? WHERE id = ?',
    [hashedPassword, req.user.id]
  );

  logger.info(`Password updated for user: ${req.user.id}`);

  successResponse(res, null, 'Password updated successfully');
});

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getMe,
  updatePassword,
  updateProfile
};
