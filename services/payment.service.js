const db = require('../db');
const logger = require('../logger');
const orderService = require('./order.service');
const mpesaService = require('./mpesa.service');

/**
 * Payment Service
 * Handles payment processing logic with M-Pesa integration
 */
class PaymentService {
    getResultDescription(resultCode, fallback = '') {
        if (resultCode === 1037) {
            return 'Action timed out';
        }

        if (resultCode === 1032) {
            return 'Action cancelled';
        }

        return fallback || 'Payment not completed';
    }

    /**
     * Process payment
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

            logger.info(`Processing payment for order ${orderId}: KSh ${amount}`);

            // Check if M-Pesa is configured for real payments
            if (!mpesaService.isConfigured()) {
                // Fall back to simulated payment
                return this.processSimulatedPayment(orderId, amount, phone);
            }

            // For M-Pesa, we don't process directly here
            // The actual payment happens via STK Push
            // This method is kept for backward compatibility
            throw new Error('Please use STK Push to complete payment');

        } catch (error) {
            logger.error(`Payment failed for order ${orderId}:`, error);
            throw error;
        }
    }

    /**
     * Process simulated payment (fallback)
     * @param {number} orderId - Order ID
     * @param {number} amount - Payment amount
     * @param {string} phone - Customer phone
     * @returns {Promise<Object>} Payment result
     */
    async processSimulatedPayment(orderId, amount, phone) {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate fake receipt number
        const receiptNumber = `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`;

        // Update order status
        await db.query(
            'UPDATE orders SET status = ?, mpesa_receipt = ? WHERE id = ?',
            ['paid', receiptNumber, orderId]
        );

        logger.info(`Simulated payment successful for order ${orderId}. Receipt: ${receiptNumber}`);

        return {
            success: true,
            receiptNumber,
            transactionId: `TXN${Date.now()}`,
            amount,
            phone,
            timestamp: new Date().toISOString(),
            message: 'Payment completed successfully (Simulated)'
        };
    }

    /**
     * Initiate STK Push for payment
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

            // Validate phone number
            const formattedPhone = mpesaService.formatPhoneNumber(phone);
            
            if (!formattedPhone) {
                throw new Error('Invalid phone number format');
            }

            // Get order amount
            const amount = order.total;

            logger.info(`PaymentService requesting STK push for order ${orderId}`, {
                amount,
                phone: formattedPhone
            });

            // Import stkService here to avoid circular dependency
            const stkService = require('./stk.service');
            
            // Initiate STK push
            const result = await stkService.initiateSTKPush(orderId, formattedPhone, amount);

            let checkoutRequestId = result.checkoutRequestId ?? result.CheckoutRequestID ?? null;
            await db.query(
                'UPDATE orders SET checkout_request_id = ? WHERE id = ?',
                [checkoutRequestId, orderId]
            );

            logger.info('Saved checkout_request_id for order', { orderId, checkoutRequestId });

            return result;

        } catch (error) {
            logger.error('STK push initiation failed:', error);
            throw error;
        }
    }

    /**
     * Handle STK callback from M-Pesa
     * @param {Object} callbackData - Callback data from M-Pesa
     * @returns {Promise<Object>} Callback response
     */
    async handleSTKCallback(callbackData) {
        try {
            const stkService = require('./stk.service');

            const result = await stkService.handleCallback(callbackData);

            const callbackPayload = callbackData.Body?.stkCallback ?? {};
            const checkoutRequestIdFromCallback = callbackPayload.CheckoutRequestID ?? null;
            const resultCodeFromCallback = callbackPayload.ResultCode ?? result.resultCode ?? result.ResultCode ?? 0;
            const resultDesc = this.getResultDescription(
                resultCodeFromCallback,
                callbackPayload.ResultDesc ?? result.resultDesc ?? result.ResultDesc ?? (resultCodeFromCallback === 0 ? 'Success' : 'Payment not completed')
            );
            const checkoutRequestId = checkoutRequestIdFromCallback ?? result.checkoutRequestId ?? result.CheckoutRequestID ?? null;
            const parsedResultCode = Number(resultCodeFromCallback);
            const resultCode = Number.isNaN(parsedResultCode) ? 1 : parsedResultCode;

            logger.info('Parsed STK callback payload', {
                checkoutRequestId,
                resultCode,
                resultDesc,
                orderId: result.orderId,
                amount: result.amount,
                mpesaReceiptNumber: result.mpesaReceiptNumber
            });

            let orderRows = [];

            if (checkoutRequestId) {
                orderRows = await db.query(
                    'SELECT * FROM orders WHERE checkout_request_id = ? LIMIT 1',
                    [checkoutRequestId]
                );
            }

            if (orderRows.length === 0 && result.orderId) {
                orderRows = await db.query(
                    'SELECT * FROM orders WHERE id = ? LIMIT 1',
                    [result.orderId]
                );
            }

            if (orderRows.length === 0) {
                logger.error('STK callback could not find matching order', {
                    checkoutRequestId,
                    callbackData
                });

                return {
                    ResultCode: 1,
                    ResultDesc: 'Order not found for payment',
                    success: false
                };
            }

            const order = orderRows[0];
            const resolvedCheckoutId = checkoutRequestId ?? order.checkout_request_id;
            const updateTargetColumn = resolvedCheckoutId ? 'checkout_request_id' : 'id';
            const updateTargetValue = resolvedCheckoutId ?? order.id;
            const isPaymentSuccess = resultCode === 0;
            const newStatus = isPaymentSuccess ? 'paid' : 'pending';

            if (order.status === 'paid' && resultCode === 0) {
                logger.warn('Duplicate callback ignored for already paid order', {
                    orderId: order.id,
                    checkoutRequestId: resolvedCheckoutId || null
                });

                return {
                    ResultCode: 0,
                    ResultDesc: 'Order already marked as paid',
                    success: true
                };
            }

            if (order.status === 'paid' && resultCode !== 0) {
                logger.warn('Callback indicates failure but order already marked as paid; ignoring status change', {
                    orderId: order.id,
                    checkoutRequestId: resolvedCheckoutId || null
                });

                return {
                    ResultCode: 0,
                    ResultDesc: 'Order already marked as paid',
                    success: true
                };
            }

            let receipt = null;
            if (resultCode === 0) {
                receipt = result.mpesaReceiptNumber || `MP${Date.now()}`;

                const duplicateReceipt = await db.query(
                    'SELECT id FROM orders WHERE mpesa_receipt = ? AND id != ? LIMIT 1',
                    [receipt, order.id]
                );

                if (duplicateReceipt.length > 0) {
                    logger.warn(`Duplicate receipt number: ${receipt}`);
                    return {
                        ResultCode: 1,
                        ResultDesc: 'Duplicate transaction',
                        success: false
                    };
                }
            }

            const updateQuery = isPaymentSuccess
                ? `UPDATE orders SET status = ?, mpesa_receipt = ?, paid_at = NOW() WHERE ${updateTargetColumn} = ?`
                : `UPDATE orders SET status = ?, mpesa_receipt = NULL, paid_at = NULL, checkout_request_id = NULL WHERE ${updateTargetColumn} = ?`;

            const updateParams = isPaymentSuccess
                ? [newStatus, receipt, updateTargetValue]
                : [newStatus, updateTargetValue];

            const updateResult = await db.query(updateQuery, updateParams);

            if (!updateResult || updateResult.affectedRows === 0) {
                logger.warn('STK callback updated no rows', {
                    orderId: order.id,
                    checkoutRequestId: resolvedCheckoutId,
                    status: newStatus,
                    updateResult
                });
            } else {
                logger.info('STK callback updated order status', {
                    orderId: order.id,
                    checkoutRequestId: resolvedCheckoutId,
                    status: newStatus,
                    receipt
                });
            }

            return {
                ResultCode: isPaymentSuccess ? 0 : resultCode || 1,
                ResultDesc: resultDesc,
                MpesaReceiptNumber: receipt,
                success: isPaymentSuccess
            };
        } catch (error) {
            logger.error('STK callback handling failed:', error);
            logger.error('Original callback payload:', callbackData);
            throw error;
        }
    }

    /**
     * Handle manual callback simulation (for testing/demo)
     * @param {Object} callbackData - Simulated callback data
     * @returns {Promise<Object>} Callback response
     */
    async handleSimulatedCallback(callbackData) {
        return this.handleSTKCallback(callbackData);
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

    /**
     * Check if M-Pesa is configured
     * @returns {boolean}
     */
    isMpesaConfigured() {
        return mpesaService.isConfigured();
    }
}

module.exports = new PaymentService();
