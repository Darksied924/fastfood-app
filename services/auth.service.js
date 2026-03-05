const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const emailService = require('./email.service');

/**
 * Authentication Service
 * Handles business logic for authentication operations
 */
class AuthService {
    /**
     * Register a new user
     * @param {Object} userData - User registration data
     * @returns {Promise<Object>} Registered user object
     */
    async register(userData) {
        const { name, email, password } = userData;

        // Check if user already exists
        const existingUser = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUser.length > 0) {
            const error = new Error('User already exists with this email');
            error.statusCode = 400;
            throw error;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, config.bcryptRounds);

        // Insert new user
        const result = await db.query(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, 'customer']
        );

        const userId = result.insertId;

        // Get created user
        const users = await db.query(
            'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
            [userId]
        );

        const user = users[0];

        // Generate JWT token
        const token = this.generateToken(userId);

        logger.info(`New user registered: ${email}`);

        return {
            user,
            token
        };
    }

    /**
     * Login user
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {Promise<Object>} User object and token
     */
    async login(email, password) {
        // Get user with password
        const users = await db.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        const user = users[0];

        if (!user) {
            const error = new Error('Invalid credentials');
            error.statusCode = 401;
            throw error;
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            const error = new Error('Invalid credentials');
            error.statusCode = 401;
            throw error;
        }

        // Generate token
        const token = this.generateToken(user.id);

        logger.info(`User logged in: ${email}`);

        // Remove password from response
        delete user.password;

        return {
            user,
            token
        };
    }

    /**
     * Generate JWT token
     * @param {number} userId - User ID
     * @returns {string} JWT token
     */
    generateToken(userId) {
        return jwt.sign(
            { id: userId },
            config.jwt.secret,
            { expiresIn: config.jwt.expire }
        );
    }

    /**
     * Generate password reset token
     * @param {string} email - User email
     * @returns {Promise<string>} Reset token
     */
    async forgotPassword(email) {
        // Find user
        const users = await db.query(
            'SELECT id, name, email FROM users WHERE email = ?',
            [email]
        );

        const user = users[0];

        if (!user) {
            // Don't reveal that user doesn't exist for security
            return null;
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // Hash token for storage
        const hashedToken = crypto
            .createHash('sha256')
            .update(resetToken)
            .digest('hex');

        // Set expiry (1 hour from now)
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 1);

        // Save to database
        await db.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
            [hashedToken, expiry, user.id]
        );

        logger.info(`Password reset requested for: ${email}`);

        // Send email with reset token
        try {
            await emailService.sendPasswordResetEmail(user.email, resetToken);
        } catch (emailError) {
            logger.error('Failed to send password reset email:', emailError);
            // Continue even if email fails - we'll return token for demo
        }

        // Return token for demo purposes
        return resetToken;
    }

    /**
     * Reset password using token
     * @param {string} token - Reset token
     * @param {string} newPassword - New password
     * @returns {Promise<boolean>} Success status
     */
    async resetPassword(token, newPassword) {
        // Hash the token from URL
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
            const error = new Error('Invalid or expired reset token');
            error.statusCode = 400;
            throw error;
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, config.bcryptRounds);

        // Update password and clear reset token
        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        logger.info(`Password reset completed for user: ${user.id}`);

        return true;
    }

    /**
     * Get user by ID
     * @param {number} userId - User ID
     * @returns {Promise<Object>} User object
     */
    async getUserById(userId) {
        const users = await db.query(
            'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        return users[0];
    }

    /**
     * Update user password
     * @param {number} userId - User ID
     * @param {string} currentPassword - Current password
     * @param {string} newPassword - New password
     * @returns {Promise<boolean>} Success status
     */
    async updatePassword(userId, currentPassword, newPassword) {
        // Get user with password
        const users = await db.query(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );

        const user = users[0];

        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

        if (!isPasswordValid) {
            const error = new Error('Current password is incorrect');
            error.statusCode = 401;
            throw error;
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, config.bcryptRounds);

        // Update password
        await db.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId]
        );

        logger.info(`Password updated for user: ${userId}`);

        return true;
    }

    /**
     * Change user role (admin only)
     * @param {number} userId - User ID
     * @param {string} newRole - New role
     * @returns {Promise<Object>} Updated user
     */
    async changeUserRole(userId, newRole) {
        const validRoles = ['admin', 'manager', 'delivery', 'customer'];
        
        if (!validRoles.includes(newRole)) {
            const error = new Error('Invalid role');
            error.statusCode = 400;
            throw error;
        }

        // Check if user exists
        const users = await db.query(
            'SELECT id FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        // Update role
        await db.query(
            'UPDATE users SET role = ? WHERE id = ?',
            [newRole, userId]
        );

        logger.info(`User ${userId} role changed to ${newRole}`);

        // Get updated user
        return this.getUserById(userId);
    }

    /**
     * Verify JWT token
     * @param {string} token - JWT token
     * @returns {Promise<Object>} Decoded token payload
     */
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            return decoded;
        } catch (error) {
            logger.error('Token verification failed:', error);
            throw error;
        }
    }

    /**
     * Validate user permissions
     * @param {Object} user - User object
     * @param {Array} allowedRoles - Allowed roles
     * @returns {boolean} Whether user has permission
     */
    hasPermission(user, allowedRoles) {
        if (!user || !user.role) return false;
        return allowedRoles.includes(user.role);
    }
}

module.exports = new AuthService();