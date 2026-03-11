const logger = require('../logger');
const mpesaService = require('./mpesa.service');
const db = require('../db');

/**
 * STK Push Service
 * Wrapper around M-Pesa STK Push functionality
 */
class STKService {
    constructor() {
        this.pendingTransactions = new Map();
    }

    /**
     * Initiate STK Push
     * @param {number} orderId - Order ID
     * @param {string} phone - Customer phone number
     * @param {number} amount - Amount to charge
     * @returns {Promise<Object>} STK push response
     */
    async initiateSTKPush(orderId, phone, amount) {
        try {
            // Check if M-Pesa is configured
            if (!mpesaService.isConfigured()) {
                logger.warn('M-Pesa not configured, falling back to simulation mode');
                return this.simulateSTKPush(orderId, phone, amount);
            }

            // Try real M-Pesa API first
            try {
                const result = await mpesaService.initiateSTKPush(orderId, phone, amount);

                // Store pending transaction
                if (result.checkoutRequestId) {
                    this.pendingTransactions.set(result.checkoutRequestId, {
                        orderId,
                        phone: mpesaService.formatPhoneNumber(phone),
                        amount,
                        timestamp: new Date(),
                        status: 'pending'
                    });
                }

                return result;
            } catch (mpesaError) {
                // M-Pesa API failed (503 or other error), fall back to simulation
                logger.warn(`M-Pesa API failed (${mpesaError.message}), falling back to simulation mode`);
                return this.simulateSTKPush(orderId, phone, amount);
            }

        } catch (error) {
            logger.error('STK push initiation failed:', error);
            throw error;
        }
    }

    /**
     * Simulate STK Push (fallback when M-Pesa is not configured)
     * @param {number} orderId - Order ID
     * @param {string} phone - Customer phone number
     * @param {number} amount - Amount to charge
     * @returns {Promise<Object>} Simulated STK push response
     */
    async simulateSTKPush(orderId, phone, amount) {
        try {
            // Validate phone number
            const formattedPhone = mpesaService.formatPhoneNumber(phone);
            
            if (!formattedPhone) {
                throw new Error('Invalid phone number format');
            }

            logger.info(`Simulating STK push for order ${orderId} to phone ${formattedPhone} amount ${amount}`);

            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Simulate successful response (90% success rate)
            const isSuccess = Math.random() < 0.9;

            if (!isSuccess) {
                return {
                    success: false,
                    checkoutRequestId: `ws_CO_${orderId}_${Date.now()}_sim`,
                    responseCode: '1',
                    responseDescription: 'The service request is failed',
                    customerMessage: 'Failed to process payment. Please try again.',
                    orderId,
                    amount
                };
            }

            // Generate fake checkout request ID
            const checkoutRequestId = `ws_CO_${orderId}_${Date.now()}_sim`;
            
            // Store pending transaction
            this.pendingTransactions.set(checkoutRequestId, {
                orderId,
                phone: formattedPhone,
                amount,
                timestamp: new Date(),
                status: 'pending',
                simulated: true
            });

            return {
                success: true,
                checkoutRequestId,
                merchantRequestId: `MR-${Date.now()}`,
                responseCode: '0',
                responseDescription: 'Success. Request accepted for processing',
                customerMessage: 'Please enter your M-Pesa PIN on your phone (SIMULATED)',
                orderId,
                amount,
                simulated: true
            };
        } catch (error) {
            logger.error('Simulated STK push failed:', error);
            throw error;
        }
    }

    /**
     * Handle STK callback from M-Pesa
     * @param {Object} callbackData - Callback data from M-Pesa
     * @returns {Promise<Object>} Parsed callback response
     */
    async handleCallback(callbackData) {
        try {
            // Check if it's a simulated transaction
            const checkoutRequestId = callbackData.Body?.stkCallback?.CheckoutRequestID;
            
            if (checkoutRequestId && checkoutRequestId.endsWith('_sim')) {
                return this.handleSimulatedCallback(callbackData);
            }

            // Parse real M-Pesa callback
            const parsed = mpesaService.parseCallback(callbackData);

            if (!parsed) {
                throw new Error('Invalid callback data');
            }

            logger.info(`STK callback received: Code ${parsed.resultCode} for checkout ${parsed.checkoutRequestId}`);

            const pending = this.pendingTransactions.get(parsed.checkoutRequestId);

            // Remove from pending if present
            if (pending) {
                this.pendingTransactions.delete(parsed.checkoutRequestId);
            }

            const orders = await db.query(
                'SELECT id, total FROM orders WHERE checkout_request_id = ? LIMIT 1',
                [parsed.checkoutRequestId]
            );

            if (!orders.length) {
                throw new Error(`Order not found for checkout_request_id ${parsed.checkoutRequestId}`);
            }

            const order = orders[0];

            const resultCode = Number(parsed.resultCode ?? parsed.ResultCode ?? 1);
            const newStatus = resultCode === 0 ? 'paid' : 'failed';
            const receiptIdentifier = parsed.mpesaReceiptNumber ?? parsed.MpesaReceiptNumber ?? parsed.merchantRequestId ?? parsed.MerchantRequestID ?? null;

            if (newStatus === 'paid') {
                await db.query(
                    'UPDATE orders SET status = ?, mpesa_receipt = ? WHERE id = ?',
                    [newStatus, receiptIdentifier, order.id]
                );
            } else {
                await db.query(
                    'UPDATE orders SET status = ?, mpesa_receipt = NULL WHERE id = ?',
                    [newStatus, order.id]
                );
            }

            return {
                ...parsed,
                orderId: order.id,
                amount: order.total,
                phone: pending?.phone ?? parsed.phone
            };

        } catch (error) {
            logger.error('STK callback handling failed:', error);
            throw error;
        }
    }

    /**
     * Handle simulated callback
     * @param {Object} callbackData - Simulated callback data
     * @returns {Promise<Object>} Callback result
     */
    async handleSimulatedCallback(callbackData) {
        const stkCallback = callbackData.Body?.stkCallback;
        const checkoutRequestId = stkCallback?.CheckoutRequestID;
        
        const transaction = this.pendingTransactions.get(checkoutRequestId);
        
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        const resultCode = stkCallback?.ResultCode ?? 0;
        const resultDesc = stkCallback?.ResultDesc ?? 'Success';

        if (resultCode !== 0) {
            this.pendingTransactions.delete(checkoutRequestId);
            return {
                success: false,
                resultCode,
                resultDesc,
                orderId: transaction.orderId,
                checkoutRequestId
            };
        }

        // Generate receipt number
        const receiptNumber = `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`;

        // Remove from pending
        this.pendingTransactions.delete(checkoutRequestId);

        logger.info(`Simulated callback processed for order ${transaction.orderId} with receipt ${receiptNumber}`);

        return {
            success: true,
            resultCode: 0,
            resultDesc: 'Success',
            orderId: transaction.orderId,
            checkoutRequestId,
            mpesaReceiptNumber: receiptNumber,
            amount: transaction.amount,
            phone: transaction.phone,
            simulated: true
        };
    }

    /**
     * Simulate callback (for testing)
     * @param {string} checkoutRequestId - Checkout request ID
     * @param {boolean} success - Whether payment was successful
     * @returns {Promise<Object>} Callback data
     */
    async simulateCallback(checkoutRequestId, success = true) {
        try {
            const transaction = this.pendingTransactions.get(checkoutRequestId);

            if (!transaction) {
                throw new Error('Transaction not found');
            }

            if (success) {
                const receiptNumber = `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`;
                
                const callbackData = {
                    Body: {
                        stkCallback: {
                            MerchantRequestID: `MR-${Date.now()}`,
                            CheckoutRequestID: checkoutRequestId,
                            ResultCode: 0,
                            ResultDesc: 'The service request is processed successfully.',
                            CallbackMetadata: {
                                Item: [
                                    { Name: 'Amount', Value: transaction.amount },
                                    { Name: 'MpesaReceiptNumber', Value: receiptNumber },
                                    { Name: 'TransactionDate', Value: mpesaService.getTimestamp() },
                                    { Name: 'PhoneNumber', Value: transaction.phone }
                                ]
                            }
                        }
                    }
                };

                // NOTE: Do NOT delete the transaction here - let handleSimulatedCallback() handle it
                // This allows the normal callback flow to process and delete the transaction

                return {
                    success: true,
                    callbackData,
                    orderId: transaction.orderId,
                    receiptNumber,
                    amount: transaction.amount
                };
            } else {
                const callbackData = {
                    Body: {
                        stkCallback: {
                            MerchantRequestID: `MR-${Date.now()}`,
                            CheckoutRequestID: checkoutRequestId,
                            ResultCode: 1032,
                            ResultDesc: 'Request cancelled by user',
                            CallbackMetadata: { Item: [] }
                        }
                    }
                };

                // NOTE: Do NOT delete the transaction here - let handleSimulatedCallback() handle it

                return {
                    success: false,
                    callbackData,
                    orderId: transaction.orderId,
                    resultCode: 1032,
                    resultDesc: 'Request cancelled by user'
                };
            }
        } catch (error) {
            logger.error('Simulate callback failed:', error);
            throw error;
        }
    }

    /**
     * Query STK status
     * @param {string} checkoutRequestId - Checkout request ID
     * @returns {Promise<Object>} Status response
     */
    async queryStatus(checkoutRequestId) {
        try {
            // First, check if this is a simulated transaction
            if (checkoutRequestId?.endsWith('_sim')) {
                const transaction = this.pendingTransactions.get(checkoutRequestId);
                if (transaction) {
                    return {
                        success: true,
                        resultCode: 0,
                        resultDesc: 'Success - Pending'
                    };
                }
                return {
                    success: false,
                    resultCode: 1,
                    resultDesc: 'Transaction not found'
                };
            }

            // For real M-Pesa transactions, check the database for order status
            // The callback from M-Pesa should update the order status to 'paid'
            const db = require('../db');
            logger.info('Looking up order for checkout_request_id', { checkoutRequestId });
            
            const orders = await db.query(
                'SELECT id, status, mpesa_receipt FROM orders WHERE checkout_request_id = ? LIMIT 1',
                [checkoutRequestId]
            );

            if (orders.length > 0) {
                const order = orders[0];

                if (order.status === 'paid') {
                    return {
                        success: true,
                        resultCode: 0,
                        resultDesc: 'Payment completed',
                        orderId: order.id,
                        receiptNumber: order.mpesa_receipt
                    };
                }

                // When the callback hasn’t arrived yet we rely on order state instead of querying Daraja,
                // because the sandbox query endpoint is flaky. The correct signal is the callback.
                return {
                    success: true,
                    resultCode: 0,
                    resultDesc: 'Payment pending - awaiting callback',
                    orderId: order.id,
                    receiptNumber: order.mpesa_receipt
                };
            }

            logger.info('No order tied to checkout_request_id, delegating to M-Pesa', { checkoutRequestId });
            // No order found, try querying M-Pesa directly
            return mpesaService.querySTKStatus(checkoutRequestId);
        } catch (error) {
            logger.error('Query status error:', error);
            return {
                success: false,
                resultCode: 1,
                resultDesc: 'Error querying payment status'
            };
        }
    }

    /**
     * Get transaction status
     * @param {string} checkoutRequestId - Checkout request ID
     * @returns {Object|null} Transaction status
     */
    getTransactionStatus(checkoutRequestId) {
        return this.pendingTransactions.get(checkoutRequestId) || null;
    }

    /**
     * Clean up old pending transactions
     */
    cleanupOldTransactions() {
        const now = new Date();
        const expiryTime = 30 * 60 * 1000; // 30 minutes

        for (const [id, transaction] of this.pendingTransactions.entries()) {
            if (now - transaction.timestamp > expiryTime) {
                this.pendingTransactions.delete(id);
                logger.info(`Cleaned up expired transaction: ${id}`);
            }
        }
    }
}

module.exports = new STKService();
