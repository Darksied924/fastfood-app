-- Fixed Migration: Add order cancellation support (type-safe)
-- Run: mysql -u root -p fastfood_db < schema-migrations.sql
-- Safe: No data loss, IF NOT EXISTS, matches schema.sql types

USE fastfood_db;

-- Create order_cancellations table (matches schema.sql INT PKs)
CREATE TABLE IF NOT EXISTS order_cancellations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NULL,  -- NULL for admin overrides
  reason VARCHAR(500) NOT NULL,
  cancelled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_admin_override BOOLEAN NOT NULL DEFAULT FALSE,
  admin_notes TEXT NULL,
  admin_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cancellation_order 
    FOREIGN KEY (order_id) REFERENCES orders(id) 
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cancellation_user 
    FOREIGN KEY (user_id) REFERENCES users(id) 
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cancellation_admin 
    FOREIGN KEY (admin_id) REFERENCES users(id) 
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_cancellation_time (cancelled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create refund_requests table
CREATE TABLE IF NOT EXISTS refund_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cancellation_id INT NOT NULL,
  status ENUM('REQUESTED', 'APPROVED', 'DENIED', 'PROCESSED') NOT NULL DEFAULT 'REQUESTED',
  admin_id INT NULL,
  admin_notes TEXT NULL,
  processed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_refund_cancellation 
    FOREIGN KEY (cancellation_id) REFERENCES order_cancellations(id) 
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_refund_admin 
    FOREIGN KEY (admin_id) REFERENCES users(id) 
    ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_refund_status (status),
  INDEX idx_refund_processed (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: orders.status ENUM and indexes already correct in schema.sql
-- Migration is now idempotent and type-consistent
