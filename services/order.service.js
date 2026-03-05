const db = require('../db');
const logger = require('../logger');
const emailService = require('./email.service');

/**
 * Order Service
 * Handles business logic for order operations
 */
class OrderService {
    formatKsh(amount) {
        return `KSh ${Number(amount || 0).toLocaleString('en-KE', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        })}`;
    }

    /**
     * Create a new order with transaction
     * @param {number} userId - User ID
     * @param {Array} items - Order items
     * @param {number} total - Order total
     * @param {string} phone - Customer phone
     * @returns {Promise<Object>} Created order
     */
    async createOrder(userId, items, total, phone) {
        const connection = await db.getConnection();
        
        try {
            await db.beginTransaction(connection);

            // Create order
            const [orderResult] = await connection.execute(
                'INSERT INTO orders (user_id, total, phone, status) VALUES (?, ?, ?, ?)',
                [userId, total, phone, 'pending']
            );

            const orderId = orderResult.insertId;

            // Insert order items
            for (const item of items) {
                // Verify product exists and is available
                const [products] = await connection.execute(
                    'SELECT id, price, name FROM products WHERE id = ? AND available = true',
                    [item.id]
                );

                if (products.length === 0) {
                    throw new Error(`Product ${item.id} is not available`);
                }

                // Use the current product price
                const currentPrice = products[0].price;

                await connection.execute(
                    'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                    [orderId, item.id, item.quantity, currentPrice]
                );
            }

            await db.commit(connection);

            logger.info(`Order created successfully: ${orderId}`);

            // Get complete order details
            const order = await this.getOrderById(orderId);

            // Send confirmation email (async, don't await)
            this.sendOrderConfirmation(order).catch(err => 
                logger.error('Failed to send order confirmation:', err)
            );

            return order;
        } catch (error) {
            await db.rollback(connection);
            logger.error('Error creating order:', error);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Get order by ID with items
     * @param {number} orderId - Order ID
     * @returns {Promise<Object>} Order with items
     */
    async getOrderById(orderId) {
        const orders = await db.query(
            `SELECT o.*, 
                    u.name as customer_name, 
                    u.email as customer_email,
                    d.name as delivery_name
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             LEFT JOIN users d ON o.delivery_id = d.id
             WHERE o.id = ?`,
            [orderId]
        );

        if (orders.length === 0) {
            const error = new Error('Order not found');
            error.statusCode = 404;
            throw error;
        }

        const order = orders[0];

        // Get order items
        const items = await db.query(
            `SELECT oi.*, p.name as product_name, p.image 
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [orderId]
        );

        order.items = items;
        return order;
    }

    /**
     * Get orders by user
     * @param {number} userId - User ID
     * @returns {Promise<Array>} User's orders
     */
    async getUserOrders(userId) {
        const orders = await db.query(
            `SELECT o.*, 
                    d.name as delivery_name
             FROM orders o
             LEFT JOIN users d ON o.delivery_id = d.id
             WHERE o.user_id = ?
             ORDER BY o.created_at DESC`,
            [userId]
        );

        // Get items for each order
        for (const order of orders) {
            const items = await db.query(
                `SELECT oi.*, p.name as product_name, p.image 
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }

        return orders;
    }

    /**
     * Get all orders with filters
     * @param {Object} filters - Query filters
     * @returns {Promise<Array>} Filtered orders
     */
    async getAllOrders(filters = {}) {
        let query = `
            SELECT o.*, 
                   u.name as customer_name, 
                   u.email as customer_email,
                   d.name as delivery_name
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN users d ON o.delivery_id = d.id
        `;
        
        const params = [];
        const conditions = [];

        if (filters.status) {
            conditions.push('o.status = ?');
            params.push(filters.status);
        }

        if (filters.userId) {
            conditions.push('o.user_id = ?');
            params.push(filters.userId);
        }

        if (filters.deliveryId) {
            conditions.push('o.delivery_id = ?');
            params.push(filters.deliveryId);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY o.created_at DESC';

        const orders = await db.query(query, params);

        // Get items for each order
        for (const order of orders) {
            const items = await db.query(
                `SELECT oi.*, p.name as product_name, p.image 
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }

        return orders;
    }

    /**
     * Update order status
     * @param {number} orderId - Order ID
     * @param {string} status - New status
     * @param {number} userId - User making the update
     * @returns {Promise<Object>} Updated order
     */
    async updateOrderStatus(orderId, status, userId) {
        const validStatuses = ['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered'];
        
        if (!validStatuses.includes(status)) {
            const error = new Error('Invalid status');
            error.statusCode = 400;
            throw error;
        }

        // Get current order
        const order = await this.getOrderById(orderId);

        // Update status
        await db.query(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, orderId]
        );

        logger.info(`Order ${orderId} status updated to ${status} by user ${userId}`);

        // If status becomes 'delivered', send notification
        if (status === 'delivered') {
            this.sendDeliveryNotification(order).catch(err =>
                logger.error('Failed to send delivery notification:', err)
            );
        }

        return this.getOrderById(orderId);
    }

    /**
     * Assign delivery person to order
     * @param {number} orderId - Order ID
     * @param {number} deliveryId - Delivery user ID
     * @returns {Promise<Object>} Updated order
     */
    async assignDelivery(orderId, deliveryId) {
        // Check if delivery user exists and has delivery role
        const deliveryUsers = await db.query(
            'SELECT id, name, email FROM users WHERE id = ? AND role = ?',
            [deliveryId, 'delivery']
        );

        if (deliveryUsers.length === 0) {
            const error = new Error('Delivery user not found');
            error.statusCode = 404;
            throw error;
        }

        // Assign delivery
        await db.query(
            'UPDATE orders SET delivery_id = ? WHERE id = ?',
            [deliveryId, orderId]
        );

        logger.info(`Order ${orderId} assigned to delivery user ${deliveryId}`);

        // Send notification to delivery person
        const order = await this.getOrderById(orderId);
        this.sendAssignmentNotification(order, deliveryUsers[0]).catch(err =>
            logger.error('Failed to send assignment notification:', err)
        );

        return this.getOrderById(orderId);
    }

    /**
     * Get orders assigned to delivery person
     * @param {number} deliveryId - Delivery user ID
     * @returns {Promise<Array>} Assigned orders
     */
    async getAssignedOrders(deliveryId) {
        const orders = await db.query(
            `SELECT o.*, 
                    u.name as customer_name,
                    u.email as customer_email
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.delivery_id = ? AND o.status = 'out_for_delivery'
             ORDER BY o.created_at DESC`,
            [deliveryId]
        );

        // Get items for each order
        for (const order of orders) {
            const items = await db.query(
                `SELECT oi.*, p.name as product_name, p.image 
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }

        return orders;
    }

    /**
     * Mark order as delivered
     * @param {number} orderId - Order ID
     * @param {number} deliveryId - Delivery user ID
     * @returns {Promise<Object>} Updated order
     */
    async markAsDelivered(orderId, deliveryId) {
        // Check if order exists and assigned to this delivery
        const orders = await db.query(
            'SELECT * FROM orders WHERE id = ? AND delivery_id = ?',
            [orderId, deliveryId]
        );

        if (orders.length === 0) {
            const error = new Error('Order not found or not assigned to you');
            error.statusCode = 404;
            throw error;
        }

        if (orders[0].status !== 'out_for_delivery') {
            const error = new Error('Only out_for_delivery orders can be marked as delivered');
            error.statusCode = 400;
            throw error;
        }

        // Update status to delivered
        await db.query(
            'UPDATE orders SET status = ? WHERE id = ?',
            ['delivered', orderId]
        );

        logger.info(`Order ${orderId} marked as delivered by delivery user ${deliveryId}`);

        return this.getOrderById(orderId);
    }

    /**
     * Send order confirmation email
     * @param {Object} order - Order object
     */
    async sendOrderConfirmation(order) {
        if (!order.customer_email) return;

        const html = `
            <h1>Order Confirmation</h1>
            <p>Thank you for your order, ${order.customer_name}!</p>
            <h2>Order #${order.id}</h2>
            <p><strong>Total:</strong> ${this.formatKsh(order.total)}</p>
            <p><strong>Status:</strong> ${order.status}</p>
            <h3>Items:</h3>
            <ul>
                ${order.items.map(item => `
                    <li>${item.product_name} x ${item.quantity} - ${this.formatKsh(item.price * item.quantity)}</li>
                `).join('')}
            </ul>
            <p>We'll notify you when your order is being prepared and out for delivery.</p>
        `;

        await emailService.sendEmail(
            order.customer_email,
            `Order Confirmation #${order.id}`,
            html
        );
    }

    /**
     * Send assignment notification to delivery person
     * @param {Object} order - Order object
     * @param {Object} delivery - Delivery user object
     */
    async sendAssignmentNotification(order, delivery) {
        const html = `
            <h1>New Order Assigned</h1>
            <p>You have been assigned to deliver order #${order.id}.</p>
            <h2>Order Details</h2>
            <p><strong>Customer:</strong> ${order.customer_name}</p>
            <p><strong>Phone:</strong> ${order.phone}</p>
            <p><strong>Total:</strong> ${this.formatKsh(order.total)}</p>
            <h3>Items:</h3>
            <ul>
                ${order.items.map(item => `
                    <li>${item.product_name} x ${item.quantity}</li>
                `).join('')}
            </ul>
            <p>Please check your dashboard for more details.</p>
        `;

        await emailService.sendEmail(
            delivery.email,
            `New Delivery Assignment - Order #${order.id}`,
            html
        );
    }

    /**
     * Send delivery notification to customer
     * @param {Object} order - Order object
     */
    async sendDeliveryNotification(order) {
        if (!order.customer_email) return;

        const html = `
            <h1>Your Order Has Been Delivered!</h1>
            <p>Dear ${order.customer_name},</p>
            <p>Your order #${order.id} has been delivered.</p>
            <p>Thank you for choosing FastFood!</p>
            <p>We hope you enjoy your meal!</p>
        `;

        await emailService.sendEmail(
            order.customer_email,
            `Order Delivered - #${order.id}`,
            html
        );
    }

    /**
     * Calculate order statistics
     * @returns {Promise<Object>} Order statistics
     */
    async getOrderStats() {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_orders,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
                SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) as preparing_orders,
                SUM(CASE WHEN status = 'out_for_delivery' THEN 1 ELSE 0 END) as out_for_delivery_orders,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
                SUM(total) as total_revenue,
                AVG(total) as average_order_value
            FROM orders
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);

        return stats[0];
    }
}

module.exports = new OrderService();
