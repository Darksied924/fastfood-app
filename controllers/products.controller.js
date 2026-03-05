const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');

// @desc    Get all products
// @route   GET /api/products
const getAllProducts = asyncHandler(async (req, res) => {
  const { available } = req.query;
  
  let query = 'SELECT * FROM products';
  const params = [];

  if (available === 'true') {
    query += ' WHERE available = true';
  }

  query += ' ORDER BY name';

  const products = await db.query(query, params);

  successResponse(res, products);
});

// @desc    Get single product
// @route   GET /api/products/:id
const getProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const products = await db.query(
    'SELECT * FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  successResponse(res, products[0]);
});

// @desc    Create product
// @route   POST /api/products
const createProduct = asyncHandler(async (req, res) => {
  const { name, price, image, available } = req.body;

  const result = await db.query(
    'INSERT INTO products (name, price, image, available) VALUES (?, ?, ?, ?)',
    [name, price, image || '🍔', available !== false]
  );

  logger.info(`Product created: ${name}`);

  successResponse(res, {
    id: result.insertId,
    name,
    price,
    image,
    available: available !== false
  }, 'Product created successfully', 201);
});

// @desc    Update product
// @route   PATCH /api/products/:id
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, price, image, available } = req.body;

  // Check if product exists
  const products = await db.query(
    'SELECT id FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  // Build update query dynamically
  let updateFields = [];
  let values = [];

  if (name) {
    updateFields.push('name = ?');
    values.push(name);
  }
  if (price) {
    updateFields.push('price = ?');
    values.push(price);
  }
  if (image) {
    updateFields.push('image = ?');
    values.push(image);
  }
  if (available !== undefined) {
    updateFields.push('available = ?');
    values.push(available);
  }

  if (updateFields.length === 0) {
    return errorResponse(res, 'No fields to update', 400);
  }

  values.push(id);

  await db.query(
    `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`,
    values
  );

  logger.info(`Product updated: ${id}`);

  successResponse(res, null, 'Product updated successfully');
});

// @desc    Delete product
// @route   DELETE /api/products/:id
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if product exists
  const products = await db.query(
    'SELECT id FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  // Check if product is used in orders
  const orderItems = await db.query(
    'SELECT id FROM order_items WHERE product_id = ? LIMIT 1',
    [id]
  );

  if (orderItems.length > 0) {
    // Soft delete by making unavailable instead of deleting
    await db.query(
      'UPDATE products SET available = false WHERE id = ?',
      [id]
    );
    
    logger.info(`Product made unavailable (has orders): ${id}`);
    
    return successResponse(res, null, 'Product made unavailable (has existing orders)');
  }

  // Hard delete if not used
  await db.query(
    'DELETE FROM products WHERE id = ?',
    [id]
  );

  logger.info(`Product deleted: ${id}`);

  successResponse(res, null, 'Product deleted successfully');
});

// @desc    Toggle product availability
// @route   PATCH /api/products/:id/toggle-availability
const toggleAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get current availability
  const products = await db.query(
    'SELECT available FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  const newAvailability = !products[0].available;

  await db.query(
    'UPDATE products SET available = ? WHERE id = ?',
    [newAvailability, id]
  );

  logger.info(`Product availability toggled: ${id} -> ${newAvailability}`);

  successResponse(res, { available: newAvailability }, 'Product availability updated');
});

module.exports = {
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleAvailability
};