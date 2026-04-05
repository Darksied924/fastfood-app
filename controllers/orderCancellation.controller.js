const asyncHandler = require('../utils/asyncHandler');
const { successResponse } = require('../utils/response.util');
const orderCancellationService = require('../services/orderCancellation.service');

const cancelOrder = asyncHandler(async (req, res) => {
  const result = await orderCancellationService.cancelOrder(
    Number(req.params.id),
    req.user.id,
    String(req.body.reason || '').trim()
  );

  successResponse(res, result, result.message);
});

const adminOverrideCancel = asyncHandler(async (req, res) => {
  const result = await orderCancellationService.adminOverrideCancel(
    Number(req.params.id),
    req.user.id,
    String(req.body.reason || '').trim()
  );

  successResponse(res, result, result.message);
});

const reviewRefundRequest = asyncHandler(async (req, res) => {
  const result = await orderCancellationService.reviewRefundRequest(
    Number(req.params.id),
    req.user.id,
    String(req.body.decision || '').trim().toUpperCase(),
    String(req.body.notes || '').trim()
  );

  successResponse(res, result, result.message);
});

const getCancellationRequests = asyncHandler(async (req, res) => {
  const requests = await orderCancellationService.getCancellationRequests();
  successResponse(res, requests);
});

const getCancelledOrders = asyncHandler(async (req, res) => {
  const orders = await orderCancellationService.getCancelledOrders();
  successResponse(res, orders);
});

module.exports = {
  cancelOrder,
  adminOverrideCancel,
  reviewRefundRequest,
  getCancellationRequests,
  getCancelledOrders
};
