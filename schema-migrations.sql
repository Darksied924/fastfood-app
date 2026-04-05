-- Migration: Add order cancellation support
-- Run: mysql -u root -p fastfood_db < schema-migrations.sql

USE fastfood_db;

-- Add 'cancelled' status to orders
ALTER TABLE orders 
MODIFY COLUMN status ENUM(
  'pending', 'paid', 'preparing', 'out_for_delivery', 
  'delivered', 'replaced', 'cancelled'
) NOT NULL DEFAULT 'pending';

-- Create order_cancellations table
CREATE TABLE IF NOT EXISTS order_cancellations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,  -- NULL for admin overrides
  reason VARCHAR(500) NOT NULL,
  cancelled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_admin_override BOOLEAN NOT NULL DEFAULT FALSE,
  admin_notes TEXT NULL,
  admin_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cancellation_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_cancellation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_cancellation_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cancellation_order (order_id),
  INDEX idx_cancellation_user (user_id),
  INDEX idx_cancellation_time (cancelled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create refund_requests table
CREATE TABLE IF NOT EXISTS refund_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cancellation_id INT UNSIGNED NOT NULL,
  status ENUM('REQUESTED', 'APPROVED', 'DENIED', 'PROCESSED') NOT NULL DEFAULT 'REQUESTED',
  admin_id INT UNSIGNED NULL,
  admin_notes TEXT NULL,
  processed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_refund_cancellation FOREIGN KEY (cancellation_id) REFERENCES order_cancellations(id) ON DELETE CASCADE,
  CONSTRAINT fk_refund_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_refund_status (status),
  INDEX idx_refund_cancellation (cancellation_id),
  INDEX idx_refund_processed (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- orders.status is already indexed in the base schema and db bootstrap.
-- MySQL does not support partial indexes with WHERE here, so no extra
-- cancelled-only index is required for this migration.

-- Verify tables created
SHOW TABLES LIKE '%cancel%';
SHOW TABLES LIKE 'refund%';
DESCRIBE order_cancellations;
DESCRIBE refund_requests;
