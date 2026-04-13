const db = require('../db');

class LocationService {
    async getActiveOrderForDelivery(deliveryId) {
        const rows = await db.query(
            `SELECT id, user_id
             FROM orders
             WHERE delivery_id = ?
               AND status = 'out_for_delivery'
             ORDER BY updated_at DESC
             LIMIT 1`,
            [deliveryId]
        );

        return rows.length ? rows[0] : null;
    }

    async getTrackedOrderForDelivery(deliveryId, orderId = null) {
        const normalizedOrderId = Number(orderId);

        if (Number.isFinite(normalizedOrderId) && normalizedOrderId > 0) {
            const rows = await db.query(
                `SELECT id, user_id
                 FROM orders
                 WHERE id = ?
                   AND delivery_id = ?
                   AND status = 'out_for_delivery'
                 LIMIT 1`,
                [normalizedOrderId, deliveryId]
            );

            if (rows.length) {
                return rows[0];
            }
        }

        return this.getActiveOrderForDelivery(deliveryId);
    }

    async saveDriverLocation(deliveryId, latitude, longitude, orderId = null) {
        const trackedOrder = await this.getTrackedOrderForDelivery(deliveryId, orderId);
        const persistedOrderId = trackedOrder ? trackedOrder.id : null;

        await db.query(
            `INSERT INTO driver_locations (delivery_id, order_id, latitude, longitude, location_time)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               order_id = VALUES(order_id),
               latitude = VALUES(latitude),
               longitude = VALUES(longitude),
               location_time = VALUES(location_time),
               updated_at = CURRENT_TIMESTAMP`,
            [deliveryId, persistedOrderId, latitude, longitude]
        );

        return {
            orderId: persistedOrderId,
            customerId: trackedOrder ? trackedOrder.user_id : null,
            locationTime: new Date().toISOString().slice(0, 19).replace('T', ' ')
        };
    }

    async getDriverLocation(deliveryId) {
        const rows = await db.query(
            `SELECT delivery_id, order_id, latitude, longitude, location_time
             FROM driver_locations
             WHERE delivery_id = ?
             LIMIT 1`,
            [deliveryId]
        );

        if (!rows.length) {
            return null;
        }

        const location = rows[0];
        return {
            deliveryId: location.delivery_id,
            orderId: location.order_id,
            latitude: Number(location.latitude),
            longitude: Number(location.longitude),
            locationTime: location.location_time
        };
    }
}

module.exports = new LocationService();
