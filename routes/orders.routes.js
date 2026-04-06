const express = require('express');
const ordersController = require('../controllers/orders.controller');
const orderCancellationController = require('../controllers/orderCancellation.controller');
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
const {
  cancelOrderValidator,
  adminOverrideCancelValidator,
  refundReviewValidator
} = require('../middleware/orderCancellation.validator');

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
router.post('/:id/cancel', restrictTo('customer'), cancelOrderValidator, validate, orderCancellationController.cancelOrder);

// Admin and Manager routes
router.get('/', restrictTo('admin', 'manager'), ordersController.getAllOrders);
router.get('/cancelled', restrictTo('admin', 'manager'), orderCancellationController.getCancelledOrders);
router.get('/cancellations', restrictTo('admin', 'manager'), orderCancellationController.getCancellationRequests);
router.get('/delivery-personnel', restrictTo('admin', 'manager'), ordersController.getDeliveryPersonnel);
router.get('/analytics', restrictTo('admin', 'manager'), ordersController.getAnalytics);
router.get('/analytics/export', restrictTo('admin'), ordersController.exportAnalyticsCsv);
router.post('/:id/override-cancel', restrictTo('admin'), adminOverrideCancelValidator, validate, orderCancellationController.adminOverrideCancel);
router.patch('/refunds/:id/review', restrictTo('admin'), refundReviewValidator, validate, orderCancellationController.reviewRefundRequest);
router.get('/:id', orderIdValidator, validate, ordersController.getOrder);

router.patch('/:id/status', restrictTo('admin', 'manager'), updateOrderStatusValidator, validate, ordersController.updateOrderStatus);
router.post('/:id/assign', restrictTo('admin', 'manager'), assignDeliveryValidator, validate, ordersController.assignDelivery);

// Delivery routes
router.get('/delivery/assigned', restrictTo('delivery'), ordersController.getAssignedOrders);
router.get('/delivery/dashboard', restrictTo('delivery'), ordersController.getDeliveryDashboard);
router.patch('/:id/delivered', restrictTo('delivery'), orderIdValidator, validate, ordersController.markAsDelivered);

module.exports = router;
