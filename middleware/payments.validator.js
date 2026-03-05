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
 * Validation rules for STK callback
 */
const stkCallbackValidator = [
  body('orderId')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  
  body('resultCode')
    .isInt()
    .withMessage('Result code is required'),
  
  body('resultDesc')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Result description is too long')
];

module.exports = {
  stkPushValidator,
  stkCallbackValidator
};

