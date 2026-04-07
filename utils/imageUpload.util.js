const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Create uploads directories if they don't exist
const uploadDirs = [
  path.join(__dirname, '../public/images/products'),
  path.join(__dirname, '../public/images/temp')
];

uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/images/temp'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'temp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (JPEG, PNG, WebP, GIF)'), false);
  }
};

// Multer upload instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

/**
 * Process and save product image
 * @param {Object} file - Uploaded file object
 * @param {string} productId - Product ID for naming
 * @returns {Promise<string>} - Path to saved image
 */
const processProductImage = async (file, productId) => {
  if (!file) {
    throw new Error('No file provided');
  }

  const filename = `product-${productId}-${Date.now()}.webp`;
  const filePath = path.join(__dirname, `../public/images/products/${filename}`);

  // Resize and convert to WebP for optimization
  await sharp(file.path)
    .resize(500, 500, {
      fit: 'cover',
      position: 'center'
    })
    .webp({ quality: 80 })
    .toFile(filePath);

  // Delete temporary file
  fs.unlink(file.path, (err) => {
    if (err) console.error('Error deleting temp file:', err);
  });

  return `/images/products/${filename}`;
};

/**
 * Delete product image
 * @param {string} imagePath - Relative path to image
 */
const deleteProductImage = async (imagePath) => {
  if (!imagePath) return;

  const fullPath = path.join(__dirname, `../public${imagePath}`);

  fs.unlink(fullPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('Error deleting image:', err);
    }
  });
};

module.exports = {
  upload,
  processProductImage,
  deleteProductImage
};
