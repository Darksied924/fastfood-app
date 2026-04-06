const logger = require('../logger');

/**
 * Email Service
 * Handles email sending functionality
 * In production, integrate with actual email service like SendGrid, AWS SES, etc.
 */
class EmailService {
    constructor() {
        // In production, these would come from environment variables
        this.fromEmail = 'noreply@cravedash.app';
        this.fromName = 'CraveDash Delivery';
    }

    formatKsh(amount) {
        return `KSh ${Number(amount || 0).toLocaleString('en-KE', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        })}`;
    }

    /**
     * Send email
     * @param {string} to - Recipient email
     * @param {string} subject - Email subject
     * @param {string} html - HTML content
     * @returns {Promise<Object>} Email sending result
     */
    async sendEmail(to, subject, html) {
        try {
            // Log email for development
            logger.info(`Sending email to ${to}: ${subject}`);
            logger.debug('Email content:', { to, subject, html });

            // In production, integrate with actual email service
            // For demo, we'll simulate successful sending
            await this.simulateEmailDelivery();

            const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            logger.info(`Email sent successfully to ${to} with ID: ${messageId}`);

            return {
                success: true,
                messageId,
                to,
                subject,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Email sending failed:', error);
            throw error;
        }
    }

    /**
     * Send password reset email
     * @param {string} to - Recipient email
     * @param {string} resetToken - Password reset token
     * @returns {Promise<Object>} Email sending result
     */
    async sendPasswordResetEmail(to, resetToken) {
        const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    .header {
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 10px 10px 0 0;
                    }
                    .content {
                        background: #f9f9f9;
                        padding: 30px;
                        border-radius: 0 0 10px 10px;
                    }
                    .button {
                        display: inline-block;
                        padding: 12px 24px;
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        text-decoration: none;
                        border-radius: 50px;
                        margin: 20px 0;
                        font-weight: bold;
                    }
                    .footer {
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        text-align: center;
                        color: #666;
                        font-size: 12px;
                    }
                    .warning {
                        background: #fff3cd;
                        border: 1px solid #ffeeba;
                        color: #856404;
                        padding: 10px;
                        border-radius: 5px;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🍔 CraveDash</h1>
                </div>
                <div class="content">
                    <h2>Password Reset Request</h2>
                    <p>Hello,</p>
                    <p>We received a request to reset your password for your CraveDash account. Click the button below to create a new password:</p>
                    
                    <div style="text-align: center;">
                        <a href="${resetUrl}" class="button">Reset Password</a>
                    </div>
                    
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 5px;">${resetUrl}</p>
                    
                    <div class="warning">
                        <strong>⚠️ This link will expire in 1 hour</strong>
                    </div>
                    
                    <p>If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
                    
                    <p>Best regards,<br>The CraveDash Team</p>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} CraveDash. All rights reserved.</p>
                    <p>This is an automated message, please do not reply to this email.</p>
                </div>
            </body>
            </html>
        `;

        return this.sendEmail(to, 'Password Reset Request - CraveDash', html);
    }

    /**
     * Send order confirmation email
     * @param {string} to - Recipient email
     * @param {Object} order - Order details
     * @returns {Promise<Object>} Email sending result
     */
    async sendOrderConfirmation(to, order) {
        const itemsList = order.items.map(item => `
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product_name}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${this.formatKsh(item.price)}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${this.formatKsh(item.price * item.quantity)}</td>
            </tr>
        `).join('');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    .header {
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 10px 10px 0 0;
                    }
                    .content {
                        background: #f9f9f9;
                        padding: 30px;
                        border-radius: 0 0 10px 10px;
                    }
                    .order-details {
                        background: white;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 20px 0;
                    }
                    th {
                        background: #f0f0f0;
                        padding: 10px;
                        text-align: left;
                    }
                    .total {
                        font-size: 18px;
                        font-weight: bold;
                        text-align: right;
                        margin-top: 20px;
                        padding-top: 10px;
                        border-top: 2px solid #F77F00;
                    }
                    .status {
                        display: inline-block;
                        padding: 5px 15px;
                        background: #ffd700;
                        border-radius: 50px;
                        font-weight: bold;
                        text-transform: uppercase;
                        font-size: 12px;
                    }
                    .footer {
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        text-align: center;
                        color: #666;
                        font-size: 12px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🍔 CraveDash</h1>
                </div>
                <div class="content">
                    <h2>Order Confirmation</h2>
                    <p>Thank you for your order, <strong>${order.customer_name}</strong>!</p>
                    
                    <div class="order-details">
                        <h3>Order #${order.id}</h3>
                        <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
                        <p><strong>Status:</strong> <span class="status">${order.status}</span></p>
                        <p><strong>Phone:</strong> ${order.phone}</p>
                        
                        <table>
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th style="text-align: center;">Qty</th>
                                    <th style="text-align: right;">Price</th>
                                    <th style="text-align: right;">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsList}
                            </tbody>
                        </table>
                        
                        <div class="total">
                            Total: ${this.formatKsh(order.total)}
                        </div>
                    </div>
                    
                    <h3>What's Next?</h3>
                    <ol>
                        <li><strong>Payment:</strong> Complete your payment to confirm the order</li>
                        <li><strong>Preparation:</strong> Once paid, our kitchen will start preparing your food</li>
                        <li><strong>Delivery:</strong> A delivery partner will be assigned and bring your order</li>
                    </ol>
                    
                    <p>You can track your order status in your dashboard.</p>
                    
                    <p>Best regards,<br>The CraveDash Team</p>
                </div>
                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} CraveDash. All rights reserved.</p>
                    <p>Hungry? We're always here for you!</p>
                </div>
            </body>
            </html>
        `;

        return this.sendEmail(to, `Order Confirmation #${order.id} - CraveDash`, html);
    }

    /**
     * Send delivery assignment email to delivery personnel
     * @param {string} to - Delivery person's email
     * @param {Object} order - Order details
     * @returns {Promise<Object>} Email sending result
     */
    async sendDeliveryAssignment(to, order) {
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    .header {
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 10px 10px 0 0;
                    }
                    .content {
                        background: #f9f9f9;
                        padding: 30px;
                        border-radius: 0 0 10px 10px;
                    }
                    .assignment-box {
                        background: white;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                        border-left: 4px solid #F77F00;
                    }
                    .button {
                        display: inline-block;
                        padding: 12px 24px;
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        text-decoration: none;
                        border-radius: 50px;
                        margin: 20px 0;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🍔 CraveDash Delivery</h1>
                </div>
                <div class="content">
                    <h2>New Delivery Assignment</h2>
                    <p>You have been assigned a new delivery order!</p>
                    
                    <div class="assignment-box">
                        <h3>Order #${order.id}</h3>
                        <p><strong>Customer:</strong> ${order.customer_name}</p>
                        <p><strong>Phone:</strong> ${order.phone}</p>
                        <p><strong>Total:</strong> ${this.formatKsh(order.total)}</p>
                        <p><strong>Status:</strong> ${order.status}</p>
                        
                        <h4>Items to Deliver:</h4>
                        <ul>
                            ${order.items.map(item => `
                                <li>${item.product_name} x ${item.quantity}</li>
                            `).join('')}
                        </ul>
                    </div>
                    
                    <div style="text-align: center;">
                        <a href="http://localhost:3000/dashboard" class="button">View in Dashboard</a>
                    </div>
                    
                    <p>Please check your dashboard for more details and to update the delivery status.</p>
                    
                    <p>Safe travels!<br>The CraveDash Team</p>
                </div>
            </body>
            </html>
        `;

        return this.sendEmail(to, `New Delivery Assignment - Order #${order.id}`, html);
    }

    /**
     * Send order status update email to customer
     * @param {string} to - Customer email
     * @param {Object} order - Order details
     * @returns {Promise<Object>} Email sending result
     */
    async sendOrderStatusUpdate(to, order) {
        const statusMessages = {
            'paid': 'Your payment has been confirmed! Our kitchen will start preparing your order soon.',
            'preparing': 'Your order is now being prepared by our chefs.',
            'out_for_delivery': 'Great news! Your order is out for delivery.',
            'delivered': 'Your order has been delivered. Enjoy your meal!'
        };

        const statusColors = {
            'paid': '#4caf50',
            'preparing': '#2196f3',
            'out_for_delivery': '#ff9800',
            'delivered': '#9e9e9e'
        };

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        line-height: 1.6;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    .header {
                        background: linear-gradient(45deg, #D62828, #F77F00);
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 10px 10px 0 0;
                    }
                    .content {
                        background: #f9f9f9;
                        padding: 30px;
                        border-radius: 0 0 10px 10px;
                    }
                    .status-badge {
                        display: inline-block;
                        padding: 8px 20px;
                        background: ${statusColors[order.status] || '#666'};
                        color: white;
                        border-radius: 50px;
                        font-weight: bold;
                        text-transform: uppercase;
                        margin: 10px 0;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🍔 CraveDash</h1>
                </div>
                <div class="content">
                    <h2>Order Status Update</h2>
                    <p>Hello ${order.customer_name},</p>
                    
                    <div style="text-align: center;">
                        <div class="status-badge">${order.status.replace(/_/g, ' ')}</div>
                    </div>
                    
                    <p style="font-size: 18px; text-align: center;">${statusMessages[order.status] || 'Your order status has been updated.'}</p>
                    
                    <p><strong>Order #:</strong> ${order.id}</p>
                    
                    ${order.delivery_name ? `<p><strong>Delivery Person:</strong> ${order.delivery_name}</p>` : ''}
                    
                    <p>You can track your order in real-time on your dashboard.</p>
                    
                    <p>Thank you for choosing CraveDash!</p>
                </div>
            </body>
            </html>
        `;

        const subject = `Order Update #${order.id}: ${order.status.replace(/_/g, ' ').toUpperCase()}`;
        return this.sendEmail(to, subject, html);
    }

    /**
     * Simulate email delivery (for development)
     * @returns {Promise<void>}
     */
    async simulateEmailDelivery() {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    /**
     * Send bulk emails (for notifications)
     * @param {Array} recipients - Array of recipient emails
     * @param {string} subject - Email subject
     * @param {Function} templateFn - Function to generate HTML per recipient
     * @returns {Promise<Array>} Results
     */
    async sendBulkEmails(recipients, subject, templateFn) {
        const results = [];

        for (const recipient of recipients) {
            try {
                const html = templateFn(recipient);
                const result = await this.sendEmail(recipient.email, subject, html);
                results.push({ ...result, success: true });
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                logger.error(`Failed to send bulk email to ${recipient.email}:`, error);
                results.push({
                    email: recipient.email,
                    success: false,
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = new EmailService();
