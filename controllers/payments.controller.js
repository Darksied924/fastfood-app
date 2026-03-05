const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');
const stkService = require('../services/stk.service');

// @desc    Initiate STK Push simulation
// @route   POST /api/payments/stk-push
const initiateSTKPush = asyncHandler(async (req, res) => {
  const { orderId, phone } = req.body;

  if (!orderId || !phone) {
    return errorResponse(res, 'Order ID and phone number are required', 400);
  }

  // Check if order exists and belongs to user
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = ?',
    [orderId, req.user.id, 'pending']
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found or cannot be paid', 404);
  }

  // Simulate STK push
  const stkResult = await stkService.initiateSTKPush(orderId, phone, orders[0].total);

  logger.info(`STK push initiated for order ${orderId}`);

  successResponse(res, stkResult, 'STK push initiated. Please check your phone for the payment prompt.');
});

// @desc    STK Callback simulation
// @route   POST /api/payments/stk-callback
const stkCallback = asyncHandler(async (req, res) => {
  const { orderId, resultCode, resultDesc, mpesaReceiptNumber } = req.body;

  // Log the callback
  logger.info(`STK callback received for order ${orderId}: Code ${resultCode}`);

  if (resultCode !== 0) {
    // Payment failed
    logger.info(`Payment failed for order ${orderId}: ${resultDesc}`);
    return successResponse(res, { 
      ResultCode: resultCode, 
      ResultDesc: resultDesc 
    });
  }

  // Check if receipt already used
  if (mpesaReceiptNumber) {
    const existingOrder = await db.query(
      'SELECT id FROM orders WHERE mpesa_receipt = ?',
      [mpesaReceiptNumber]
    );

    if (existingOrder.length > 0) {
      logger.warn(`Duplicate receipt number: ${mpesaReceiptNumber}`);
      return errorResponse(res, 'Duplicate transaction', 400);
    }
  }

  // Get order details
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ?',
    [orderId]
  );

  if (orders.length === 0) {
    logger.error(`Order ${orderId} not found in callback`);
    return errorResponse(res, 'Order not found', 404);
  }

  const order = orders[0];

  // Update order status to paid and add receipt
  await db.query(
    'UPDATE orders SET status = ?, mpesa_receipt = ? WHERE id = ?',
    ['paid', mpesaReceiptNumber || `SIM${Date.now()}`, orderId]
  );

  logger.info(`Payment confirmed for order ${orderId}. Receipt: ${mpesaReceiptNumber}`);

  successResponse(res, {
    ResultCode: 0,
    ResultDesc: 'Success',
    MpesaReceiptNumber: mpesaReceiptNumber || `SIM${Date.now()}`
  });
});

module.exports = {
  initiateSTKPush,
  stkCallback
};
