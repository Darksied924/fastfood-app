const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');
const { processProductImage, deleteProductImage } = require('../utils/imageUpload.util');

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
  const { name, price, available } = req.body;

  // Convert available to boolean (handle string "0", "1" from FormData)
  const isAvailable = available === false || available === '0' || available === 0 ? false : true;

  // Insert product first to get the ID
  const result = await db.query(
    'INSERT INTO products (name, price, image, available) VALUES (?, ?, ?, ?)',
    [name, price, '🍔', isAvailable]
  );

  const productId = result.insertId;
  let imageUrl = '🍔';

  // Process uploaded image if present
  if (req.file) {
    try {
      imageUrl = await processProductImage(req.file, productId);
      // Update product with image URL
      await db.query(
        'UPDATE products SET image = ? WHERE id = ?',
        [imageUrl, productId]
      );
    } catch (err) {
      logger.error(`Image processing failed for product ${productId}:`, err);
      // Product created but without image, client will see error
      return errorResponse(res, 'Product created but image upload failed: ' + err.message, 400);
    }
  }

  logger.info(`Product created: ${name} (ID: ${productId})`);

  successResponse(res, {
    id: productId,
    name,
    price,
    image: imageUrl,
    available: isAvailable
  }, 'Menu item added successfully', 201);
});

// @desc    Update product
// @route   PATCH /api/products/:id
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, price, available } = req.body;

  // Check if product exists
  const products = await db.query(
    'SELECT id, image FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  const currentProduct = products[0];

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
  if (available !== undefined) {
    // Convert available to boolean (handle string "0", "1" from FormData)
    const isAvailable = available === false || available === '0' || available === 0 ? false : true;
    updateFields.push('available = ?');
    values.push(isAvailable);
  }

  // Handle image upload
  if (req.file) {
    try {
      // Delete old image if it's a URL (not an emoji)
      if (currentProduct.image && !currentProduct.image.match(/^[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]/u)) {
        await deleteProductImage(currentProduct.image);
      }
      // Process new image
      const newImageUrl = await processProductImage(req.file, id);
      updateFields.push('image = ?');
      values.push(newImageUrl);
    } catch (err) {
      logger.error(`Image processing failed for product ${id}:`, err);
      return errorResponse(res, 'Image upload failed: ' + err.message, 400);
    }
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

  successResponse(res, null, 'Menu item updated successfully');
});

// @desc    Delete product
// @route   DELETE /api/products/:id
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if product exists
  const products = await db.query(
    'SELECT id, image FROM products WHERE id = ?',
    [id]
  );

  if (products.length === 0) {
    return errorResponse(res, 'Product not found', 404);
  }

  const product = products[0];

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

  // Delete product image if it exists and is not an emoji
  if (product.image && !product.image.match(/^[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]/u)) {
    await deleteProductImage(product.image);
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
