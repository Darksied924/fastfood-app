const express = require('express');
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const config = require('../config');
const validate = require('../middleware/validate');
const { createRateLimiter, getClientIp } = require('../middleware/rateLimiter');
const {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  updatePasswordValidator,
  updateProfileValidator
} = require('../middleware/auth.validator');

const router = express.Router();

const authRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.authWindowMs,
  maxRequests: config.rateLimit.authMaxRequests,
  message: 'Too many authentication attempts. Please wait and try again.',
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toLowerCase().trim();
    const ip = getClientIp(req);
    return email ? `${ip}:${email}` : ip;
  }
});

router.post('/register', authRateLimiter, registerValidator, validate, authController.register);
router.post('/login', authRateLimiter, loginValidator, validate, authController.login);
router.post('/forgot-password', authRateLimiter, forgotPasswordValidator, validate, authController.forgotPassword);
router.post('/reset-password/:token', authRateLimiter, resetPasswordValidator, validate, authController.resetPassword);
router.get('/me', protect, authController.getMe);
router.put('/profile', protect, updateProfileValidator, validate, authController.updateProfile);
router.put('/update-password', protect, updatePasswordValidator, validate, authController.updatePassword);

module.exports = router;
