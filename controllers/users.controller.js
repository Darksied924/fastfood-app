const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');

// @desc    Get all users
// @route   GET /api/users
const getAllUsers = asyncHandler(async (req, res) => {
  const users = await db.query(
    'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
  );

  successResponse(res, users);
});

// @desc    Get single user
// @route   GET /api/users/:id
const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const users = await db.query(
    'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
    [id]
  );

  if (users.length === 0) {
    return errorResponse(res, 'User not found', 404);
  }

  successResponse(res, users[0]);
});

// @desc    Create user
// @route   POST /api/users
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  // Check if user exists
  const existingUser = await db.query(
    'SELECT id FROM users WHERE email = ?',
    [email]
  );

  if (existingUser.length > 0) {
    return errorResponse(res, 'User already exists', 400);
  }

  // Hash password
  const bcrypt = require('bcryptjs');
  const config = require('../config');
  const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);

  // Create user
  const result = await db.query(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, hashedPassword, role || 'customer']
  );

  logger.info(`User created by admin: ${email}`);

  successResponse(res, {
    id: result.insertId,
    name,
    email,
    role: role || 'customer'
  }, 'User created successfully', 201);
});

// @desc    Update user
// @route   PATCH /api/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, email, role } = req.body;

  // Check if user exists
  const users = await db.query(
    'SELECT id FROM users WHERE id = ?',
    [id]
  );

  if (users.length === 0) {
    return errorResponse(res, 'User not found', 404);
  }

  // Update user
  await db.query(
    'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
    [name, email, role, id]
  );

  logger.info(`User updated: ${id}`);

  successResponse(res, null, 'User updated successfully');
});

// @desc    Delete user
// @route   DELETE /api/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if user exists
  const users = await db.query(
    'SELECT id FROM users WHERE id = ?',
    [id]
  );

  if (users.length === 0) {
    return errorResponse(res, 'User not found', 404);
  }

  // Delete user
  await db.query(
    'DELETE FROM users WHERE id = ?',
    [id]
  );

  logger.info(`User deleted: ${id}`);

  successResponse(res, null, 'User deleted successfully');
});

// @desc    Update user role
// @route   PATCH /api/users/:id/role
const updateUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  // Check if user exists
  const users = await db.query(
    'SELECT id FROM users WHERE id = ?',
    [id]
  );

  if (users.length === 0) {
    return errorResponse(res, 'User not found', 404);
  }

  // Update role
  await db.query(
    'UPDATE users SET role = ? WHERE id = ?',
    [role, id]
  );

  logger.info(`User role updated: ${id} -> ${role}`);

  successResponse(res, null, 'User role updated successfully');
});

module.exports = {
  getAllUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  updateUserRole
};