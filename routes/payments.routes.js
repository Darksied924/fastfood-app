const express = require('express');
const paymentsController = require('../controllers/payments.controller');
const config = require('../config');
const logger = require('../logger');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  stkPushValidator,
  stkCallbackValidator
} = require('../middleware/payments.validator');

const router = express.Router();

// Rate limiters
const userPaymentInitRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.userPaymentInitWindowMs,
  maxRequests: config.rateLimit.userPaymentInitMaxRequests,
  message: 'Too many payment initiation attempts from this account. Please try again later.',
  keyGenerator: (req) => `user:${req.user.id}:payment-init`
});

const paymentCallbackRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.paymentCallbackWindowMs,
  maxRequests: config.rateLimit.paymentCallbackMaxRequests,
  message: 'Too many payment callback requests. Please retry later.'
});

// Public routes
router.post('/stk-callback', paymentCallbackRateLimiter, stkCallbackValidator, validate, paymentsController.stkCallback);

// Test endpoint to verify callback is reachable
router.post('/test-callback', (req, res) => {
    logger.info('TEST CALLBACK RECEIVED:', JSON.stringify(req.body));
    res.status(200).json({ received: true, body: req.body });
});

// Protected routes - require authentication
router.post('/stk-push', protect, userPaymentInitRateLimiter, stkPushValidator, validate, paymentsController.initiateSTKPush);
router.post('/simulate-callback', protect, paymentsController.simulateCallback);
router.get('/status/:checkoutRequestId', protect, paymentsController.queryPaymentStatus);
router.get('/verify/:receiptNumber', protect, paymentsController.verifyPayment);
router.get('/stats', protect, paymentsController.getPaymentStats);
router.get('/status', protect, paymentsController.getMpesaStatus);

module.exports = router;

