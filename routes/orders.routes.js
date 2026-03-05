const express = require('express');
const ordersController = require('../controllers/orders.controller');
const config = require('../config');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
  createOrderValidator,
  orderIdValidator,
  updateOrderStatusValidator,
  assignDeliveryValidator
} = require('../middleware/orders.validator');

const router = express.Router();

// Protect all routes
router.use(protect);

const userCreateOrderRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.userOrderCreateWindowMs,
  maxRequests: config.rateLimit.userOrderCreateMaxRequests,
  message: 'Too many orders created from this account. Please try again later.',
  keyGenerator: (req) => `user:${req.user.id}:create-order`
});

// Customer routes
router.post('/', userCreateOrderRateLimiter, createOrderValidator, validate, ordersController.createOrder);
router.get('/my-orders', ordersController.getMyOrders);

// Admin and Manager routes
router.get('/', restrictTo('admin', 'manager'), ordersController.getAllOrders);
router.get('/delivery-personnel', restrictTo('admin', 'manager'), ordersController.getDeliveryPersonnel);
router.get('/analytics', restrictTo('admin'), ordersController.getAnalytics);
router.get('/analytics/export', restrictTo('admin'), ordersController.exportAnalyticsCsv);
router.get('/:id', orderIdValidator, validate, ordersController.getOrder);

router.patch('/:id/status', restrictTo('admin', 'manager'), updateOrderStatusValidator, validate, ordersController.updateOrderStatus);
router.post('/:id/assign', restrictTo('admin', 'manager'), assignDeliveryValidator, validate, ordersController.assignDelivery);

// Delivery routes
router.get('/delivery/assigned', restrictTo('delivery'), ordersController.getAssignedOrders);
router.get('/delivery/dashboard', restrictTo('delivery'), ordersController.getDeliveryDashboard);
router.patch('/:id/delivered', restrictTo('delivery'), orderIdValidator, validate, ordersController.markAsDelivered);

module.exports = router;
