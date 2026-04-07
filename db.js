const mysql = require('mysql2/promise');
const config = require('./config');
const logger = require('./logger');

// Create connection pool
const pool = mysql.createPool(config.db);

const ensureTableColumn = async (connection, tableName, columnName, alterSql) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`
    ,
    [tableName, columnName]
  );

  if (columns.length > 0) {
    return;
  }

  logger.warn(`Missing ${tableName}.${columnName} column detected. Applying safe schema update.`);

  await connection.execute(alterSql);

  logger.info(`Schema update complete: added ${tableName}.${columnName} column.`);
};

const ensureColumnDefinition = async (connection, tableName, columnName, targetDefinition) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (columns.length === 0) {
    return;
  }

  const currentType = String(columns[0].COLUMN_TYPE || '').toLowerCase();
  const currentNullable = String(columns[0].IS_NULLABLE || '').toUpperCase();
  const normalizedCurrent = currentType.replace(/\(\d+\)/, '');
  const normalizedTarget = String(targetDefinition || '').toLowerCase().replace(/\(\d+\)/, '').split(' null')[0].split(' not null')[0];
  const expectsNull = normalizedTarget.includes(' null');
  const nullableMatches = expectsNull ? currentNullable === 'YES' : currentNullable === 'NO';

  if (normalizedCurrent === normalizedTarget && nullableMatches) {
    return;
  }

  logger.warn(`Column definition mismatch detected for ${tableName}.${columnName}. Aligning schema.`);
  await connection.execute(
    `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${targetDefinition}`
  );
  logger.info(`Column definition aligned for ${tableName}.${columnName}.`);
};

const getColumnDefinition = async (connection, tableName, columnName) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  if (columns.length === 0) {
    return null;
  }

  return {
    columnType: columns[0].COLUMN_TYPE,
    isNullable: columns[0].IS_NULLABLE === 'YES'
  };
};

const ensureColumnMatchesReferencedColumn = async (
  connection,
  tableName,
  columnName,
  referencedTable,
  referencedColumn,
  options = {}
) => {
  const localColumn = await getColumnDefinition(connection, tableName, columnName);
  if (!localColumn) {
    return;
  }

  const referenced = await getColumnDefinition(connection, referencedTable, referencedColumn);
  if (!referenced) {
    return;
  }

  const nullability = options.nullable === false ? 'NOT NULL' : 'NULL';
  const afterClause = options.after ? ` AFTER ${options.after}` : '';
  const targetDefinition = `${referenced.columnType} ${nullability}${afterClause}`;

  await ensureColumnDefinition(connection, tableName, columnName, targetDefinition);
};

const ensureUsersSchema = async (connection) => {
  await ensureTableColumn(
    connection,
    'users',
    'phone',
    'ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL AFTER role'
  );

  await ensureTableColumn(
    connection,
    'users',
    'created_at',
    'ALTER TABLE users ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
  );

  await ensureTableColumn(
    connection,
    'users',
    'updated_at',
    'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
  );
};

// Helper function to ensure foreign key constraint exists
const ensureForeignKey = async (connection, constraintName, tableName, checkSql) => {
  const [constraints] = await connection.execute(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  );

  if (constraints.length > 0) {
    return;
  }

  logger.warn(`Missing ${constraintName} constraint on ${tableName}. Adding foreign key.`);
  await connection.execute(checkSql);
  logger.info(`Foreign key created: ${constraintName} on ${tableName}.`);
};

const ensureTableEngineInnoDB = async (connection, tableName) => {
  const [tables] = await connection.execute(
    `SELECT ENGINE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  if (tables.length === 0) {
    return;
  }

  const currentEngine = tables[0].ENGINE;
  if (currentEngine !== 'InnoDB') {
    logger.warn(`${tableName} is not using InnoDB (${currentEngine}). Converting before applying foreign keys.`);
    await connection.execute(`ALTER TABLE ${tableName} ENGINE=InnoDB`);
    logger.info(`${tableName} now uses InnoDB engine (required for foreign keys).`);
  }
};

const ensureReplacesColumnDefinition = async (connection, columnType) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'orders'
       AND COLUMN_NAME = 'replaces_order_id'
     LIMIT 1`
  );

  if (columns.length === 0) {
    return;
  }

  await connection.execute(
    `ALTER TABLE orders MODIFY COLUMN replaces_order_id ${columnType} NULL AFTER delivery_id`
  );
};

const ensureStatusEnumIncludesRequiredValues = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'orders'
       AND COLUMN_NAME = 'status'
     LIMIT 1`
  );

  if (columns.length === 0) {
    return;
  }

  const columnType = columns[0].COLUMN_TYPE || '';
  const requiredValues = ['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered', 'replaced', 'cancelled'];
  const missingValues = requiredValues.filter((value) => !columnType.includes(`'${value}'`));

  if (missingValues.length > 0) {
    logger.warn(`orders.status enum is missing values (${missingValues.join(', ')}); updating.`);
    await connection.execute(
      "ALTER TABLE orders MODIFY COLUMN status ENUM('pending','paid','preparing','out_for_delivery','delivered','replaced','cancelled') NOT NULL DEFAULT 'pending'"
    );
    logger.info('Updated orders.status enum with required values.');
  }
};

const getOrdersIdColumnType = async (connection) => {
  const [columns] = await connection.execute(
    `SELECT COLUMN_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'orders'
       AND COLUMN_NAME = 'id'
     LIMIT 1`
  );

  if (columns.length === 0) {
    return 'INT';
  }

  return columns[0].COLUMN_TYPE;
};

const ensureOrdersSchema = async (connection) => {
  await ensureTableColumn(
    connection,
    'orders',
    'created_at',
    'ALTER TABLE orders ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
  );

  await ensureTableColumn(
    connection,
    'orders',
    'updated_at',
    'ALTER TABLE orders ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'
  );

  await ensureTableColumn(
    connection,
    'orders',
    'manager_read_at',
    'ALTER TABLE orders ADD COLUMN manager_read_at DATETIME NULL AFTER updated_at'
  );

  await ensureTableColumn(
    connection,
    'orders',
    'delivery_address',
    'ALTER TABLE orders ADD COLUMN delivery_address VARCHAR(500) NULL AFTER phone'
  );

  await ensureTableColumn(
    connection,
    'orders',
    'checkout_request_id',
    'ALTER TABLE orders ADD COLUMN checkout_request_id VARCHAR(100) NULL AFTER mpesa_receipt'
  );


  const replacesColumnType = await getOrdersIdColumnType(connection);

  await ensureTableColumn(
    connection,
    'orders',
    'replaces_order_id',
    `ALTER TABLE orders ADD COLUMN replaces_order_id ${replacesColumnType} NULL AFTER delivery_id`
  );

  await ensureReplacesColumnDefinition(connection, replacesColumnType);
  await ensureTableEngineInnoDB(connection, 'orders');
  await ensureIndex(
    connection,
    'orders',
    'idx_orders_replacement',
    'CREATE INDEX idx_orders_replacement ON orders (replaces_order_id)'
  );

  // Add foreign key constraint for replaces_order_id separately
  await ensureForeignKey(
    connection,
    'fk_orders_replacement',
    'orders',
    'ALTER TABLE orders ADD CONSTRAINT fk_orders_replacement FOREIGN KEY (replaces_order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE SET NULL'
  );

  await ensureTableColumn(
    connection,
    'orders',
    'paid_at',
    'ALTER TABLE orders ADD COLUMN paid_at DATETIME NULL AFTER notes'
  );

  await ensureStatusEnumIncludesRequiredValues(connection);
};

const ensureProductsSchema = async (connection) => {
  await ensureTableColumn(
    connection,
    'products',
    'category',
    "ALTER TABLE products ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'General' AFTER name"
  );
};

const ensureExpensesSchema = async (connection) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      notes TEXT NULL,
      expense_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_expenses_category (category),
      INDEX idx_expenses_expense_date (expense_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const ensureOrderCancellationSchema = async (connection) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS order_cancellations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NULL,
      reason VARCHAR(500) NOT NULL,
      cancelled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_admin_override BOOLEAN NOT NULL DEFAULT FALSE,
      admin_notes TEXT NULL,
      admin_id INT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cancellation_order (order_id),
      INDEX idx_cancellation_user (user_id),
      INDEX idx_cancellation_admin (admin_id),
      INDEX idx_cancellation_time (cancelled_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTableEngineInnoDB(connection, 'order_cancellations');

  await ensureTableColumn(
    connection,
    'order_cancellations',
    'admin_notes',
    'ALTER TABLE order_cancellations ADD COLUMN admin_notes TEXT NULL AFTER is_admin_override'
  );

  await ensureTableColumn(
    connection,
    'order_cancellations',
    'admin_id',
    'ALTER TABLE order_cancellations ADD COLUMN admin_id INT UNSIGNED NULL AFTER admin_notes'
  );

  await ensureColumnMatchesReferencedColumn(connection, 'order_cancellations', 'order_id', 'orders', 'id', {
    nullable: false,
    after: 'id'
  });
  await ensureColumnMatchesReferencedColumn(connection, 'order_cancellations', 'user_id', 'users', 'id', {
    nullable: true,
    after: 'order_id'
  });
  await ensureColumnMatchesReferencedColumn(connection, 'order_cancellations', 'admin_id', 'users', 'id', {
    nullable: true,
    after: 'admin_notes'
  });

  await ensureIndex(
    connection,
    'order_cancellations',
    'idx_cancellation_order',
    'CREATE INDEX idx_cancellation_order ON order_cancellations (order_id)'
  );
  await ensureIndex(
    connection,
    'order_cancellations',
    'idx_cancellation_user',
    'CREATE INDEX idx_cancellation_user ON order_cancellations (user_id)'
  );
  await ensureIndex(
    connection,
    'order_cancellations',
    'idx_cancellation_admin',
    'CREATE INDEX idx_cancellation_admin ON order_cancellations (admin_id)'
  );

  await ensureForeignKey(
    connection,
    'fk_cancellation_order',
    'order_cancellations',
    'ALTER TABLE order_cancellations ADD CONSTRAINT fk_cancellation_order FOREIGN KEY (order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE'
  );

  await ensureForeignKey(
    connection,
    'fk_cancellation_user',
    'order_cancellations',
    'ALTER TABLE order_cancellations ADD CONSTRAINT fk_cancellation_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL'
  );

  await ensureForeignKey(
    connection,
    'fk_cancellation_admin',
    'order_cancellations',
    'ALTER TABLE order_cancellations ADD CONSTRAINT fk_cancellation_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL'
  );
};

const ensureRefundRequestsSchema = async (connection) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS refund_requests (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      cancellation_id INT UNSIGNED NOT NULL,
      status ENUM('REQUESTED', 'APPROVED', 'DENIED', 'PROCESSED') NOT NULL DEFAULT 'REQUESTED',
      admin_id INT UNSIGNED NULL,
      admin_notes TEXT NULL,
      processed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_refund_status (status),
      INDEX idx_refund_cancellation (cancellation_id),
      INDEX idx_refund_processed (processed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTableEngineInnoDB(connection, 'refund_requests');

  await ensureColumnMatchesReferencedColumn(connection, 'refund_requests', 'cancellation_id', 'order_cancellations', 'id', {
    nullable: false,
    after: 'id'
  });
  await ensureColumnMatchesReferencedColumn(connection, 'refund_requests', 'admin_id', 'users', 'id', {
    nullable: true,
    after: 'status'
  });

  await ensureIndex(
    connection,
    'refund_requests',
    'idx_refund_cancellation',
    'CREATE INDEX idx_refund_cancellation ON refund_requests (cancellation_id)'
  );
  await ensureIndex(
    connection,
    'refund_requests',
    'idx_refund_admin',
    'CREATE INDEX idx_refund_admin ON refund_requests (admin_id)'
  );

  await ensureForeignKey(
    connection,
    'fk_refund_cancellation',
    'refund_requests',
    'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_cancellation FOREIGN KEY (cancellation_id) REFERENCES order_cancellations(id) ON UPDATE CASCADE ON DELETE CASCADE'
  );

  await ensureForeignKey(
    connection,
    'fk_refund_admin',
    'refund_requests',
    'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL'
  );
};

const ensureDriverLocationSchema = async (connection) => {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS driver_locations (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      delivery_id INT UNSIGNED NOT NULL,
      order_id INT UNSIGNED NULL,
      latitude DECIMAL(10,8) NOT NULL,
      longitude DECIMAL(11,8) NOT NULL,
      location_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_driver_delivery (delivery_id),
      INDEX idx_driver_locations_delivery (delivery_id),
      INDEX idx_driver_locations_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureTableEngineInnoDB(connection, 'driver_locations');
  await ensureColumnMatchesReferencedColumn(connection, 'driver_locations', 'delivery_id', 'users', 'id', {
    nullable: false,
    after: 'id'
  });
  await ensureColumnMatchesReferencedColumn(connection, 'driver_locations', 'order_id', 'orders', 'id', {
    nullable: true,
    after: 'delivery_id'
  });

  await ensureIndex(
    connection,
    'driver_locations',
    'idx_driver_locations_delivery',
    'CREATE INDEX idx_driver_locations_delivery ON driver_locations (delivery_id)'
  );
  await ensureIndex(
    connection,
    'driver_locations',
    'idx_driver_locations_order',
    'CREATE INDEX idx_driver_locations_order ON driver_locations (order_id)'
  );

  await ensureForeignKey(
    connection,
    'fk_driver_locations_delivery',
    'driver_locations',
    'ALTER TABLE driver_locations ADD CONSTRAINT fk_driver_locations_delivery FOREIGN KEY (delivery_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE'
  );

  await ensureForeignKey(
    connection,
    'fk_driver_locations_order',
    'driver_locations',
    'ALTER TABLE driver_locations ADD CONSTRAINT fk_driver_locations_order FOREIGN KEY (order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE SET NULL'
  );
};

const ensureIndex = async (connection, tableName, indexName, createIndexSql) => {
  const [indexes] = await connection.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (indexes.length > 0) {
    return;
  }

  logger.warn(`Missing index ${indexName} on ${tableName}. Creating for analytics performance.`);
  await connection.execute(createIndexSql);
  logger.info(`Index created: ${indexName} on ${tableName}.`);
};

const ensureAnalyticsIndexes = async (connection) => {
  await ensureIndex(
    connection,
    'orders',
    'idx_orders_status_created_at',
    'CREATE INDEX idx_orders_status_created_at ON orders (status, created_at)'
  );

  await ensureIndex(
    connection,
    'orders',
    'idx_orders_delivery_status_created_at',
    'CREATE INDEX idx_orders_delivery_status_created_at ON orders (delivery_id, status, created_at)'
  );

  await ensureIndex(
    connection,
    'orders',
    'idx_orders_checkout_request',
    'CREATE INDEX idx_orders_checkout_request ON orders (checkout_request_id)'
  );

  await ensureIndex(
    connection,
    'order_items',
    'idx_order_items_product_order',
    'CREATE INDEX idx_order_items_product_order ON order_items (product_id, order_id)'
  );
};

// Test database connection
const testConnection = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await ensureUsersSchema(connection);
    await ensureProductsSchema(connection);
    await ensureOrdersSchema(connection);
    await ensureExpensesSchema(connection);
    await ensureOrderCancellationSchema(connection);
    await ensureRefundRequestsSchema(connection);
    await ensureDriverLocationSchema(connection);
    await ensureAnalyticsIndexes(connection);
    logger.info('Database connected successfully');
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Execute query with parameters
const query = async (sql, params) => {
  try {
    const [results] = await pool.execute(sql, params);
    return results;
  } catch (error) {
    if (error.code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || error.code === 'ER_ACCESS_DENIED_ERROR') {
      logger.error(
        'Database authentication failed. Set valid DB_USER/DB_PASSWORD in .env (or env.env) and ensure that user has access to DB_NAME.'
      );
    }
    logger.error('Database query error:', error);
    throw error;
  }
};

// Get a connection from pool (for transactions)
const getConnection = async () => {
  try {
    const connection = await pool.getConnection();
    return connection;
  } catch (error) {
    logger.error('Error getting database connection:', error);
    throw error;
  }
};

// Begin transaction
const beginTransaction = async (connection) => {
  await connection.beginTransaction();
};

// Commit transaction
const commit = async (connection) => {
  await connection.commit();
};

// Rollback transaction
const rollback = async (connection) => {
  await connection.rollback();
};

module.exports = {
  pool,
  query,
  getConnection,
  beginTransaction,
  commit,
  rollback,
  testConnection
};
