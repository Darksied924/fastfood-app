const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

/**
 * M-Pesa Service
 * Handles M-Pesa API integration
 * Documentation: https://developer.safaricom.co.ke/docs
 */
class MpesaService {
    constructor() {
        this.consumerKey = config.mpesa.consumerKey;
        this.consumerSecret = config.mpesa.consumerSecret;
        this.businessShortCode = config.mpesa.businessShortCode;
        this.passkey = config.mpesa.passkey;
        this.callbackUrl = config.mpesa.callbackUrl;
        this.environment = config.mpesa.environment;
        
        // Set base URLs based on environment
        this.baseUrls = {
            sandbox: 'https://sandbox.safaricom.co.ke',
            production: 'https://api.safaricom.co.ke'
        };
        
        this.baseUrl = this.baseUrls[this.environment] || this.baseUrls.sandbox;
        
        // Token cache
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Get M-Pesa OAuth access token
     * @returns {Promise<string>} Access token
     */
    async getAccessToken() {
        try {
            // Check if we have a valid cached token
            if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
                return this.accessToken;
            }

            const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
            
            const response = await axios.get(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            if (response.data.access_token) {
                // Cache token, expire 50 minutes from now (tokens are valid for 1 hour)
                this.accessToken = response.data.access_token;
                this.tokenExpiry = new Date(Date.now() + 50 * 60 * 1000);
                
                logger.info('M-Pesa access token obtained successfully');
                return this.accessToken;
            }

            throw new Error('Failed to obtain access token');
        } catch (error) {
            logger.error('M-Pesa OAuth error:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with M-Pesa: ' + (error.response?.data?.errorMessage || error.message));
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
     * Get timestamp in M-Pesa format (YYYYMMDDHHmmss)
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
     * Generate M-Pesa password (Base64 of BusinessShortCode + Passkey + Timestamp)
     * @param {string} timestamp - Timestamp
     * @returns {string} Base64 encoded password
     */
    generatePassword(timestamp) {
        const str = this.businessShortCode + this.passkey + timestamp;
        return Buffer.from(str).toString('base64');
    }

    /**
     * Generate unique transaction ID
     * @param {number} orderId - Order ID
     * @returns {string} Transaction ID
     */
    generateTransactionId(orderId) {
        const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
        return `FF${orderId}${Date.now()}${randomPart}`;
    }

    /**
     * Initiate STK Push (M-Pesa Express)
     * @param {number} orderId - Order ID
     * @param {string} phone - Customer phone number
     * @param {number} amount - Amount to pay
     * @returns {Promise<Object>} STK Push response
     */
    async initiateSTKPush(orderId, phone, amount) {
        try {
            // Validate and format phone number
            const formattedPhone = this.formatPhoneNumber(phone);
            
            if (!formattedPhone) {
                throw new Error('Invalid phone number format');
            }

            // Get access token
            const accessToken = await this.getAccessToken();
            
            // Generate timestamp and password
            const timestamp = this.getTimestamp();
            const password = this.generatePassword(timestamp);
            
            // Prepare request
            const requestData = {
                BusinessShortCode: this.businessShortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: 'CustomerPayBillOnline',
                Amount: Math.ceil(amount), // Ensure whole number
                PartyA: formattedPhone,
                PartyB: this.businessShortCode,
                PhoneNumber: formattedPhone,
                CallBackURL: this.callbackUrl,
                AccountReference: `ORDER${orderId}`,
                TransactionDesc: `FastFood Order ${orderId}`
            };

            logger.info(`Initiating STK push for order ${orderId}: KSh ${amount} to ${formattedPhone}`);

            const response = await axios.post(
                `${this.baseUrl}/mpesa/stkpush/v1/processrequest`,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            logger.info(`STK push response for order ${orderId}:`, response.data);

            // Return formatted response
            return {
                success: response.data.ResponseCode === '0',
                checkoutRequestId: response.data.CheckoutRequestID,
                merchantRequestId: response.data.MerchantRequestID,
                responseCode: response.data.ResponseCode,
                responseDescription: response.data.ResponseDescription,
                customerMessage: response.data.CustomerMessage || 'Please enter your M-Pesa PIN on your phone',
                orderId,
                amount: Math.ceil(amount),
                phone: formattedPhone
            };

        } catch (error) {
            logger.error('STK Push error:', error.response?.data || error.message);
            
            // Handle specific M-Pesa errors
            const errorData = error.response?.data;
            if (errorData) {
                if (errorData.errorCode === '400.002.02') {
                    throw new Error('Invalid Business Short Code. Please contact support.');
                } else if (errorData.errorCode === '400.002.03') {
                    throw new Error('Invalid Access Token. Please try again.');
                } else if (errorData.errorCode === '400.002.04') {
                    throw new Error('Invalid format. Please check your request.');
                }
            }
            
            throw new Error('Failed to initiate M-Pesa payment: ' + (errorData?.errorMessage || error.message));
        }
    }

    /**
     * Query STK Push status
     * @param {string} checkoutRequestId - Checkout request ID
     * @returns {Promise<Object>} Query response
     */
    async querySTKStatus(checkoutRequestId) {
        try {
            const accessToken = await this.getAccessToken();
            const timestamp = this.getTimestamp();
            const password = this.generatePassword(timestamp);

            const requestData = {
                BusinessShortCode: this.businessShortCode,
                Password: password,
                Timestamp: timestamp,
                CheckoutRequestID: checkoutRequestId
            };

            const response = await axios.post(
                `${this.baseUrl}/mpesa/stkpushquery/v1/query`,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: response.data.ResponseCode === '0',
                responseCode: response.data.ResponseCode,
                responseDescription: response.data.ResponseDescription,
                resultCode: response.data.ResultCode,
                resultDesc: response.data.ResultDesc
            };

        } catch (error) {
            logger.error('STK Query error:', error.response?.data || error.message);
            throw new Error('Failed to query payment status: ' + (error.response?.data?.errorMessage || error.message));
        }
    }

    /**
     * Register callback URLs for C2B
     * @returns {Promise<Object>} Registration response
     */
    async registerUrls() {
        try {
            const accessToken = await this.getAccessToken();

            const requestData = {
                ShortCode: this.businessShortCode,
                ResponseType: 'Completed',
                ConfirmationURL: this.callbackUrl.replace('mpesa-express-simulate', 'mpesa-confirm'),
                ValidationURL: this.callbackUrl.replace('mpesa-express-simulate', 'mpesa-validate')
            };

            const response = await axios.post(
                `${this.baseUrl}/mpesa/c2b/v1/registerurl`,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: response.data.ResponseCode === '0',
                response: response.data
            };

        } catch (error) {
            logger.error('URL Registration error:', error.response?.data || error.message);
            throw new Error('Failed to register M-Pesa URLs: ' + (error.response?.data?.errorMessage || error.message));
        }
    }

    /**
     * Simulate C2B payment (for testing in sandbox)
     * @param {string} phone - Customer phone
     * @param {number} amount - Amount
     * @param {string} reference - Account reference
     * @returns {Promise<Object>} Simulation response
     */
    async simulateC2B(phone, amount, reference) {
        try {
            const accessToken = await this.getAccessToken();
            const formattedPhone = this.formatPhoneNumber(phone);

            const requestData = {
                ShortCode: this.businessShortCode,
                CommandID: 'CustomerBuyGoodsOnline',
                Amount: Math.ceil(amount),
                Msisdn: formattedPhone,
                BillRefNumber: reference || 'ORDER',
                Remarks: 'FastFood Order Payment'
            };

            const response = await axios.post(
                `${this.baseUrl}/mpesa/b2c/v1/paymentrequest`,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {
                success: response.data.ResponseCode === '0',
                response: response.data
            };

        } catch (error) {
            logger.error('C2B Simulation error:', error.response?.data || error.message);
            throw new Error('Failed to simulate payment: ' + (error.response?.data?.errorMessage || error.message));
        }
    }

    /**
     * Validate M-Pesa callback
     * @param {Object} callbackData - Raw callback data
     * @returns {Object} Parsed and validated callback
     */
    parseCallback(callbackData) {
        try {
            const stkCallback = callbackData.Body?.stkCallback;
            
            if (!stkCallback) {
                logger.warn('Invalid M-Pesa callback: Missing stkCallback');
                return null;
            }

            const resultCode = stkCallback.ResultCode;
            const resultDesc = stkCallback.ResultDesc;
            const checkoutRequestId = stkCallback.CheckoutRequestID;
            const merchantRequestId = stkCallback.MerchantRequestID;

            // Parse callback metadata
            let amount = null;
            let mpesaReceiptNumber = null;
            let transactionDate = null;
            let phoneNumber = null;

            if (stkCallback.CallbackMetadata?.Item) {
                const metadata = {};
                stkCallback.CallbackMetadata.Item.forEach(item => {
                    metadata[item.Name] = item.Value;
                });

                amount = metadata.Amount;
                mpesaReceiptNumber = metadata.MpesaReceiptNumber;
                transactionDate = metadata.TransactionDate;
                phoneNumber = metadata.PhoneNumber;
            }

            return {
                success: Number(resultCode) === 0,
                resultCode,
                resultDesc,
                checkoutRequestId,
                merchantRequestId,
                amount,
                mpesaReceiptNumber,
                transactionDate,
                phoneNumber,
                raw: callbackData
            };

        } catch (error) {
            logger.error('Error parsing M-Pesa callback:', error);
            return null;
        }
    }

    /**
     * Check if M-Pesa is properly configured
     * @returns {boolean}
     */
    isConfigured() {
        return !!(
            this.consumerKey &&
            this.consumerSecret &&
            this.businessShortCode &&
            this.passkey &&
            this.callbackUrl
        );
    }
}

module.exports = new MpesaService();
