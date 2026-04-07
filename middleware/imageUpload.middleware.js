const { processProductImage, deleteProductImage } = require('../utils/imageUpload.util');
const logger = require('../logger');

/**
 * Middleware to handle product image upload and processing
 */
const handleProductImageUpload = async (req, res, next) => {
  try {
    if (!req.file) {
      return next();
    }

    // Store file info for later processing
    req.uploadedFile = req.file;
    next();
  } catch (err) {
    logger.error('Image upload middleware error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Image upload failed'
    });
  }
};

/**
 * Middleware to validate image file size and type before processing
 */
const validateImageFile = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  if (req.file.size > maxSize) {
    return res.status(400).json({
      success: false,
      message: 'File size exceeds 5MB limit'
    });
  }

  if (!allowedMimes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed'
    });
  }

  next();
};

/**
 * Middleware to process uploaded image after controller saves to DB
 */
const processUploadedImage = async (req, res, next) => {
  try {
    if (!req.uploadedFile || !req.savedProductId) {
      return next();
    }

    const imagePath = await processProductImage(req.uploadedFile, req.savedProductId);
    req.processedImagePath = imagePath;
    next();
  } catch (err) {
    logger.error('Image processing error:', err);
    return res.status(500).json({
      success: false,
      message: 'Image processing failed',
      error: err.message
    });
  }
};

module.exports = {
  handleProductImageUpload,
  validateImageFile,
  processUploadedImage
};
