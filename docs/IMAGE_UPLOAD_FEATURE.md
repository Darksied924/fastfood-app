# Restaurant Image Upload Feature

## Overview
Your fastfood-app now supports uploading and serving product images! Images are automatically validated, resized, and optimized for web performance.

## Features
✅ Image upload via admin dashboard  
✅ Automatic image resizing (500x500px)  
✅ WebP conversion for optimal performance  
✅ Image validation (JPEG, PNG, WebP, GIF)  
✅ File size limit: 5MB  
✅ Automatic image deletion when products are removed  
✅ Image preview in admin interface  

## Technical Details

### Packages Added
- **multer**: File upload middleware for handling multipart/form-data
- **sharp**: Image processing library for resizing and format conversion

### New Files Created
1. **utils/imageUpload.util.js** - Image processing utilities
2. **middleware/imageUpload.middleware.js** - Image upload middleware
3. **public/images/products/** - Directory for stored product images
4. **public/images/temp/** - Temporary directory for processing

### Modified Files
1. **controllers/products.controller.js** - Added image upload handling to create/update/delete operations
2. **routes/products.routes.js** - Added multer middleware to image routes
3. **public/admin-products.html** - Updated forms to include file input
4. **public/js/admin-products.js** - Added image preview and FormData handling
5. **public/js/api.js** - Updated to handle FormData in API calls

## API Endpoints

### Create Product with Image
```bash
POST /api/products
Content-Type: multipart/form-data

Form Data:
- name: string (required)
- price: number (required)
- image: file (optional, max 5MB)
- available: boolean (default: true)
```

### Update Product with Image
```bash
PATCH /api/products/:id
Content-Type: multipart/form-data

Form Data:
- name: string (optional)
- price: number (optional)
- image: file (optional, max 5MB)
- available: boolean (optional)
```

## How to Use (Admin Dashboard)

### Adding a Product with Image:
1. Click **"+ Add Product"** button
2. Fill in product name and price
3. Select an image file (JPG, PNG, WebP, or GIF - max 5MB)
4. Preview will appear below the file input
5. Check "Available" if product is in stock
6. Click **"Create Product"**

### Updating a Product Image:
1. Click **"Edit Product"** button
2. Select the product from the dropdown
3. Optionally select a new image file
4. Current image will display
5. Click **"Save Changes"**

### Deleting a Product with Image:
1. Click **"Edit Product"** button
2. Select the product
3. Click **"Delete Product"**
4. The image file will be automatically deleted from server

## Image Storage and Serving

**Images are stored at:**
- `/public/images/products/` - Persistent storage
- `/public/images/temp/` - Temporary processing directory

**Images are served at:**
- URL format: `/images/products/product-{productId}-{timestamp}.webp`
- Example: `/images/products/product-5-1702123456789.webp`

## Performance Optimization

Images are automatically:
1. **Resized** to 500x500px (center crop)
2. **Converted** to WebP format (80% quality)
3. **Indexed** in database for fast retrieval

Expected file sizes:
- Original: 2-5MB
- Processed: 20-50KB

## Error Handling

The system handles various errors gracefully:
- File too large (>5MB)
- Invalid file type
- Image processing failures
- Missing files

Errors are logged and returned with descriptive messages.

## Database Updates

**Product Schema** (existing):
```sql
CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  image VARCHAR(255),  -- Now stores URL path or emoji
  available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

No schema changes required - the `image` field stores either emoji or image URL paths.

## Security Considerations

✅ File type validation (MIME type + extension)  
✅ File size limit enforced  
✅ Authentication required (admin/manager only)  
✅ Uploads to temporary directory, processed files in public  
✅ Unique filenames include product ID and timestamp  
✅ No access to parent directories (path traversal protection)  

## Future Enhancements

Possible improvements:
- [ ] Image compression optimization
- [ ] Multiple images per product (gallery)
- [ ] Image cropping/editing in UI
- [ ] S3/Cloud storage integration
- [ ] Image optimization service
- [ ] Batch image upload

## Troubleshooting

### Images not appearing
- Check file permissions on `/public/images/products/`
- Verify image file isn't corrupted
- Check browser console for errors
- Verify file was actually uploaded

### Upload fails with "File too large"
- Maximum 5MB per image
- Compress or resize image before uploading
- Use JPG format instead of PNG

### Images deleted accidentally
- Images are only deleted when product is hard deleted
- Products with orders are soft deleted (made unavailable)
- Backup directory: `/public/images/products/` persists in file system

## Support

For issues or questions about the image upload feature, check:
1. Server logs in `logs/` directory
2. Browser developer console (F12)
3. Product database validation

---

**Last Updated:** 2024
**Feature Status:** Beta
