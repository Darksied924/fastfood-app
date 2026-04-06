const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { generateToken } = require('../utils/token.util');
const { successResponse, errorResponse } = require('../utils/response.util');

const createSocialAuthError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getOrCreateSocialUser = async ({ email, name, provider }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();

  let users = await db.query(
    'SELECT * FROM users WHERE email = ?',
    [normalizedEmail]
  );

  let user = users[0];

  if (!user) {
    const generatedPassword = crypto.randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(generatedPassword, config.bcryptRounds);
    const fallbackName = normalizedEmail.split('@')[0] || 'CraveDash User';
    const safeName = String(name || fallbackName).trim().slice(0, 50) || 'CraveDash User';

    const result = await db.query(
      'INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)',
      [safeName, normalizedEmail, hashedPassword, 'customer', null]
    );

    users = await db.query(
      'SELECT * FROM users WHERE id = ?',
      [result.insertId]
    );

    user = users[0];
    logger.info(`New user registered with ${provider}: ${normalizedEmail}`);
  } else {
    logger.info(`User logged in with ${provider}: ${normalizedEmail}`);
  }

  return user;
};

const verifyGoogleCredential = async (credential) => {
  if (!config.google.enabled || !config.google.clientId) {
    throw createSocialAuthError('Google Sign-In is not configured', 503);
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );

  if (!response.ok) {
    throw createSocialAuthError('Invalid Google credential', 401);
  }

  const payload = await response.json();

  if (payload.aud !== config.google.clientId) {
    throw createSocialAuthError('Google credential was issued for a different client', 401);
  }

  if (String(payload.email_verified).toLowerCase() !== 'true') {
    throw createSocialAuthError('Google account email is not verified', 401);
  }

  if (!payload.email) {
    throw createSocialAuthError('Google account did not provide an email address', 400);
  }

  return payload;
};

const verifyFacebookAccessToken = async (accessToken) => {
  if (!config.facebook.enabled || !config.facebook.appId || !config.facebook.appSecret) {
    throw createSocialAuthError('Facebook Sign-In is not configured', 503);
  }

  const appAccessToken = `${config.facebook.appId}|${config.facebook.appSecret}`;
  const debugResponse = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`
  );

  if (!debugResponse.ok) {
    throw createSocialAuthError('Invalid Facebook access token', 401);
  }

  const debugPayload = await debugResponse.json();
  const tokenData = debugPayload.data || {};

  if (!tokenData.is_valid) {
    throw createSocialAuthError('Facebook access token is no longer valid', 401);
  }

  if (String(tokenData.app_id) !== String(config.facebook.appId)) {
    throw createSocialAuthError('Facebook access token was issued for a different app', 401);
  }

  const profileResponse = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
  );

  if (!profileResponse.ok) {
    throw createSocialAuthError('Unable to read Facebook account details', 401);
  }

  const profile = await profileResponse.json();

  if (!profile.email) {
    throw createSocialAuthError(
      'Facebook account did not provide an email address. Please allow email access and try again.',
      400
    );
  }

  return profile;
};

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

// @desc    Get Google auth config
// @route   GET /api/auth/google/config
const getGoogleAuthConfig = asyncHandler(async (req, res) => {
  const enabled = Boolean(config.google.enabled && config.google.clientId);

  successResponse(res, {
    enabled,
    clientId: enabled ? config.google.clientId : ''
  });
});

// @desc    Get Facebook auth config
// @route   GET /api/auth/facebook/config
const getFacebookAuthConfig = asyncHandler(async (req, res) => {
  const enabled = Boolean(
    config.facebook.enabled &&
    config.facebook.appId &&
    config.facebook.appSecret
  );

  successResponse(res, {
    enabled,
    appId: enabled ? config.facebook.appId : '',
    apiVersion: config.facebook.apiVersion
  });
});

// @desc    Login/register user with Google
// @route   POST /api/auth/google
const googleLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body;
  const googleUser = await verifyGoogleCredential(credential);
  const user = await getOrCreateSocialUser({
    email: googleUser.email,
    name: googleUser.name || googleUser.given_name,
    provider: 'Google'
  });

  const token = generateToken(user.id);

  successResponse(res, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token
  }, 'Google login successful');
});

// @desc    Login/register user with Facebook
// @route   POST /api/auth/facebook
const facebookLogin = asyncHandler(async (req, res) => {
  const { accessToken } = req.body;
  const facebookUser = await verifyFacebookAccessToken(accessToken);
  const user = await getOrCreateSocialUser({
    email: facebookUser.email,
    name: facebookUser.name,
    provider: 'Facebook'
  });

  const token = generateToken(user.id);

  successResponse(res, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token
  }, 'Facebook login successful');
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
  getGoogleAuthConfig,
  getFacebookAuthConfig,
  googleLogin,
  facebookLogin,
  forgotPassword,
  resetPassword,
  getMe,
  updatePassword,
  updateProfile
};
