const { body, param } = require('express-validator');

const cancelOrderValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  body('reason')
    .trim()
    .isLength({ min: 3, max: 500 })
    .withMessage('Cancellation reason must be between 3 and 500 characters')
];

const adminOverrideCancelValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  body('reason')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Admin reason cannot exceed 500 characters')
];

const refundReviewValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid refund request ID'),
  body('decision')
    .trim()
    .isIn(['APPROVED', 'DENIED'])
    .withMessage('Decision must be APPROVED or DENIED'),
  body('notes')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Admin notes cannot exceed 1000 characters')
];

module.exports = {
  cancelOrderValidator,
  adminOverrideCancelValidator,
  refundReviewValidator
};
