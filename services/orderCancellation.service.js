const db = require('../db');
const logger = require('../logger');
const emailService = require('./email.service');

const createServiceError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

/**
 * Order Cancellation & Refund Service
 * Handles cancellation requests, admin reviews, refunds workflow
 */
class OrderCancellationService {
  constructor() {
    this.FIVE_MINUTES_MS = 5 * 60 * 1000;
  }

  requiresRefundReview(order) {
    if (!order) {
      return false;
    }

    return Boolean(
      order.paid_at ||
      order.mpesa_receipt ||
      ['paid', 'preparing', 'out_for_delivery', 'delivered'].includes(order.status)
    );
  }

  /**
   * Customer cancels order (paid within 5min)
   * @param {number} orderId - Order ID
   * @param {number} userId - Customer ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Cancellation record
   */
  async cancelOrder(orderId, userId, reason) {
    const connection = await db.getConnection();
    
    try {
      await db.beginTransaction(connection);

      // Get order details
      const [orders] = await connection.execute(
        `SELECT o.id, o.user_id, o.status, o.created_at, o.total, o.delivery_address,
                o.paid_at, o.mpesa_receipt,
                u.email AS customer_email, u.name AS customer_name
         FROM orders o
         JOIN users u ON o.user_id = u.id
         WHERE o.id = ?
         FOR UPDATE`,
        [orderId]
      );

      if (orders.length === 0) {
        throw createServiceError('Order not found', 404);
      }

      const order = orders[0];
      
      if (order.user_id !== userId) {
        throw createServiceError('Not authorized to cancel this order', 403);
      }

      if (order.status === 'cancelled') {
        throw createServiceError('Order is already cancelled', 400);
      }

      if (order.status === 'replaced') {
        throw createServiceError('Replaced orders cannot be cancelled', 400);
      }

      const now = new Date();
      const createdTime = new Date(order.created_at);
      const timeDiff = now - createdTime;

      const validStatus = order.status === 'paid';
      const withinTime = timeDiff <= this.FIVE_MINUTES_MS;

      if (!validStatus || !withinTime) {
        throw createServiceError('Cancellation is only allowed for paid orders within 5 minutes', 400);
      }

      // Create cancellation record
      const [cancelResult] = await connection.execute(
        `INSERT INTO order_cancellations (order_id, user_id, reason, cancelled_at, is_admin_override)
         VALUES (?, ?, ?, NOW(), FALSE)`,
        [orderId, userId, reason]
      );

      const cancellationId = cancelResult.insertId;

      // Update order status
      await connection.execute(
        'UPDATE orders SET status = "cancelled" WHERE id = ?',
        [orderId]
      );

      let refundRequestId = null;

      if (this.requiresRefundReview(order)) {
        const [refundResult] = await connection.execute(
          `INSERT INTO refund_requests (cancellation_id, status)
           VALUES (?, "REQUESTED")`,
          [cancellationId]
        );
        refundRequestId = refundResult.insertId;
      }

      await db.commit(connection);

      logger.info(`Order ${orderId} cancelled by customer ${userId} (reason: ${reason})`);

      // Email notifications
      this.sendCancellationConfirmation(order, reason).catch(err => logger.error(err));
      if (refundRequestId) {
        this.sendRefundRequestToAdmin(order, cancellationId).catch(err => logger.error(err));
      }

      return {
        cancellationId,
        refundRequestId,
        orderId,
        requiresRefundReview: Boolean(refundRequestId),
        message: refundRequestId
          ? 'Cancellation requested successfully. Awaiting admin refund approval.'
          : 'Order cancelled successfully.'
      };
    } catch (error) {
      await db.rollback(connection);
      logger.error('Order cancellation failed:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Admin overrides cancellation (except delivered/cancelled/replaced)
   * @param {number} orderId - Order ID
   * @param {number} adminId - Admin ID
   * @param {string} reason - Admin reason/notes
   * @returns {Promise<Object>}
   */
  async adminOverrideCancel(orderId, adminId, reason) {
    const connection = await db.getConnection();
    
    try {
      await db.beginTransaction(connection);

      // Get order
      const [orders] = await connection.execute(
        `SELECT o.id, o.user_id, o.status, o.total, o.paid_at, o.mpesa_receipt,
                u.email AS customer_email, u.name AS customer_name
         FROM orders o
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id = ?
         FOR UPDATE`,
        [orderId]
      );

      if (orders.length === 0) {
        throw createServiceError('Order not found', 404);
      }

      const order = orders[0];

      if (order.status === 'cancelled') {
        throw createServiceError('Order is already cancelled', 400);
      }

      if (order.status === 'replaced') {
        throw createServiceError('Replaced orders cannot be cancelled', 400);
      }

      if (order.status === 'delivered') {
        throw createServiceError('Delivered orders cannot be cancelled by admin override', 400);
      }

      const cleanReason = String(reason || '').trim();
      const cancellationReason = cleanReason || 'Admin override';

      // Create admin cancellation
      const [result] = await connection.execute(
        `INSERT INTO order_cancellations (order_id, user_id, reason, cancelled_at, is_admin_override, admin_notes, admin_id)
         VALUES (?, ?, ?, NOW(), TRUE, ?, ?)`,
        [orderId, null, cancellationReason, cleanReason || null, adminId]
      );

      // Update order
      await connection.execute(
        'UPDATE orders SET status = "cancelled" WHERE id = ?',
        [orderId]
      );

      let refundRequestId = null;
      if (this.requiresRefundReview(order)) {
        const [refundResult] = await connection.execute(
          `INSERT INTO refund_requests (cancellation_id, status)
           VALUES (?, "REQUESTED")`,
          [result.insertId]
        );
        refundRequestId = refundResult.insertId;
      }

      await db.commit(connection);

      logger.info(`Admin ${adminId} override-cancelled order ${orderId}: ${reason}`);

      this.sendCancellationConfirmation(order, cancellationReason).catch(err => logger.error(err));
      if (refundRequestId) {
        this.sendRefundRequestToAdmin(order, result.insertId).catch(err => logger.error(err));
      }

      return {
        cancellationId: result.insertId,
        refundRequestId,
        requiresRefundReview: Boolean(refundRequestId),
        message: refundRequestId
          ? 'Order cancelled by admin override and queued for refund review'
          : 'Order cancelled by admin override'
      };
    } catch (error) {
      await db.rollback(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Admin reviews refund request
   * @param {number} refundId - Refund request ID
   * @param {number} adminId - Admin ID
   * @param {string} decision - APPROVED/DENIED
   * @param {string} notes - Admin notes
   * @returns {Promise<Object>}
   */
  async reviewRefundRequest(refundId, adminId, decision, notes) {
    if (!['APPROVED', 'DENIED'].includes(decision)) {
      throw createServiceError('Decision must be APPROVED or DENIED', 400);
    }

    const refundRows = await db.query(
      `SELECT rr.*, oc.order_id, o.user_id, o.total 
              ,oc.reason
              ,u.email AS customer_email
              ,u.name AS customer_name
       FROM refund_requests rr
       JOIN order_cancellations oc ON rr.cancellation_id = oc.id
       JOIN orders o ON oc.order_id = o.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE rr.id = ?`,
      [refundId]
    );

    if (refundRows.length === 0) {
      throw createServiceError('Refund request not found', 404);
    }

    const refund = refundRows[0];

    if (refund.status !== 'REQUESTED') {
      throw createServiceError(`Refund request is already ${String(refund.status || '').toLowerCase()}`, 400);
    }

    const newStatus = decision;

    await db.query(
      `UPDATE refund_requests 
       SET status = ?, admin_id = ?, admin_notes = ?, processed_at = NOW()
       WHERE id = ?`,
      [newStatus, adminId, notes || null, refundId]
    );

    logger.info(`Refund ${refundId} ${decision} by admin ${adminId}: ${notes}`);

    // Email customer
    if (decision === 'APPROVED') {
      this.sendRefundApprovedEmail(refund).catch(err => logger.error(err));
    } else {
      this.sendRefundDeniedEmail(refund, notes).catch(err => logger.error(err));
    }

    return {
      refundId,
      status: newStatus,
      message: `Refund request ${decision.toLowerCase()}`
    };
  }

  /**
   * Get all cancellation requests (admin/manager)
   */
  async getCancellationRequests() {
    return await db.query(`
      SELECT 
        oc.*,
        o.user_id, o.total, o.status, o.created_at,
        u.name as customer_name, u.email as customer_email, u.phone,
        rr.id as refund_id, rr.status as refund_status,
        rr.admin_notes,
        rr.processed_at
      FROM order_cancellations oc
      JOIN orders o ON oc.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN refund_requests rr ON oc.id = rr.cancellation_id
      ORDER BY oc.cancelled_at DESC
    `);
  }

  /**
   * Get cancelled orders for manager dashboard
   */
  async getCancelledOrders() {
    return await db.query(`
      SELECT 
        o.*,
        u.name as customer_name,
        oc.reason, oc.cancelled_at, oc.is_admin_override, oc.admin_notes,
        rr.id as refund_id, rr.status as refund_status
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_cancellations oc ON o.id = oc.order_id
      LEFT JOIN refund_requests rr ON oc.id = rr.cancellation_id
      WHERE o.status = 'cancelled'
      ORDER BY o.created_at DESC
    `);
  }

  // Email notifications (async)
  async sendCancellationConfirmation(order, reason) {
    if (!order?.customer_email) {
      return null;
    }

    await emailService.sendEmail(
      order.customer_email,
      `Order #${order.id} Cancellation Confirmation`,
      `
        <p>Hello ${order.customer_name || 'Customer'},</p>
        <p>Your order <strong>#${order.id}</strong> has been cancelled.</p>
        <p>Reason: ${reason}</p>
        <p>If a refund is due, our team will review it and contact you.</p>
      `
    );
  }

  async sendRefundRequestToAdmin(order, cancellationId) {
    // Send to all admins
    const admins = await db.query('SELECT email FROM users WHERE role = "admin"');
    for (const admin of admins) {
      await emailService.sendEmail(
        admin.email,
        `Refund Request - Order #${order.id}`,
        `
          <p>Order <strong>#${order.id}</strong> has a refund review request.</p>
          <p>Cancellation reference: ${cancellationId}</p>
          <p>Review it from the admin orders screen.</p>
        `
      );
    }
  }

  async sendRefundApprovedEmail(refund) {
    if (!refund?.customer_email) {
      return null;
    }

    await emailService.sendEmail(
      refund.customer_email,
      `Refund Approved - Order #${refund.order_id}`,
      `
        <p>Hello ${refund.customer_name || 'Customer'},</p>
        <p>Your refund request for order <strong>#${refund.order_id}</strong> has been approved.</p>
        <p>Our team will complete the refund process and follow up if anything else is needed.</p>
      `
    );
  }

  async sendRefundDeniedEmail(refund, notes) {
    if (!refund?.customer_email) {
      return null;
    }

    await emailService.sendEmail(
      refund.customer_email,
      `Refund Update - Order #${refund.order_id}`,
      `
        <p>Hello ${refund.customer_name || 'Customer'},</p>
        <p>Your refund request for order <strong>#${refund.order_id}</strong> was not approved.</p>
        <p>${notes ? `Admin notes: ${notes}` : 'Please contact support if you need more information.'}</p>
      `
    );
  }
}

module.exports = new OrderCancellationService();
