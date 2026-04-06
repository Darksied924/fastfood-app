const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');
const paymentService = require('../services/payment.service');
const mpesaService = require('../services/mpesa.service');

function logPayload(label, payload) {
  logger.info(label, {
    payload
  });
}

// @desc    Initiate STK Push
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

  // Initiate STK push
  const stkResult = await paymentService.initiateSTKPush(orderId, phone);

  logger.info(`STK push initiated for order ${orderId}:`, stkResult);

  if (stkResult.success) {
    successResponse(res, stkResult, stkResult.customerMessage || 'STK push initiated. Please check your phone for the payment prompt.');
  } else {
    errorResponse(res, stkResult.responseDescription || 'Failed to initiate payment', 400);
  }
});

// @desc    Handle M-Pesa STK Callback
// @route   POST /api/payments/stk-callback
const stkCallback = asyncHandler(async (req, res) => {
  console.log("CALLBACK RECEIVED");
  console.log(JSON.stringify(req.body, null, 2));

  const callbackData = req.body;

  logPayload('MPESA CALLBACK BODY', callbackData);
  logPayload('FULL CALLBACK PAYLOAD', callbackData);

  // Log the callback with detailed info
  logPayload('STK callback raw data', callbackData);
  
  // Debug: Log the body structure to help troubleshoot
  logPayload('STK callback Body', callbackData.Body);
  logPayload('STK callback stkCallback', callbackData.Body?.stkCallback);

  try {
    // Handle the callback
    const result = await paymentService.handleSTKCallback(callbackData);
    
    // Log the result for debugging
    logPayload('STK callback result', result);

    // Always return 200 to M-Pesa to acknowledge receipt
    res.status(200).json({
      ResultCode: result.ResultCode,
      ResultDesc: result.ResultDesc
    });
  } catch (error) {
    // Log the error for debugging
    logger.error('STK callback processing error:', error.message);
    logger.error('STK callback error stack:', error.stack);
    
    // Still return 200 to M-Pesa to prevent retries
    res.status(200).json({
      ResultCode: 1,
      ResultDesc: 'Callback received but processing failed'
    });
  }
});

// @desc    Simulate STK callback (for testing in sandbox)
// @route   POST /api/payments/simulate-callback
const simulateCallback = asyncHandler(async (req, res) => {
  const { orderId, success, checkoutRequestId } = req.body;

  if (!orderId || !checkoutRequestId) {
    return errorResponse(res, 'Order ID and checkout request ID are required', 400);
  }

  // Create simulated callback data
  const stkService = require('../services/stk.service');
  const callbackResult = await stkService.simulateCallback(checkoutRequestId, success !== false);

  if (callbackResult.success) {
    // Process the callback
    await paymentService.handleSTKCallback(callbackResult.callbackData);
    
    successResponse(res, {
      success: true,
      orderId: callbackResult.orderId,
      receiptNumber: callbackResult.receiptNumber,
      amount: callbackResult.amount
    }, 'Payment simulation successful. Order has been updated to paid.');
  } else {
    successResponse(res, {
      success: false,
      orderId: callbackResult.orderId,
      resultCode: callbackResult.resultCode,
      resultDesc: callbackResult.resultDesc
    }, 'Payment cancelled by user');
  }
});

// @desc    Query payment status
// @route   GET /api/payments/status/:checkoutRequestId
const queryPaymentStatus = asyncHandler(async (req, res) => {
  const { checkoutRequestId } = req.params;

  if (!checkoutRequestId) {
    return errorResponse(res, 'Checkout request ID is required', 400);
  }

  const stkService = require('../services/stk.service');
  const status = await stkService.queryStatus(checkoutRequestId);

  successResponse(res, status);
});

// @desc    Verify payment by receipt number
// @route   GET /api/payments/verify/:receiptNumber
const verifyPayment = asyncHandler(async (req, res) => {
  const { receiptNumber } = req.params;

  if (!receiptNumber) {
    return errorResponse(res, 'Receipt number is required', 400);
  }

  const payment = await paymentService.verifyPayment(receiptNumber);

  successResponse(res, payment);
});

// @desc    Get payment statistics
// @route   GET /api/payments/stats
const getPaymentStats = asyncHandler(async (req, res) => {
  const stats = await paymentService.getPaymentStats();

  successResponse(res, stats);
});

// @desc    Check M-Pesa configuration status
// @route   GET /api/payments/status
const getMpesaStatus = asyncHandler(async (req, res) => {
  const isConfigured = paymentService.isMpesaConfigured();
  
  successResponse(res, {
    configured: isConfigured,
    environment: mpesaService.environment || 'sandbox',
    message: isConfigured 
      ? 'M-Pesa is properly configured' 
      : 'M-Pesa is not configured. Using simulation mode.'
  });
});

module.exports = {
  initiateSTKPush,
  stkCallback,
  simulateCallback,
  queryPaymentStatus,
  verifyPayment,
  getPaymentStats,
  getMpesaStatus
};
