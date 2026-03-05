const { body, param } = require('express-validator');

/**
 * Validation rules for creating a product
 */
const createProductValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  
  body('price')
    .notEmpty()
    .withMessage('Price is required')
    .isFloat({ min: 0.01 })
    .withMessage('Price must be a positive number')
    .custom((value) => {
      if (value > 10000) {
        throw new Error('Price cannot exceed 10,000');
      }
      return true;
    }),
  
  body('image')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Image URL cannot exceed 500 characters'),
  
  body('description')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
  body('category')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Category cannot exceed 50 characters')
];

/**
 * Validation rules for updating a product
 */
const updateProductValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid product ID'),
  
  body('name')
    .optional({ nullable: true })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  
  body('price')
    .optional({ nullable: true })
    .isFloat({ min: 0.01 })
    .withMessage('Price must be a positive number')
    .custom((value) => {
      if (value > 10000) {
        throw new Error('Price cannot exceed 10,000');
      }
      return true;
    }),
  
  body('image')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Image URL cannot exceed 500 characters'),
  
  body('description')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
  body('category')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage('Category cannot exceed 50 characters'),
  
  body('available')
    .optional({ nullable: true })
    .isBoolean()
    .withMessage('Available must be a boolean value')
];

/**
 * Validation rules for getting a product by ID
 */
const productIdValidator = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Invalid product ID')
];

module.exports = {
  createProductValidator,
  updateProductValidator,
  productIdValidator
};

