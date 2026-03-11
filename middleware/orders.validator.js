const { body, param } = require('express-validator');

/**
 * Validation rules for creating an order
 */
const createOrderValidator = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must contain at least one item'),
  
  body('items.*.id')
    .isInt({ min: 1 })
    .withMessage('Invalid product ID'),
  
  body('items.*.quantity')
    .isInt({ min: 1, max: 99 })
    .withMessage('Quantity must be between 1 and 99'),
  
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required for delivery')
    .matches(/^(\+254|254|0)?[1-9]\d{8}$/)
    .withMessage('Please provide a valid Kenyan phone number'),
  
  body('deliveryAddress')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Delivery address cannot exceed 500 characters'),

  body('replacesOrderId')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('Invalid order reference to replace'),

  body('notes')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Order notes cannot exceed 1000 characters')
];

/**
 * Validation rules for order ID parameter
 */
const orderIdValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID')
];

/**
 * Validation rules for updating order status
 */
const updateOrderStatusValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered'])
    .withMessage('Invalid status value')
];

/**
 * Validation rules for assigning delivery
 */
const assignDeliveryValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid order ID'),
  
  body('deliveryId')
    .isInt({ min: 1 })
    .withMessage('Invalid delivery user ID')
];

module.exports = {
  createOrderValidator,
  orderIdValidator,
  updateOrderStatusValidator,
  assignDeliveryValidator
};
