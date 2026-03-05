const db = require('../db');
const logger = require('../logger');
const orderService = require('./order.service');

/**
 * Payment Service
 * Handles payment processing logic
 */
class PaymentService {
    /**
     * Process payment (simulated)
     * @param {number} orderId - Order ID
     * @param {number} amount - Payment amount
     * @param {string} phone - Customer phone
     * @returns {Promise<Object>} Payment result
     */
    async processPayment(orderId, amount, phone) {
        try {
            // Validate order
            const order = await orderService.getOrderById(orderId);

            if (order.status !== 'pending') {
                throw new Error('Order is not in pending state');
            }

            if (order.total !== amount) {
                throw new Error('Payment amount does not match order total');
            }

            // Simulate payment processing
            logger.info(`Processing payment for order ${orderId}: KSh ${amount}`);

            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Generate fake receipt number
            const receiptNumber = `MP${Date.now()}${Math.floor(Math.random() * 1000)}`;

            // Update order status
            await db.query(
                'UPDATE orders SET status = ?, mpesa_receipt = ? WHERE id = ?',
                ['paid', receiptNumber, orderId]
            );

            logger.info(`Payment successful for order ${orderId}. Receipt: ${receiptNumber}`);

            return {
                success: true,
                receiptNumber,
                transactionId: `TXN${Date.now()}`,
                amount,
                phone,
                timestamp: new Date().toISOString(),
                message: 'Payment completed successfully'
            };
        } catch (error) {
            logger.error(`Payment failed for order ${orderId}:`, error);
            throw error;
        }
    }

    /**
     * Simulate STK Push initiation
     * @param {number} orderId - Order ID
     * @param {string} phone - Customer phone
     * @returns {Promise<Object>} STK push response
     */
    async initiateSTKPush(orderId, phone) {
        try {
            // Validate order
            const order = await orderService.getOrderById(orderId);

            if (order.status !== 'pending') {
                throw new Error('Order is not in pending state');
            }

            // Validate phone number format (simple validation)
            if (!phone || phone.length < 10) {
                throw new Error('Invalid phone number');
            }

            logger.info(`STK push initiated for order ${orderId} to phone ${phone}`);

            // Simulate API call to M-Pesa
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Generate fake checkout request ID
            const checkoutRequestId = `ws_CO_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const merchantRequestId = `MR-${Date.now()}`;

            return {
                success: true,
                checkoutRequestId,
                merchantRequestId,
                responseCode: '0',
                responseDescription: 'Success. Request accepted for processing',
                customerMessage: 'Please enter your M-Pesa PIN to complete the transaction',
                orderId,
                amount: order.total,
                phone
            };
        } catch (error) {
            logger.error('STK push failed:', error);
            throw error;
        }
    }

    /**
     * Handle STK callback (simulated)
     * @param {Object} callbackData - Callback data
     * @returns {Promise<Object>} Callback response
     */
    async handleSTKCallback(callbackData) {
        const { orderId, resultCode, resultDesc, mpesaReceiptNumber } = callbackData;

        logger.info(`STK callback received for order ${orderId}: Code ${resultCode}`);

        if (resultCode !== 0) {
            // Payment failed
            logger.info(`Payment failed for order ${orderId}: ${resultDesc}`);
            
            // Update order with failure reason if needed
            await db.query(
                'UPDATE orders SET notes = ? WHERE id = ?',
                [`Payment failed: ${resultDesc}`, orderId]
            );

            return {
                ResultCode: resultCode,
                ResultDesc: resultDesc,
                success: false
            };
        }

        // Check if receipt already used (prevent duplicates)
        if (mpesaReceiptNumber) {
            const existingOrder = await db.query(
                'SELECT id FROM orders WHERE mpesa_receipt = ?',
                [mpesaReceiptNumber]
            );

            if (existingOrder.length > 0) {
                logger.warn(`Duplicate receipt number: ${mpesaReceiptNumber}`);
                return {
                    ResultCode: '1',
                    ResultDesc: 'Duplicate transaction',
                    success: false
                };
            }
        }

        // Update order status to paid and add receipt
        const receipt = mpesaReceiptNumber || `SIM${Date.now()}`;
        
        await db.query(
            'UPDATE orders SET status = ?, mpesa_receipt = ? WHERE id = ?',
            ['paid', receipt, orderId]
        );

        logger.info(`Payment confirmed for order ${orderId}. Receipt: ${receipt}`);

        return {
            ResultCode: 0,
            ResultDesc: 'Success',
            MpesaReceiptNumber: receipt,
            success: true
        };
    }

    /**
     * Verify payment status
     * @param {string} receiptNumber - M-Pesa receipt number
     * @returns {Promise<Object>} Payment details
     */
    async verifyPayment(receiptNumber) {
        const orders = await db.query(
            'SELECT id, user_id, total, status, created_at FROM orders WHERE mpesa_receipt = ?',
            [receiptNumber]
        );

        if (orders.length === 0) {
            const error = new Error('Payment not found');
            error.statusCode = 404;
            throw error;
        }

        const order = orders[0];

        return {
            receiptNumber,
            orderId: order.id,
            amount: order.total,
            status: order.status,
            transactionDate: order.created_at,
            verified: order.status === 'paid'
        };
    }

    /**
     * Get payment statistics
     * @returns {Promise<Object>} Payment statistics
     */
    async getPaymentStats() {
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_transactions,
                COUNT(DISTINCT mpesa_receipt) as unique_receipts,
                SUM(total) as total_amount,
                AVG(total) as average_amount,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_transactions,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN total ELSE 0 END) as today_amount
            FROM orders
            WHERE status = 'paid' AND mpesa_receipt IS NOT NULL
        `);

        return stats[0];
    }
}

module.exports = new PaymentService();
