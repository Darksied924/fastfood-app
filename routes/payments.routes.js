const express = require('express');
const paymentsController = require('../controllers/payments.controller');
const config = require('../config');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  stkPushValidator,
  stkCallbackValidator
} = require('../middleware/payments.validator');

const router = express.Router();

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

// Simulated STK Push endpoints
router.post('/stk-push', protect, userPaymentInitRateLimiter, stkPushValidator, validate, paymentsController.initiateSTKPush);
router.post('/stk-callback', paymentCallbackRateLimiter, stkCallbackValidator, validate, paymentsController.stkCallback);

module.exports = router;
