const db = require('../db');
const logger = require('../logger');
const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/response.util');
const orderService = require('../services/order.service');
const locationService = require('../services/location.service');
const config = require('../config');
const { emitToUser, emitToDelivery, emitToRole } = require('../socket');

// @desc    Create new order
// @route   POST /api/orders
const createOrder = asyncHandler(async (req, res) => {
  const { items, total, phone, deliveryAddress, replacesOrderId } = req.body;
  const userId = req.user.id;
  const replacementOrderId = replacesOrderId ? Number(replacesOrderId) : null;

  if (!items || items.length === 0) {
    return errorResponse(res, 'Order must contain items', 400);
  }

  if (replacementOrderId) {
    const existingOrder = await db.query(
      'SELECT id, status FROM orders WHERE id = ? AND user_id = ?',
      [replacementOrderId, userId]
    );

    if (existingOrder.length === 0) {
      return errorResponse(res, 'Order to edit was not found', 404);
    }

    if (existingOrder[0].status !== 'pending') {
      return errorResponse(res, 'Only pending orders can be edited', 400);
    }
  }

  // Create order with transaction
  const order = await orderService.createOrder(userId, items, total, phone, deliveryAddress, {
    replacesOrderId: replacementOrderId
  });

  logger.info(`Order created: ${order.id} by user: ${userId}`);

  successResponse(res, order, 'Order created successfully', 201);
});

// @desc    Get all orders (admin/manager)
// @route   GET /api/orders
const getAllOrders = asyncHandler(async (req, res) => {
  const { status } = req.query;

  let query = `
    SELECT o.*, 
           u.name as customer_name, 
           u.email as customer_email,
           d.name as delivery_name,
           o.delivery_address
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN users d ON o.delivery_id = d.id
  `;
  
  const params = [];

  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.created_at DESC';

  const orders = await db.query(query, params);

  // Get items for each order
  for (let order of orders) {
    const items = await db.query(
      `SELECT oi.*, p.name as product_name, p.image 
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    order.items = items;
  }

  successResponse(res, orders);
});

// @desc    Get user's orders
// @route   GET /api/orders/my-orders
const getMyOrders = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const paymentWindowMs = config.mpesa.stkPaymentWindowMs;

  const orders = await db.query(
    `SELECT o.id, o.user_id, o.delivery_id, o.total, o.status, o.delivery_address, o.created_at, o.updated_at,
            o.phone,
            o.paid_at,
            o.checkout_request_id,
            d.name as delivery_name,
            (
              SELECT oc.reason
              FROM order_cancellations oc
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC, oc.id DESC
              LIMIT 1
            ) AS cancellation_reason,
            (
              SELECT oc.cancelled_at
              FROM order_cancellations oc
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC, oc.id DESC
              LIMIT 1
            ) AS cancelled_at,
            (
              SELECT rr.status
              FROM refund_requests rr
              JOIN order_cancellations oc ON rr.cancellation_id = oc.id
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC, oc.id DESC
              LIMIT 1
            ) AS refund_status,
            (
              SELECT rr.admin_notes
              FROM refund_requests rr
              JOIN order_cancellations oc ON rr.cancellation_id = oc.id
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC, oc.id DESC
              LIMIT 1
            ) AS refund_admin_notes,
            (
              SELECT rr.processed_at
              FROM refund_requests rr
              JOIN order_cancellations oc ON rr.cancellation_id = oc.id
              WHERE oc.order_id = o.id
              ORDER BY oc.cancelled_at DESC, oc.id DESC
              LIMIT 1
            ) AS refund_processed_at
     FROM orders o
     LEFT JOIN users d ON o.delivery_id = d.id
     WHERE o.user_id = ?
       AND o.status <> 'replaced'
     ORDER BY o.created_at DESC`,
    [userId]
  );

  // Get items for each order
  for (let order of orders) {
    try {
      const items = await db.query(
        `SELECT oi.id, oi.product_id, oi.quantity, oi.price, p.name as product_name, p.image 
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [order.id]
      );
      order.items = items;
    } catch (itemError) {
      logger.error('Error fetching order items:', itemError);
      order.items = [];
    }

    const hasPendingPaymentRequest = order.status === 'pending' && Boolean(order.checkout_request_id);
    const paymentRequestedAt = hasPendingPaymentRequest && order.updated_at
      ? new Date(order.updated_at)
      : null;
    const paymentExpiresAt = paymentRequestedAt
      ? new Date(paymentRequestedAt.getTime() + paymentWindowMs)
      : null;
    const paymentInProgress = Boolean(
      paymentRequestedAt &&
      paymentExpiresAt &&
      paymentExpiresAt.getTime() > Date.now()
    );

    order.payment_requested_at = paymentRequestedAt ? paymentRequestedAt.toISOString() : null;
    order.payment_expires_at = paymentExpiresAt ? paymentExpiresAt.toISOString() : null;
    order.payment_in_progress = paymentInProgress;
    order.payment_window_ms = paymentWindowMs;
  }

  successResponse(res, orders);
});

// @desc    Get single order
// @route   GET /api/orders/:id
const getOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Get order
  const orders = await db.query(
    `SELECT o.*, 
            u.name as customer_name, 
            u.email as customer_email,
            d.name as delivery_name
     FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
     LEFT JOIN users d ON o.delivery_id = d.id
     WHERE o.id = ?`,
    [id]
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found', 404);
  }

  const order = orders[0];

  if (order.status === 'replaced' && userRole === 'customer') {
    return errorResponse(res, 'Order not found', 404);
  }

  // Check authorization (customers can only view their own orders)
  if (userRole === 'customer' && order.user_id !== userId) {
    return errorResponse(res, 'Not authorized to view this order', 403);
  }

  // Role-based visibility for delivery address and order value
  const isAuthorizedRole = ['admin', 'manager'].includes(userRole);
  const isAssignedDelivery = userRole === 'delivery' && order.delivery_id === userId;
  
  if (isAuthorizedRole || isAssignedDelivery) {
    order.delivery_address = order.delivery_address;
  } else {
    // Remove delivery_address for unauthorized roles
    delete order.delivery_address;
  }

  // Remove order value and payment details for delivery personnel
  if (userRole === 'delivery') {
    delete order.total;
    delete order.phone;
    delete order.mpesa_receipt;
    delete order.notes;
  }

  // Get order items
  const items = await db.query(
    `SELECT oi.*, p.name as product_name, p.image 
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ?`,
    [id]
  );

  // Remove price from items for delivery personnel
  if (userRole === 'delivery') {
    order.items = items.map(item => ({
      quantity: item.quantity,
      product_name: item.product_name,
      image: item.image
    }));
  } else {
    order.items = items;
  }

  successResponse(res, order);
});

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userRole = req.user.role;
  const userId = req.user.id;

  const validStatuses = ['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered'];
  
  if (!validStatuses.includes(status)) {
    return errorResponse(res, 'Invalid status', 400);
  }

  // Check if order exists
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ?',
    [id]
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found', 404);
  }

  const order = orders[0];

  if (userRole !== 'admin') {
    if (order.status === status) {
      return successResponse(res, null, 'Order status already up to date');
    }

    // Manager workflow:
    // paid -> preparing (mark as read/start prep)
    if (!(order.status === 'paid' && status === 'preparing')) {
      return errorResponse(
        res,
        'Managers can only move orders from paid to preparing. Use assignment to move preparing to out_for_delivery.',
        400
      );
    }
  }

  if (status === 'preparing') {
    await db.query(
      'UPDATE orders SET status = ?, manager_read_at = COALESCE(manager_read_at, NOW()) WHERE id = ?',
      [status, id]
    );
  } else {
    await db.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      [status, id]
    );
  }

  logger.info(`Order ${id} status updated to ${status} by ${userRole}:${userId}`);

  emitToUser(order.user_id, 'orderStatusUpdated', {
    orderId: Number(id),
    status,
    userId: order.user_id,
    deliveryId: order.delivery_id || null
  });

  if (order.delivery_id) {
    emitToDelivery(order.delivery_id, 'orderStatusUpdated', {
      orderId: Number(id),
      status,
      userId: order.user_id,
      deliveryId: order.delivery_id
    });
  }

  if (status === 'paid') {
    emitToUser(order.user_id, 'paymentConfirmed', {
      orderId: Number(id),
      status: 'paid'
    });
  }

  successResponse(res, null, 'Order status updated successfully');
});

// @desc    Assign delivery to order
// @route   POST /api/orders/:id/assign
const assignDelivery = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { deliveryId } = req.body;
  const userRole = req.user.role;

  // Check if order exists
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ?',
    [id]
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found', 404);
  }

  // Check if delivery user exists and has delivery role
  const deliveryUsers = await db.query(
    'SELECT id FROM users WHERE id = ? AND role = ?',
    [deliveryId, 'delivery']
  );

  if (deliveryUsers.length === 0) {
    return errorResponse(res, 'Delivery user not found', 404);
  }

  // Assign delivery
  if (userRole !== 'admin' && orders[0].status !== 'preparing') {
    return errorResponse(res, 'Managers can only assign delivery for orders in preparing status', 400);
  }

  let nextStatus = orders[0].status;

  if (orders[0].status !== 'delivered') {
    nextStatus = 'out_for_delivery';
  }

  await db.query(
    'UPDATE orders SET delivery_id = ?, status = ?, manager_read_at = COALESCE(manager_read_at, NOW()) WHERE id = ?',
    [deliveryId, nextStatus, id]
  );

  logger.info(`Order ${id} assigned to delivery user ${deliveryId} and moved to ${nextStatus}`);

  emitToDelivery(deliveryId, 'deliveryAssigned', {
    orderId: Number(id),
    status: nextStatus,
    userId: orders[0].user_id,
    deliveryId
  });

  emitToUser(orders[0].user_id, 'orderStatusUpdated', {
    orderId: Number(id),
    status: nextStatus,
    userId: orders[0].user_id,
    deliveryId
  });

  successResponse(res, null, 'Delivery assigned successfully');
});

// @desc    Get assigned orders for delivery
// @route   GET /api/orders/delivery/assigned
const getAssignedOrders = asyncHandler(async (req, res) => {
  const deliveryId = req.user.id;

  const orders = await db.query(
    `SELECT o.id, o.user_id, o.delivery_id, o.status, o.delivery_address, o.created_at, o.updated_at,
            u.name as customer_name,
            u.email as customer_email,
            u.phone as customer_phone
     FROM orders o
     JOIN users u ON o.user_id = u.id
     WHERE o.delivery_id = ? AND o.status IN ('preparing', 'out_for_delivery')
     ORDER BY o.created_at DESC`,
    [deliveryId]
  );

  // Get items for each order (without prices - delivery personnel cannot see payment details)
  for (let order of orders) {
    const items = await db.query(
      `SELECT oi.quantity, p.name as product_name, p.image 
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    order.items = items;
    // Remove total field - delivery personnel should not see order value
    delete order.total;
    delete order.phone;
    delete order.mpesa_receipt;
    delete order.notes;
  }

  successResponse(res, orders);
});

// @desc    Mark order as delivered
// @route   PATCH /api/orders/:id/delivered
const markAsDelivered = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deliveryId = req.user.id;

  // Check if order exists and assigned to this delivery
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ? AND delivery_id = ?',
    [id, deliveryId]
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found or not assigned to you', 404);
  }

  if (orders[0].status !== 'out_for_delivery') {
    return errorResponse(res, 'Only out_for_delivery orders can be marked as delivered', 400);
  }

  // Update status to delivered
  await db.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    ['delivered', id]
  );

  logger.info(`Order ${id} marked as delivered by delivery user ${deliveryId}`);

  emitToDelivery(deliveryId, 'orderStatusUpdated', {
    orderId: Number(id),
    status: 'delivered',
    userId: orders[0].user_id,
    deliveryId
  });

  emitToUser(orders[0].user_id, 'orderStatusUpdated', {
    orderId: Number(id),
    status: 'delivered',
    userId: orders[0].user_id,
    deliveryId
  });

  successResponse(res, null, 'Order marked as delivered');
});

// @desc    Get delivery personnel list (admin/manager)
// @route   GET /api/orders/delivery-personnel
const getDeliveryPersonnel = asyncHandler(async (req, res) => {
  const deliveryUsers = await db.query(
    'SELECT id, name, email FROM users WHERE role = ? ORDER BY name ASC',
    ['delivery']
  );

  successResponse(res, deliveryUsers);
});

const SALES_STATUSES = ['paid', 'preparing', 'out_for_delivery', 'delivered'];
const SALES_STATUSES_SQL = SALES_STATUSES.map((status) => `'${status}'`).join(', ');
const TRACKING_STALE_THRESHOLD_MS = 4 * 60 * 1000;

const getTrackingStatusMeta = (order, location = null) => {
  const orderStatus = String(order?.status || '').toLowerCase();

  if (orderStatus === 'delivered') {
    return { code: 'arrived', label: 'Arrived', etaLabel: 'Arrived', etaMinutes: 0 };
  }

  if (orderStatus === 'cancelled') {
    return { code: 'cancelled', label: 'Cancelled', etaLabel: 'Unavailable', etaMinutes: null };
  }

  if (orderStatus !== 'out_for_delivery') {
    return { code: 'awaiting_dispatch', label: 'Awaiting dispatch', etaLabel: 'Dispatch pending', etaMinutes: null };
  }

  if (!location?.locationTime) {
    return { code: 'en_route', label: 'En route', etaLabel: 'ETA updating live', etaMinutes: null };
  }

  const locationTime = new Date(location.locationTime);
  const locationTimeMs = locationTime.getTime();
  const ageMs = Number.isFinite(locationTimeMs) ? Date.now() - locationTimeMs : 0;

  if (Number.isFinite(ageMs) && ageMs > TRACKING_STALE_THRESHOLD_MS) {
    return { code: 'delayed', label: 'Delayed', etaLabel: 'ETA delayed', etaMinutes: null };
  }

  return { code: 'en_route', label: 'En route', etaLabel: 'ETA updating live', etaMinutes: null };
};

const buildTrackedPersonnelPayload = (order, location = null) => {
  const trackingMeta = getTrackingStatusMeta(order, location);

  return {
    deliveryId: order.delivery_id || null,
    deliveryName: order.delivery_name || null,
    orderId: order.id,
    status: trackingMeta.code,
    statusLabel: trackingMeta.label,
    etaLabel: trackingMeta.etaLabel,
    etaMinutes: trackingMeta.etaMinutes,
    assignedDestination: order.delivery_address || 'Not available',
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    locationTime: location?.locationTime || null
  };
};

const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toSqlDateTime = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

const resolveRange = ({ startDate, endDate, preset = '' }) => {
  const now = new Date();
  const selectedPreset = String(preset || '').toLowerCase();
  let start = normalizeDate(startDate);
  let end = normalizeDate(endDate);

  if (!start || !end) {
    if (selectedPreset === 'today') {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (selectedPreset === 'week') {
      const day = (now.getDay() + 6) % 7; // Monday as week start
      const monday = new Date(now);
      monday.setDate(now.getDate() - day);
      start = startOfDay(monday);
      end = endOfDay(now);
    } else if (selectedPreset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = endOfDay(now);
    } else if (selectedPreset === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = endOfDay(now);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      end = endOfDay(now);
    }
  }

  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return {
    start,
    end,
    startSql: toSqlDateTime(start),
    endSql: toSqlDateTime(end)
  };
};

const toNumber = (value) => Number(value || 0);
const DELIVERY_ON_TIME_TARGET_MINUTES = 45;
const DELIVERY_POTENTIAL_MISS_THRESHOLD_MINUTES = 120;

// @desc    Get delivery dashboard data (delivery role)
// @route   GET /api/orders/delivery/dashboard
const getDeliveryDashboard = asyncHandler(async (req, res) => {
  const deliveryId = req.user.id;
  const search = String(req.query.search || '').trim();
  const compareBy = String(req.query.compareBy || 'weekly').toLowerCase() === 'monthly'
    ? 'monthly'
    : 'weekly';
  const commissionRate = Number(req.query.commissionRate);
  const hasCommissionRate = Number.isFinite(commissionRate) && commissionRate > 0;
  const normalizedCommissionRate = hasCommissionRate ? Math.min(commissionRate, 100) : 0;
  const hasDateFilter =
    Boolean(req.query.startDate) ||
    Boolean(req.query.endDate) ||
    Boolean(req.query.preset);
  const range = hasDateFilter
    ? resolveRange({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      preset: req.query.preset || ''
    })
    : {
      start: new Date(0),
      end: new Date(),
      startSql: '1970-01-01 00:00:00',
      endSql: toSqlDateTime(new Date())
    };

  const assignedOrders = await db.query(
    `
      SELECT
        o.id,
        u.name AS customer_name,
        COALESCE(NULLIF(TRIM(o.delivery_address), ''), 'N/A') AS address,
        o.updated_at AS assigned_at,
        o.status,
        o.created_at,
        o.updated_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.delivery_id = ?
        AND o.status IN ('preparing', 'out_for_delivery')
      ORDER BY o.updated_at DESC
    `,
    [deliveryId]
  );

  const deliveredOrders = await db.query(
    `
      SELECT
        o.id,
        u.name AS customer_name,
        COALESCE(NULLIF(TRIM(o.delivery_address), ''), 'N/A') AS address,
        COALESCE(o.manager_read_at, o.created_at) AS assigned_at,
        o.updated_at AS delivered_at,
        TIMESTAMPDIFF(MINUTE, o.created_at, o.updated_at) AS delivery_duration_minutes,
        o.status
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.delivery_id = ?
        AND o.status = 'delivered'
        AND o.updated_at BETWEEN ? AND ?
        AND (? = '' OR CAST(o.id AS CHAR) LIKE ? OR u.name LIKE ?)
      ORDER BY o.updated_at DESC
      LIMIT 250
    `,
    [
      deliveryId,
      range.startSql,
      range.endSql,
      search,
      `%${search}%`,
      `%${search}%`
    ]
  );

  const metricRows = await db.query(
    `
      SELECT
        (SELECT COUNT(*) FROM orders WHERE delivery_id = ? AND status = 'delivered') AS total_deliveries_all_time,
        (SELECT COUNT(*) FROM orders WHERE delivery_id = ? AND status = 'delivered' AND DATE(updated_at) = CURDATE()) AS deliveries_today,
        (SELECT COUNT(*) FROM orders WHERE delivery_id = ? AND status = 'delivered' AND YEARWEEK(updated_at, 1) = YEARWEEK(CURDATE(), 1)) AS deliveries_this_week,
        (SELECT COUNT(*) FROM orders WHERE delivery_id = ? AND status = 'delivered' AND YEAR(updated_at) = YEAR(CURDATE()) AND MONTH(updated_at) = MONTH(CURDATE())) AS deliveries_this_month,
        (SELECT COALESCE(AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at)), 0) FROM orders WHERE delivery_id = ? AND status = 'delivered') AS avg_delivery_time_minutes,
        (SELECT COALESCE(MIN(TIMESTAMPDIFF(MINUTE, created_at, updated_at)), 0) FROM orders WHERE delivery_id = ? AND status = 'delivered') AS fastest_delivery_time_minutes,
        (
          SELECT COALESCE(
            (
              SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, created_at, updated_at) <= ? THEN 1 ELSE 0 END)
              / NULLIF(COUNT(*), 0)
            ) * 100,
            0
          )
          FROM orders
          WHERE delivery_id = ? AND status = 'delivered'
        ) AS on_time_rate,
        (SELECT COUNT(*) FROM orders WHERE delivery_id = ? AND status = 'delivered' AND updated_at BETWEEN ? AND ?) AS range_deliveries,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE delivery_id = ? AND status = 'delivered' AND updated_at BETWEEN ? AND ?) AS range_sales
    `,
    [
      deliveryId,
      deliveryId,
      deliveryId,
      deliveryId,
      deliveryId,
      deliveryId,
      DELIVERY_ON_TIME_TARGET_MINUTES,
      deliveryId,
      deliveryId,
      range.startSql,
      range.endSql,
      deliveryId,
      range.startSql,
      range.endSql
    ]
  );

  const trendRows = await db.query(
    `
      SELECT
        DATE(updated_at) AS day,
        DATE_FORMAT(updated_at, '%Y-%m-%d') AS label,
        COUNT(*) AS deliveries
      FROM orders
      WHERE delivery_id = ?
        AND status = 'delivered'
        AND updated_at BETWEEN ? AND ?
      GROUP BY day, label
      ORDER BY day ASC
    `,
    [deliveryId, range.startSql, range.endSql]
  );

  const comparisonRows = compareBy === 'monthly'
    ? await db.query(
      `
        SELECT
          DATE_FORMAT(updated_at, '%Y-%m') AS bucket_key,
          DATE_FORMAT(updated_at, '%b %Y') AS label,
          COUNT(*) AS deliveries
        FROM orders
        WHERE delivery_id = ?
          AND status = 'delivered'
          AND updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY bucket_key, label
        ORDER BY bucket_key ASC
      `,
      [deliveryId]
    )
    : await db.query(
      `
        SELECT
          YEARWEEK(updated_at, 1) AS bucket_key,
          CONCAT('W', LPAD(WEEK(updated_at, 1), 2, '0'), ' ', YEAR(updated_at)) AS label,
          COUNT(*) AS deliveries
        FROM orders
        WHERE delivery_id = ?
          AND status = 'delivered'
          AND updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
        GROUP BY bucket_key, label
        ORDER BY bucket_key ASC
      `,
      [deliveryId]
    );

  const pieRows = await db.query(
    `
      SELECT
        SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, created_at, updated_at) <= ? THEN 1 ELSE 0 END) AS on_time,
        SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, created_at, updated_at) > ? THEN 1 ELSE 0 END) AS late
      FROM orders
      WHERE delivery_id = ?
        AND status = 'delivered'
        AND updated_at BETWEEN ? AND ?
    `,
    [
      DELIVERY_ON_TIME_TARGET_MINUTES,
      DELIVERY_ON_TIME_TARGET_MINUTES,
      deliveryId,
      range.startSql,
      range.endSql
    ]
  );

  const durationTrendRows = await db.query(
    `
      SELECT
        DATE(updated_at) AS day,
        DATE_FORMAT(updated_at, '%Y-%m-%d') AS label,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, created_at, updated_at)), 0) AS avg_minutes
      FROM orders
      WHERE delivery_id = ?
        AND status = 'delivered'
        AND updated_at BETWEEN ? AND ?
      GROUP BY day, label
      ORDER BY day ASC
    `,
    [deliveryId, range.startSql, range.endSql]
  );

  const peakHoursRows = await db.query(
    `
      SELECT
        HOUR(updated_at) AS hour_of_day,
        COUNT(*) AS deliveries
      FROM orders
      WHERE delivery_id = ?
        AND status = 'delivered'
      GROUP BY hour_of_day
      ORDER BY deliveries DESC, hour_of_day ASC
      LIMIT 5
    `,
    [deliveryId]
  );

  const missedRows = await db.query(
    `
      SELECT
        SUM(
          CASE
            WHEN status = 'out_for_delivery'
              AND TIMESTAMPDIFF(MINUTE, COALESCE(manager_read_at, created_at), NOW()) > ?
            THEN 1 ELSE 0
          END
        ) AS potentially_missed,
        SUM(
          CASE
            WHEN status IN ('pending', 'paid', 'preparing')
            THEN 1 ELSE 0
          END
        ) AS reassigned_or_returned
      FROM orders
      WHERE delivery_id = ?
    `,
    [DELIVERY_POTENTIAL_MISS_THRESHOLD_MINUTES, deliveryId]
  );

  const rankingRows = await db.query(
    `
      SELECT
        performance.delivery_id,
        performance.name,
        performance.total_deliveries,
        performance.avg_delivery_minutes,
        DENSE_RANK() OVER (
          ORDER BY performance.total_deliveries DESC, performance.avg_delivery_minutes ASC
        ) AS rank_position
      FROM (
        SELECT
          u.id AS delivery_id,
          u.name,
          COUNT(o.id) AS total_deliveries,
          COALESCE(AVG(TIMESTAMPDIFF(MINUTE, o.created_at, o.updated_at)), 999999) AS avg_delivery_minutes
        FROM users u
        LEFT JOIN orders o
          ON o.delivery_id = u.id
          AND o.status = 'delivered'
        WHERE u.role = 'delivery'
        GROUP BY u.id, u.name
      ) AS performance
      ORDER BY rank_position ASC, performance.name ASC
    `
  );

  const myRanking = rankingRows.find((entry) => Number(entry.delivery_id) === Number(deliveryId)) || null;
  const metric = metricRows[0] || {};
  const pie = pieRows[0] || {};
  const rangeSales = toNumber(metric.range_sales);

  const payload = {
    filters: {
      startDate: range.startSql,
      endDate: range.endSql,
      compareBy,
      search
    },
    ordersOverview: {
      // Note: orderValue is NOT included for delivery personnel - they should not see payment details
      assignedOrders: assignedOrders.map((order) => ({
        id: order.id,
        customerName: order.customer_name,
        address: order.address,
        assignedAt: order.assigned_at,
        status: order.status,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      })),
      deliveredOrders: deliveredOrders.map((order) => ({
        id: order.id,
        customerName: order.customer_name,
        address: order.address,
        assignedAt: order.assigned_at,
        deliveredAt: order.delivered_at,
        deliveryDurationMinutes: toNumber(order.delivery_duration_minutes),
        status: order.status
      }))
    },
    performanceMetrics: {
      totalDeliveriesAllTime: Number(metric.total_deliveries_all_time || 0),
      deliveriesToday: Number(metric.deliveries_today || 0),
      deliveriesThisWeek: Number(metric.deliveries_this_week || 0),
      deliveriesThisMonth: Number(metric.deliveries_this_month || 0),
      averageDeliveryTimeMinutes: Number(toNumber(metric.avg_delivery_time_minutes).toFixed(2)),
      fastestDeliveryTimeMinutes: Number(toNumber(metric.fastest_delivery_time_minutes).toFixed(2)),
      onTimeDeliveryRate: Number(toNumber(metric.on_time_rate).toFixed(2)),
      onTimeTargetMinutes: DELIVERY_ON_TIME_TARGET_MINUTES
    },
    analytics: {
      deliveriesPerDayTrend: trendRows.map((entry) => ({
        label: entry.label,
        deliveries: Number(entry.deliveries || 0)
      })),
      periodComparison: comparisonRows.map((entry) => ({
        label: entry.label,
        deliveries: Number(entry.deliveries || 0)
      })),
      onTimeVsLate: {
        onTime: Number(pie.on_time || 0),
        late: Number(pie.late || 0)
      },
      averageDeliveryDurationTrend: durationTrendRows.map((entry) => ({
        label: entry.label,
        averageMinutes: Number(toNumber(entry.avg_minutes).toFixed(2))
      }))
    },
    advanced: {
      // Note: earningsSummary is hidden for delivery personnel to protect payment information
      earningsSummary: null,
      customerRatingsSummary: null,
      distanceCoveredKm: null,
      missedOrReassignedOrders: {
        potentiallyMissed: Number(missedRows[0]?.potentially_missed || 0),
        reassignedOrReturned: Number(missedRows[0]?.reassigned_or_returned || 0)
      },
      peakDeliveryHours: peakHoursRows.map((entry) => ({
        hourOfDay: Number(entry.hour_of_day || 0),
        deliveries: Number(entry.deliveries || 0)
      })),
      performanceRanking: myRanking
        ? {
          rank: Number(myRanking.rank_position || 0),
          totalDeliveryStaff: rankingRows.length,
          totalDeliveries: Number(myRanking.total_deliveries || 0),
          averageDeliveryTimeMinutes: Number(toNumber(myRanking.avg_delivery_minutes).toFixed(2))
        }
        : null
    }
  };

  successResponse(res, payload);
});

const buildCsv = (rows) => {
  const escapeCell = (value) => {
    const raw = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  return rows.map((row) => row.map(escapeCell).join(',')).join('\n');
};

const getAnalyticsPayload = async (query) => {
  const granularity = ['daily', 'weekly', 'monthly'].includes(query.granularity)
    ? query.granularity
    : 'daily';

  const range = resolveRange(query);
  const params = [range.startSql, range.endSql];

  const kpiRows = await db.query(
    `
      SELECT
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) ) AS total_sales_all_time,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND DATE(created_at) = CURDATE()) AS daily_sales,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)) AS weekly_sales,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())) AS monthly_sales,
        (SELECT COUNT(*) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND DATE(created_at) = CURDATE()) AS today_order_count,
        (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
        (SELECT COUNT(*) FROM orders WHERE status = 'delivered' AND DATE(updated_at) = CURDATE()) AS completed_orders_today,
        (SELECT COUNT(*) FROM orders) AS total_orders_all_time,
        (SELECT COALESCE(AVG(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL})) AS average_order_value,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?) AS range_revenue,
        (SELECT COUNT(*) FROM orders WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?) AS range_orders
    `,
    [
      ...params,
      ...params
    ]
  );

  const rangeDurationMs = Math.max(1, range.end.getTime() - range.start.getTime());
  const previousEnd = new Date(range.start.getTime() - 1000);
  const previousStart = new Date(previousEnd.getTime() - rangeDurationMs);
  const previousRevenueRows = await db.query(
    `
      SELECT COALESCE(SUM(total), 0) AS previous_revenue
      FROM orders
      WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?
    `,
    [toSqlDateTime(previousStart), toSqlDateTime(previousEnd)]
  );

  const previousRevenue = toNumber(previousRevenueRows[0]?.previous_revenue);
  const currentRevenue = toNumber(kpiRows[0]?.range_revenue);
  const revenueGrowthRate = previousRevenue > 0
    ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
    : (currentRevenue > 0 ? 100 : 0);

  const groupFormats = {
    daily: {
      sql: 'DATE(o.created_at)',
      label: '%Y-%m-%d'
    },
    weekly: {
      sql: 'STR_TO_DATE(CONCAT(YEARWEEK(o.created_at, 1), " Monday"), "%X%V %W")',
      label: 'Week %v, %x'
    },
    monthly: {
      sql: 'DATE_FORMAT(o.created_at, "%Y-%m-01")',
      label: '%b %Y'
    }
  };
  const selectedGroup = groupFormats[granularity];

  const salesTrend = await db.query(
    `
      SELECT
        ${selectedGroup.sql} AS bucket,
        DATE_FORMAT(${selectedGroup.sql}, ?) AS label,
        COALESCE(SUM(o.total), 0) AS sales,
        COUNT(*) AS orders
      FROM orders o
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    [selectedGroup.label, ...params]
  );

  const revenueVsExpenses = await db.query(
    `
      SELECT
        monthly.month_key,
        monthly.month_label,
        monthly.revenue,
        COALESCE(expenses.expenses, 0) AS expenses
      FROM (
        SELECT
          DATE_FORMAT(o.created_at, '%Y-%m') AS month_key,
          DATE_FORMAT(o.created_at, '%b %Y') AS month_label,
          COALESCE(SUM(o.total), 0) AS revenue
        FROM orders o
        WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
        GROUP BY month_key, month_label
      ) AS monthly
      LEFT JOIN (
        SELECT
          DATE_FORMAT(e.expense_date, '%Y-%m') AS month_key,
          COALESCE(SUM(e.amount), 0) AS expenses
        FROM expenses e
        WHERE e.expense_date BETWEEN ? AND ?
        GROUP BY month_key
      ) AS expenses
      ON monthly.month_key = expenses.month_key
      ORDER BY monthly.month_key ASC
    `,
    [...params, ...params]
  );

  const salesByCategory = await db.query(
    `
      SELECT
        COALESCE(p.category, 'General') AS category,
        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY category
      ORDER BY revenue DESC
    `,
    [...params]
  );

  const topProducts = await db.query(
    `
      SELECT
        p.id,
        p.name,
        COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY p.id, p.name
      ORDER BY quantity_sold DESC, revenue DESC
      LIMIT 10
    `,
    [...params]
  );

  const productComparison = await db.query(
    `
      SELECT
        p.name,
        COALESCE(SUM(oi.quantity), 0) AS quantity_sold,
        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 8
    `,
    [...params]
  );

  const expenseSummaryRows = await db.query(
    `
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses
      FROM expenses
      WHERE expense_date BETWEEN ? AND ?
    `,
    [...params]
  );

  const expenseBreakdown = await db.query(
    `
      SELECT
        category,
        COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE expense_date BETWEEN ? AND ?
      GROUP BY category
      ORDER BY total DESC
    `,
    [...params]
  );

  const dayPerformance = await db.query(
    `
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?
      GROUP BY day
      ORDER BY revenue DESC
    `,
    [...params]
  );

  const mostSellingProductRows = await db.query(
    `
      SELECT
        p.name,
        COALESCE(SUM(oi.quantity), 0) AS quantity,
        COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY p.id, p.name
      ORDER BY quantity DESC, revenue DESC
      LIMIT 1
    `,
    [...params]
  );

  const hourPerformance = await db.query(
    `
      SELECT
        HOUR(created_at) AS hour,
        COUNT(*) AS orders,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?
      GROUP BY hour
      ORDER BY revenue DESC
    `,
    [...params]
  );

  const deliveryPerformance = await db.query(
    `
      SELECT
        u.id,
        u.name,
        COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) AS total_deliveries,
        COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total ELSE 0 END), 0) AS total_sales_handled,
        COALESCE(AVG(CASE WHEN o.status = 'delivered' THEN TIMESTAMPDIFF(MINUTE, o.created_at, o.updated_at) END), 0) AS avg_delivery_time_minutes
      FROM users u
      LEFT JOIN orders o ON o.delivery_id = u.id
      WHERE u.role = 'delivery'
        AND (o.id IS NULL OR o.created_at BETWEEN ? AND ?)
      GROUP BY u.id, u.name
      ORDER BY total_deliveries DESC, total_sales_handled DESC
    `,
    [...params]
  );

  const frequentCustomers = await db.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total), 0) AS spending
      FROM users u
      JOIN orders o ON o.user_id = u.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY u.id, u.name, u.email
      ORDER BY order_count DESC, spending DESC
      LIMIT 10
    `,
    [...params]
  );

  const highestSpendingCustomers = await db.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total), 0) AS spending
      FROM users u
      JOIN orders o ON o.user_id = u.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY u.id, u.name, u.email
      ORDER BY spending DESC, order_count DESC
      LIMIT 10
    `,
    [...params]
  );

  const retentionRows = await db.query(
    `
      SELECT
        COUNT(*) AS total_customers,
        SUM(CASE WHEN customer_orders.order_count > 1 THEN 1 ELSE 0 END) AS retained_customers
      FROM (
        SELECT o.user_id, COUNT(*) AS order_count
        FROM orders o
        WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
        GROUP BY o.user_id
      ) AS customer_orders
    `,
    [...params]
  );

  const customerTypeRows = await db.query(
    `
      SELECT
        SUM(CASE WHEN customer_orders.order_count = 1 THEN 1 ELSE 0 END) AS new_customers,
        SUM(CASE WHEN customer_orders.order_count > 1 THEN 1 ELSE 0 END) AS repeat_customers
      FROM (
        SELECT o.user_id, COUNT(*) AS order_count
        FROM orders o
        WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
        GROUP BY o.user_id
      ) AS customer_orders
    `,
    [...params]
  );

  const now = new Date();
  const isMonthEnd = now.getDate() === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const targetMonth = isMonthEnd ? now.getMonth() : now.getMonth() - 1;
  const targetYear = targetMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
  const normalizedTargetMonth = (targetMonth + 12) % 12;
  const monthStart = new Date(targetYear, normalizedTargetMonth, 1);
  const monthEnd = new Date(targetYear, normalizedTargetMonth + 1, 0, 23, 59, 59);

  const customerOfMonthRows = await db.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total), 0) AS spending
      FROM users u
      JOIN orders o ON o.user_id = u.id
      WHERE o.status IN (${SALES_STATUSES_SQL}) AND o.created_at BETWEEN ? AND ?
      GROUP BY u.id, u.name, u.email
      ORDER BY order_count DESC, spending DESC
      LIMIT 1
    `,
    [toSqlDateTime(monthStart), toSqlDateTime(monthEnd)]
  );

  const peakHoursHeatmap = await db.query(
    `
      SELECT
        DAYOFWEEK(created_at) AS day_of_week,
        HOUR(created_at) AS hour_of_day,
        COUNT(*) AS order_count
      FROM orders
      WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?
      GROUP BY day_of_week, hour_of_day
      ORDER BY day_of_week, hour_of_day
    `,
    [...params]
  );

  const totalRevenueForMargin = toNumber(kpiRows[0]?.range_revenue);
  const totalExpensesForMargin = toNumber(expenseSummaryRows[0]?.total_expenses);
  const netProfit = totalRevenueForMargin - totalExpensesForMargin;

  const dailyTrend = await db.query(
    `
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE status IN (${SALES_STATUSES_SQL}) AND created_at BETWEEN ? AND ?
      GROUP BY day
      ORDER BY day ASC
    `,
    [...params]
  );

  let projectedNextPeriodRevenue = 0;
  if (dailyTrend.length > 1) {
    let diffSum = 0;
    for (let i = 1; i < dailyTrend.length; i += 1) {
      diffSum += toNumber(dailyTrend[i].revenue) - toNumber(dailyTrend[i - 1].revenue);
    }
    const avgDailyDiff = diffSum / (dailyTrend.length - 1);
    projectedNextPeriodRevenue = Math.max(0, toNumber(dailyTrend[dailyTrend.length - 1].revenue) + avgDailyDiff);
  } else if (dailyTrend.length === 1) {
    projectedNextPeriodRevenue = toNumber(dailyTrend[0].revenue);
  }

  const retentionData = retentionRows[0] || { total_customers: 0, retained_customers: 0 };
  const retentionRate = toNumber(retentionData.total_customers) > 0
    ? (toNumber(retentionData.retained_customers) / toNumber(retentionData.total_customers)) * 100
    : 0;

  const repeatVsNew = customerTypeRows[0] || { new_customers: 0, repeat_customers: 0 };

  return {
    filters: {
      startDate: range.startSql,
      endDate: range.endSql,
      granularity
    },
    kpis: {
      totalSalesAllTime: toNumber(kpiRows[0]?.total_sales_all_time),
      dailySales: toNumber(kpiRows[0]?.daily_sales),
      weeklySales: toNumber(kpiRows[0]?.weekly_sales),
      monthlySales: toNumber(kpiRows[0]?.monthly_sales),
      todayOrderCount: Number(kpiRows[0]?.today_order_count || 0),
      pendingOrders: Number(kpiRows[0]?.pending_orders || 0),
      completedOrdersToday: Number(kpiRows[0]?.completed_orders_today || 0),
      totalOrders: Number(kpiRows[0]?.total_orders_all_time || 0),
      averageOrderValue: toNumber(kpiRows[0]?.average_order_value),
      revenueGrowthRate: revenueGrowthRate,
      rangeRevenue: totalRevenueForMargin,
      rangeOrders: Number(kpiRows[0]?.range_orders || 0)
    },
    visualizations: {
      salesTrend: salesTrend.map((item) => ({
        bucket: item.bucket,
        label: item.label,
        sales: toNumber(item.sales),
        orders: Number(item.orders || 0)
      })),
      revenueVsExpenses: revenueVsExpenses.map((item) => ({
        label: item.month_label,
        revenue: toNumber(item.revenue),
        expenses: toNumber(item.expenses)
      })),
      salesDistributionByCategory: salesByCategory.map((item) => ({
        category: item.category,
        revenue: toNumber(item.revenue)
      })),
      topSellingProducts: topProducts.map((item) => ({
        id: item.id,
        name: item.name,
        quantitySold: Number(item.quantity_sold || 0),
        revenue: toNumber(item.revenue)
      })),
      productComparison: productComparison.map((item) => ({
        name: item.name,
        quantitySold: Number(item.quantity_sold || 0),
        revenue: toNumber(item.revenue)
      }))
    },
    expenses: {
      totalExpenses: totalExpensesForMargin,
      breakdown: expenseBreakdown.map((item) => ({
        category: item.category,
        total: toNumber(item.total)
      })),
      netProfit
    },
    insights: {
      mostSellingDay: dayPerformance.length > 0 ? {
        date: dayPerformance[0].day,
        revenue: toNumber(dayPerformance[0].revenue)
      } : null,
      slowestDay: dayPerformance.length > 0 ? {
        date: dayPerformance[dayPerformance.length - 1].day,
        revenue: toNumber(dayPerformance[dayPerformance.length - 1].revenue)
      } : null,
      mostSellingProduct: mostSellingProductRows[0] ? {
        name: mostSellingProductRows[0].name,
        quantity: Number(mostSellingProductRows[0].quantity || 0),
        revenue: toNumber(mostSellingProductRows[0].revenue)
      } : null,
      bestPerformingTimeOfDay: hourPerformance[0] ? {
        hour: Number(hourPerformance[0].hour),
        orders: Number(hourPerformance[0].orders || 0),
        revenue: toNumber(hourPerformance[0].revenue)
      } : null
    },
    deliveryStaffPerformance: deliveryPerformance.map((item) => ({
      id: item.id,
      name: item.name,
      totalDeliveries: Number(item.total_deliveries || 0),
      totalSalesHandled: toNumber(item.total_sales_handled),
      averageDeliveryTimeMinutes: Number(toNumber(item.avg_delivery_time_minutes).toFixed(2)),
      customerRating: null
    })),
    customerAnalytics: {
      mostFrequentCustomers: frequentCustomers.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        orderCount: Number(item.order_count || 0),
        spending: toNumber(item.spending)
      })),
      highestSpendingCustomers: highestSpendingCustomers.map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        orderCount: Number(item.order_count || 0),
        spending: toNumber(item.spending)
      })),
      retentionRate,
      customerOfTheMonth: customerOfMonthRows[0] ? {
        id: customerOfMonthRows[0].id,
        name: customerOfMonthRows[0].name,
        email: customerOfMonthRows[0].email,
        orderCount: Number(customerOfMonthRows[0].order_count || 0),
        spending: toNumber(customerOfMonthRows[0].spending),
        periodStart: toSqlDateTime(monthStart),
        periodEnd: toSqlDateTime(monthEnd),
        rewardEligible: Number(customerOfMonthRows[0].order_count || 0) >= 2 && toNumber(customerOfMonthRows[0].spending) > 0
      } : null,
      repeatVsNewCustomerRatio: {
        repeatCustomers: Number(repeatVsNew.repeat_customers || 0),
        newCustomers: Number(repeatVsNew.new_customers || 0)
      }
    },
    highValueAdditions: {
      salesForecasting: {
        projectedNextPeriodRevenue
      },
      conversionRate: null,
      abandonedCartRate: null,
      refundCancellationRate: null,
      peakOrderingHoursHeatmap: peakHoursHeatmap.map((item) => ({
        dayOfWeek: Number(item.day_of_week),
        hourOfDay: Number(item.hour_of_day),
        orderCount: Number(item.order_count)
      })),
      inventoryTurnoverRate: null,
      lowStockAlerts: [],
      profitMarginPerProduct: null,
      geographicSalesDistribution: null
    }
  };
};

// @desc    Get analytics dashboard data
// @route   GET /api/orders/analytics
const getAnalytics = asyncHandler(async (req, res) => {
  const payload = await getAnalyticsPayload(req.query);
  successResponse(res, payload);
});

// @desc    Get latest driver location for current delivery user
// @route   GET /api/orders/delivery/location
const getDeliveryLocation = asyncHandler(async (req, res) => {
  const location = await locationService.getDriverLocation(req.user.id);
  successResponse(res, location || {
    deliveryId: req.user.id,
    orderId: null,
    latitude: null,
    longitude: null,
    locationTime: null
  });
});

// @desc    Get latest driver location for a specific order
// @route   GET /api/orders/:id/location
const getOrderLocation = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const orders = await db.query(
    `SELECT o.id, o.user_id, o.delivery_id, o.status, o.delivery_address, d.name AS delivery_name
     FROM orders o
     LEFT JOIN users d ON o.delivery_id = d.id
     WHERE o.id = ?`,
    [orderId]
  );

  if (orders.length === 0) {
    return errorResponse(res, 'Order not found', 404);
  }

  const order = orders[0];
  const currentUser = req.user;

  if (currentUser.role === 'customer' && Number(order.user_id) !== Number(currentUser.id)) {
    return errorResponse(res, 'Not authorized to view this order location', 403);
  }

  if (currentUser.role === 'delivery' && Number(order.delivery_id) !== Number(currentUser.id)) {
    return errorResponse(res, 'Not authorized to view this order location', 403);
  }

  if (!order.delivery_id) {
    return successResponse(res, {
      orderId: order.id,
      orderStatus: order.status,
      deliveryId: null,
      deliveryName: null,
      trackingStatus: 'awaiting_dispatch',
      statusLabel: 'Awaiting dispatch',
      etaLabel: 'Dispatch pending',
      assignedDestination: order.delivery_address || 'Not available',
      trackedPersonnel: [],
      location: null
    });
  }

  const location = await locationService.getDriverLocation(order.delivery_id);
  const normalizedLocation = location && Number(location.orderId) === Number(order.id) ? location : null;
  const trackedPersonnel = [
    buildTrackedPersonnelPayload(order, normalizedLocation)
  ];
  const payload = {
    orderId: order.id,
    orderStatus: order.status,
    deliveryId: order.delivery_id,
    deliveryName: order.delivery_name || null,
    trackingStatus: trackedPersonnel[0].status,
    statusLabel: trackedPersonnel[0].statusLabel,
    etaLabel: trackedPersonnel[0].etaLabel,
    assignedDestination: trackedPersonnel[0].assignedDestination,
    trackedPersonnel,
    location: normalizedLocation
  };

  return successResponse(res, payload);
});

// @desc    Update driver location from delivery app
// @route   PATCH /api/orders/delivery/location
const updateDeliveryLocation = asyncHandler(async (req, res) => {
  const deliveryId = req.user.id;
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const orderId = req.body.orderId ? Number(req.body.orderId) : null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return errorResponse(res, 'Valid latitude and longitude are required', 400);
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return errorResponse(res, 'Latitude or longitude values are out of range', 400);
  }

  const result = await locationService.saveDriverLocation(deliveryId, latitude, longitude, orderId);
  let trackedPersonnel = [];

  if (result.orderId) {
    const orders = await db.query(
      `SELECT o.id, o.delivery_id, o.status, o.delivery_address, d.name AS delivery_name
       FROM orders o
       LEFT JOIN users d ON o.delivery_id = d.id
       WHERE o.id = ?
       LIMIT 1`,
      [result.orderId]
    );

    if (orders.length) {
      trackedPersonnel = [
        buildTrackedPersonnelPayload(orders[0], {
          latitude,
          longitude,
          locationTime: result.locationTime
        })
      ];
    }
  }

  const payload = {
    deliveryId,
    latitude,
    longitude,
    orderId: result.orderId,
    locationTime: result.locationTime,
    deliveryName: trackedPersonnel[0]?.deliveryName || null,
    trackingStatus: trackedPersonnel[0]?.status || null,
    statusLabel: trackedPersonnel[0]?.statusLabel || null,
    etaLabel: trackedPersonnel[0]?.etaLabel || null,
    assignedDestination: trackedPersonnel[0]?.assignedDestination || null,
    trackedPersonnel
  };

  if (result.customerId) {
    emitToUser(result.customerId, 'driverLocationUpdated', payload);
  }

  emitToRole('manager', 'driverLocationUpdated', payload);
  emitToRole('admin', 'driverLocationUpdated', payload);

  successResponse(res, payload, 'Driver location updated successfully');
});

// @desc    Export analytics summary as CSV
// @route   GET /api/orders/analytics/export
const exportAnalyticsCsv = asyncHandler(async (req, res) => {
  const payload = await getAnalyticsPayload(req.query);
  const rows = [
    ['Metric', 'Value'],
    ['Total Sales (All-time)', payload.kpis.totalSalesAllTime],
    ['Daily Sales', payload.kpis.dailySales],
    ['Weekly Sales', payload.kpis.weeklySales],
    ['Monthly Sales', payload.kpis.monthlySales],
    ['Total Orders', payload.kpis.totalOrders],
    ['Average Order Value', payload.kpis.averageOrderValue],
    ['Revenue Growth Rate (%)', payload.kpis.revenueGrowthRate.toFixed(2)],
    ['Total Expenses', payload.expenses.totalExpenses],
    ['Net Profit', payload.expenses.netProfit],
    [],
    ['Top Product', payload.insights.mostSellingProduct?.name || 'N/A'],
    ['Top Product Quantity', payload.insights.mostSellingProduct?.quantity || 0],
    ['Top Product Revenue', payload.insights.mostSellingProduct?.revenue || 0],
    ['Most Selling Day', payload.insights.mostSellingDay?.date || 'N/A'],
    ['Slowest Day', payload.insights.slowestDay?.date || 'N/A']
  ];

  const csv = buildCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="analytics-${stamp}.csv"`);
  res.status(200).send(csv);
});

module.exports = {
  createOrder,
  getAllOrders,
  getMyOrders,
  getOrder,
  updateOrderStatus,
  assignDelivery,
  getAssignedOrders,
  getDeliveryDashboard,
  getDeliveryLocation,
  getOrderLocation,
  updateDeliveryLocation,
  markAsDelivered,
  getDeliveryPersonnel,
  getAnalytics,
  exportAnalyticsCsv
};
