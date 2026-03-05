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
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
