const { body, param } = require('express-validator');

/**
 * Validation rules for STK push initiation
 */
const stkPushValidator = [
  body('orderId')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^(\+254|254|0)?[1-9]\d{8}$/)
    .withMessage('Please provide a valid Kenyan phone number (e.g., 0712345678)')
];

/**
 * Validation rules for STK callback (Daraja payload)
 */
const stkCallbackValidator = [
  body('Body.stkCallback')
    .exists()
    .withMessage('STK callback payload is missing')
    .bail(),

  body('Body.stkCallback.CheckoutRequestID')
    .notEmpty()
    .withMessage('CheckoutRequestID is required'),

  body('Body.stkCallback.ResultCode')
    .isInt()
    .withMessage('ResultCode is required'),

  body('Body.stkCallback.ResultDesc')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('ResultDesc is too long')
];

module.exports = {
  stkPushValidator,
  stkCallbackValidator
};
