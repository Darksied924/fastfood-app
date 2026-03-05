const db = require('../db');
const logger = require('../logger');

/**
 * Assignment Service
 * Handles logic for assigning orders to delivery personnel
 */
class AssignmentService {
    /**
     * Assign order to delivery person with least active orders
     * @param {number} orderId - Order ID
     * @returns {Promise<number>} Assigned delivery user ID
     */
    async assignDelivery(orderId) {
        try {
            // Check if order exists and is paid
            const orders = await db.query(
                'SELECT id, status FROM orders WHERE id = ?',
                [orderId]
            );

            if (orders.length === 0) {
                throw new Error('Order not found');
            }

            const order = orders[0];

            if (order.status !== 'paid') {
                throw new Error('Order must be paid before assigning delivery');
            }

            // Check if already assigned
            const assigned = await db.query(
                'SELECT delivery_id FROM orders WHERE id = ? AND delivery_id IS NOT NULL',
                [orderId]
            );

            if (assigned.length > 0) {
                logger.info(`Order ${orderId} already assigned to delivery user ${assigned[0].delivery_id}`);
                return assigned[0].delivery_id;
            }

            // Find delivery users with least active orders
            const deliveryUsers = await db.query(`
                SELECT u.id, u.name, u.email,
                       COUNT(o.id) as active_orders
                FROM users u
                LEFT JOIN orders o ON u.id = o.delivery_id 
                    AND o.status IN ('preparing', 'out_for_delivery')
                WHERE u.role = 'delivery'
                GROUP BY u.id, u.name, u.email
                ORDER BY active_orders ASC
                LIMIT 1
            `);

            if (deliveryUsers.length === 0) {
                logger.warn('No delivery users available for assignment');
                throw new Error('No delivery users available');
            }

            const deliveryId = deliveryUsers[0].id;

            // Assign order to delivery user
            await db.query(
                'UPDATE orders SET delivery_id = ?, status = ? WHERE id = ?',
                [deliveryId, 'preparing', orderId]
            );

            logger.info(`Order ${orderId} assigned to delivery user ${deliveryId} (${deliveryUsers[0].active_orders} active orders)`);
            
            return deliveryId;
        } catch (error) {
            logger.error('Error assigning delivery:', error);
            throw error;
        }
    }

    /**
     * Get delivery user workload
     * @param {number} deliveryId - Delivery user ID
     * @returns {Promise<Object>} Workload statistics
     */
    async getDeliveryWorkload(deliveryId) {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_assigned,
                SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) as preparing,
                SUM(CASE WHEN status = 'out_for_delivery' THEN 1 ELSE 0 END) as out_for_delivery,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_today,
                AVG(CASE WHEN status = 'delivered' 
                    THEN TIMESTAMPDIFF(MINUTE, created_at, updated_at) 
                    ELSE NULL END) as avg_delivery_time_minutes
            FROM orders
            WHERE delivery_id = ? 
                AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `, [deliveryId]);

        return stats[0];
    }

    /**
     * Reassign order to different delivery person
     * @param {number} orderId - Order ID
     * @param {number} newDeliveryId - New delivery user ID
     * @param {number} adminId - Admin user ID making the change
     * @returns {Promise<Object>} Reassignment result
     */
    async reassignDelivery(orderId, newDeliveryId, adminId) {
        // Check if new delivery user exists and has delivery role
        const deliveryUsers = await db.query(
            'SELECT id, name FROM users WHERE id = ? AND role = ?',
            [newDeliveryId, 'delivery']
        );

        if (deliveryUsers.length === 0) {
            throw new Error('New delivery user not found or invalid role');
        }

        // Get current assignment
        const current = await db.query(
            'SELECT delivery_id FROM orders WHERE id = ?',
            [orderId]
        );

        if (current.length === 0) {
            throw new Error('Order not found');
        }

        const oldDeliveryId = current[0].delivery_id;

        // Update assignment
        await db.query(
            'UPDATE orders SET delivery_id = ? WHERE id = ?',
            [newDeliveryId, orderId]
        );

        logger.info(`Order ${orderId} reassigned from delivery ${oldDeliveryId} to ${newDeliveryId} by admin ${adminId}`);

        return {
            orderId,
            oldDeliveryId,
            newDeliveryId,
            reassignedBy: adminId,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get all delivery users with their current workload
     * @returns {Promise<Array>} Delivery users with workload
     */
    async getAllDeliveryWorkloads() {
        const workloads = await db.query(`
            SELECT 
                u.id,
                u.name,
                u.email,
                COUNT(o.id) as total_active_orders,
                SUM(CASE WHEN o.status = 'preparing' THEN 1 ELSE 0 END) as preparing,
                SUM(CASE WHEN o.status = 'out_for_delivery' THEN 1 ELSE 0 END) as out_for_delivery,
                MAX(o.created_at) as last_assignment
            FROM users u
            LEFT JOIN orders o ON u.id = o.delivery_id 
                AND o.status IN ('preparing', 'out_for_delivery')
            WHERE u.role = 'delivery'
            GROUP BY u.id, u.name, u.email
            ORDER BY total_active_orders ASC
        `);

        return workloads;
    }

    /**
     * Auto-assign all pending paid orders
     * This can be run as a scheduled job
     * @returns {Promise<Array>} Assignment results
     */
    async autoAssignAllPending() {
        // Get all paid orders without delivery assigned
        const pendingOrders = await db.query(`
            SELECT id FROM orders 
            WHERE status = 'paid' AND delivery_id IS NULL
            ORDER BY created_at ASC
        `);

        const results = [];

        for (const order of pendingOrders) {
            try {
                const deliveryId = await this.assignDelivery(order.id);
                results.push({
                    orderId: order.id,
                    deliveryId,
                    success: true
                });
            } catch (error) {
                logger.error(`Failed to auto-assign order ${order.id}:`, error);
                results.push({
                    orderId: order.id,
                    success: false,
                    error: error.message
                });
            }

            // Small delay between assignments to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        logger.info(`Auto-assignment completed. Assigned ${results.filter(r => r.success).length} orders`);

        return results;
    }
}

module.exports = new AssignmentService();