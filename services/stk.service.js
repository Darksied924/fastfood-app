const logger = require('../logger');
const crypto = require('crypto');

/**
 * STK Push Service
 * Simulates M-Pesa STK push functionality
 */
class STKService {
    constructor() {
        // In production, these would come from environment variables
        this.businessShortCode = '174379';
        this.passkey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
        this.callbackUrl = 'https://your-domain.com/api/payments/stk-callback';
    }

    /**
     * Simulate STK push initiation
     * @param {number} orderId - Order ID
     * @param {string} phone - Customer phone number
     * @param {number} amount - Amount to charge
     * @returns {Promise<Object>} STK push response
     */
    async initiateSTKPush(orderId, phone, amount) {
        try {
            // Validate phone number (simple validation)
            const cleanedPhone = this.formatPhoneNumber(phone);
            
            if (!cleanedPhone) {
                throw new Error('Invalid phone number format');
            }

            // Generate timestamp in format YYYYMMDDHHmmss
            const timestamp = this.getTimestamp();
            
            // Generate password (Base64 of BusinessShortCode + Passkey + Timestamp)
            const password = this.generatePassword(timestamp);

            // Generate unique checkout request ID
            const checkoutRequestId = this.generateCheckoutRequestId(orderId);

            logger.info(`STK push initiated for order ${orderId} to phone ${cleanedPhone} amount ${amount}`);

            // Simulate API call delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Simulate successful response (90% success rate)
            const isSuccess = Math.random() < 0.9;

            if (!isSuccess) {
                return {
                    success: false,
                    checkoutRequestId,
                    responseCode: '1',
                    responseDescription: 'The service request is failed',
                    customerMessage: 'Failed to process payment. Please try again.',
                    orderId,
                    amount
                };
            }

            // Store pending transaction in memory (in production, use Redis or database)
            this.pendingTransactions = this.pendingTransactions || new Map();
            this.pendingTransactions.set(checkoutRequestId, {
                orderId,
                phone: cleanedPhone,
                amount,
                timestamp: new Date(),
                status: 'pending'
            });

            return {
                success: true,
                checkoutRequestId,
                merchantRequestId: `MR-${Date.now()}`,
                responseCode: '0',
                responseDescription: 'Success. Request accepted for processing',
                customerMessage: 'Please enter your M-Pesa PIN on your phone',
                orderId,
                amount
            };
        } catch (error) {
            logger.error('STK push initiation failed:', error);
            throw error;
        }
    }

    /**
     * Simulate STK push callback
     * @param {string} checkoutRequestId - Checkout request ID
     * @param {boolean} success - Whether payment was successful
     * @returns {Promise<Object>} Callback data
     */
    async simulateCallback(checkoutRequestId, success = true) {
        try {
            // Get pending transaction
            const transaction = this.pendingTransactions?.get(checkoutRequestId);

            if (!transaction) {
                throw new Error('Transaction not found');
            }

            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (success) {
                // Generate receipt number
                const receiptNumber = this.generateReceiptNumber();

                const callbackData = {
                    Body: {
                        stkCallback: {
                            MerchantRequestID: `MR-${Date.now()}`,
                            CheckoutRequestID: checkoutRequestId,
                            ResultCode: 0,
                            ResultDesc: 'The service request is processed successfully.',
                            CallbackMetadata: {
                                Item: [
                                    {
                                        Name: 'Amount',
                                        Value: transaction.amount
                                    },
                                    {
                                        Name: 'MpesaReceiptNumber',
                                        Value: receiptNumber
                                    },
                                    {
                                        Name: 'TransactionDate',
                                        Value: this.getTimestamp()
                                    },
                                    {
                                        Name: 'PhoneNumber',
                                        Value: transaction.phone
                                    }
                                ]
                            }
                        }
                    }
                };

                // Remove from pending
                this.pendingTransactions.delete(checkoutRequestId);

                logger.info(`STK callback simulated for transaction ${checkoutRequestId} with receipt ${receiptNumber}`);

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
                            CallbackMetadata: {
                                Item: []
                            }
                        }
                    }
                };

                // Remove from pending
                this.pendingTransactions.delete(checkoutRequestId);

                logger.info(`STK callback simulated for transaction ${checkoutRequestId} - Cancelled by user`);

                return {
                    success: false,
                    callbackData,
                    orderId: transaction.orderId,
                    resultCode: 1032,
                    resultDesc: 'Request cancelled by user'
                };
            }
        } catch (error) {
            logger.error('STK callback simulation failed:', error);
            throw error;
        }
    }

    /**
     * Format phone number to international format
     * @param {string} phone - Phone number
     * @returns {string|null} Formatted phone number
     */
    formatPhoneNumber(phone) {
        // Remove any non-numeric characters
        const cleaned = phone.replace(/\D/g, '');
        
        // Handle different formats
        if (cleaned.startsWith('0') && cleaned.length === 10) {
            return '254' + cleaned.substring(1);
        } else if (cleaned.startsWith('254') && cleaned.length === 12) {
            return cleaned;
        } else if (cleaned.startsWith('7') && cleaned.length === 9) {
            return '254' + cleaned;
        } else if (cleaned.length === 9) {
            return '254' + cleaned;
        }
        
        return null;
    }

    /**
     * Get current timestamp in M-Pesa format
     * @returns {string} Timestamp
     */
    getTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    }

    /**
     * Generate M-Pesa password
     * @param {string} timestamp - Timestamp
     * @returns {string} Base64 encoded password
     */
    generatePassword(timestamp) {
        const str = this.businessShortCode + this.passkey + timestamp;
        return Buffer.from(str).toString('base64');
    }

    /**
     * Generate unique checkout request ID
     * @param {number} orderId - Order ID
     * @returns {string} Checkout request ID
     */
    generateCheckoutRequestId(orderId) {
        const randomPart = crypto.randomBytes(8).toString('hex');
        return `ws_CO_${orderId}_${Date.now()}_${randomPart}`;
    }

    /**
     * Generate unique receipt number
     * @returns {string} Receipt number
     */
    generateReceiptNumber() {
        const prefix = 'SIM';
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `${prefix}${timestamp}${random}`;
    }

    /**
     * Get transaction status
     * @param {string} checkoutRequestId - Checkout request ID
     * @returns {Object|null} Transaction status
     */
    getTransactionStatus(checkoutRequestId) {
        return this.pendingTransactions?.get(checkoutRequestId) || null;
    }

    /**
     * Clean up old pending transactions
     * Should be called periodically
     */
    cleanupOldTransactions() {
        if (!this.pendingTransactions) return;

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