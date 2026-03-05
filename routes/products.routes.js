const express = require('express');
const productsController = require('../controllers/products.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const {
  createProductValidator,
  updateProductValidator,
  productIdValidator
} = require('../middleware/products.validator');

const router = express.Router();

// Public routes
router.get('/', productsController.getAllProducts);
router.get('/:id', productIdValidator, validate, productsController.getProduct);

// Protected routes (admin and manager only)
router.use(protect);
router.use(restrictTo('admin', 'manager'));

router.post('/', createProductValidator, validate, productsController.createProduct);
router.patch('/:id', updateProductValidator, validate, productsController.updateProduct);
router.delete('/:id', productIdValidator, validate, productsController.deleteProduct);
router.patch('/:id/toggle-availability', productIdValidator, validate, productsController.toggleAvailability);

module.exports = router;

