// Cart management using sessionStorage
const cart = {
    formatKsh(amount) {
        return `KSh ${Number(amount || 0).toLocaleString('en-KE', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        })}`;
    },

    // Get cart from sessionStorage
    getCart() {
        const cartStr = sessionStorage.getItem('cart');
        return cartStr ? JSON.parse(cartStr) : [];
    },

    emitCartUpdated() {
        window.dispatchEvent(new CustomEvent('cart:updated', {
            detail: {
                count: this.getItemCount(),
                total: this.getTotal()
            }
        }));
    },

    // Save cart to sessionStorage
    saveCart(cartItems) {
        sessionStorage.setItem('cart', JSON.stringify(cartItems));
        this.updateCartUI();
        this.emitCartUpdated();
    },

    // Add item to cart
    addItem(product, quantity = 1) {
        const cart = this.getCart();
        const existingItem = cart.find(item => item.id === product.id);

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: product.price,
                quantity: quantity,
                image: product.image
            });
        }

        this.saveCart(cart);
        window.dispatchEvent(new CustomEvent('cart:item-added', {
            detail: {
                productId: product.id,
                count: this.getItemCount()
            }
        }));
        this.showNotification(`${product.name} added to cart!`);
    },

    // Remove item from cart
    removeItem(productId) {
        const cart = this.getCart();
        const updatedCart = cart.filter(item => item.id !== productId);
        this.saveCart(updatedCart);
    },

    // Update item quantity
    updateQuantity(productId, newQuantity) {
        if (newQuantity < 1) {
            this.removeItem(productId);
            return;
        }

        const cart = this.getCart();
        const item = cart.find(item => item.id === productId);
        
        if (item) {
            item.quantity = newQuantity;
            this.saveCart(cart);
        }
    },

    // Clear cart
    clearCart() {
        sessionStorage.removeItem('cart');
        this.updateCartUI();
        this.emitCartUpdated();
        sessionStorage.removeItem('replacingOrderId');
    },

    loadOrderIntoCart(order) {
        if (!order || !Array.isArray(order.items) || order.items.length === 0) {
            this.showNotification('Cannot load an empty order for editing.');
            return false;
        }

        const orderItems = order.items.map(item => ({
            id: item.product_id,
            name: item.product_name,
            price: item.price,
            quantity: item.quantity,
            image: item.image
        }));

        sessionStorage.setItem('replacingOrderId', String(order.id));
        this.saveCart(orderItems);
        this.showNotification(`Loaded order #${order.id} for editing. Update the cart and checkout again.`);

        return true;
    },

    // Get cart total
    getTotal() {
        const cart = this.getCart();
        return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },

    // Get item count
    getItemCount() {
        const cart = this.getCart();
        return cart.reduce((sum, item) => sum + item.quantity, 0);
    },

    // Update cart UI
    updateCartUI() {
        const cartContainer = document.getElementById('cart-items');
        const cartTotal = document.getElementById('cart-total');
        
        if (!cartContainer || !cartTotal) return;

        const cart = this.getCart();

        if (cart.length === 0) {
            cartContainer.innerHTML = '<p class="empty-cart">Your cart is empty</p>';
            cartTotal.textContent = this.formatKsh(0);
            return;
        }

        let html = '';
        cart.forEach(item => {
            html += `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <strong>${item.name}</strong><br>
                        ${this.formatKsh(item.price)} x ${item.quantity}
                    </div>
                    <div class="cart-item-actions">
                        <button onclick="cart.updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
                        <span>${item.quantity}</span>
                        <button onclick="cart.updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                        <button onclick="cart.removeItem(${item.id})" class="remove-btn">×</button>
                    </div>
                </div>
            `;
        });

        cartContainer.innerHTML = html;
        cartTotal.textContent = this.formatKsh(this.getTotal());

        // Update cart count in header if exists
        const cartCount = document.getElementById('cart-count');
        if (cartCount) {
            cartCount.textContent = this.getItemCount();
        }
    },

    // Show notification
    showNotification(message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'alert alert-success';
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.top = '80px';
        notification.style.right = '20px';
        notification.style.zIndex = '3000';
        notification.style.animation = 'slideIn 0.3s ease';

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    },

    // Show delivery form modal
    showDeliveryForm() {
        if (!auth.isAuthenticated()) {
            window.location.href = '/login?redirect=cart';
            return;
        }

        const cart = this.getCart();
        if (cart.length === 0) {
            this.showNotification('Your cart is empty!');
            return;
        }

        // Update order total in the delivery modal
        const deliveryOrderTotal = document.getElementById('deliveryOrderTotal');
        if (deliveryOrderTotal) {
            deliveryOrderTotal.textContent = this.formatKsh(this.getTotal());
        }

        // Show delivery modal
        const deliveryModal = document.getElementById('deliveryModal');
        if (deliveryModal) {
            deliveryModal.style.display = 'block';
        }
    },

    // Process delivery form and create order
    async processDeliveryForm(phone, deliveryAddress) {
        const cart = this.getCart();
        
        const orderData = {
            items: cart.map(item => ({
                id: item.id,
                quantity: item.quantity,
                price: item.price
            })),
            total: this.getTotal(),
            phone: phone,
            deliveryAddress: deliveryAddress
        };
        const replacingOrderId = sessionStorage.getItem('replacingOrderId');
        if (replacingOrderId) {
            orderData.replacesOrderId = Number(replacingOrderId);
        }

        try {
            const response = await api.createOrder(orderData);
            
            if (response.success) {
                // Close delivery modal
                const deliveryModal = document.getElementById('deliveryModal');
                if (deliveryModal) {
                    deliveryModal.style.display = 'none';
                }
                
                // Clear cart after successful order
                this.clearCart();
                
                // Show payment modal for the new order
                const paymentModal = document.getElementById('paymentModal');
                const orderIdInput = document.getElementById('orderId');
                const paymentAmount = document.getElementById('paymentAmount');
                
                orderIdInput.value = response.data.id;
                paymentAmount.textContent = this.formatKsh(response.data.total);
                
                // Pre-fill phone in payment form
                const phoneInput = document.getElementById('phone');
                if (phoneInput) {
                    phoneInput.value = phone;
                }
                
                paymentModal.style.display = 'block';
                
                this.showNotification('Order created! Please complete payment.');
            }
        } catch (error) {
            this.showNotification('Failed to create order: ' + error.message);
        }
    },

    // Legacy checkout function (kept for compatibility)
    async checkout() {
        this.showDeliveryForm();
    }
};

let paymentPollInterval = null;

function handleRealtimePaymentUpdate(payload) {
    const pendingOrderId = sessionStorage.getItem('pendingOrderId');
    if (!pendingOrderId || String(payload.orderId) !== String(pendingOrderId)) {
        return;
    }

    const statusDiv = document.getElementById('paymentStatus');
    if (!statusDiv) {
        return;
    }

    if (paymentPollInterval) {
        clearInterval(paymentPollInterval);
        paymentPollInterval = null;
    }

    renderPaymentStatus(
        statusDiv,
        'success',
        'Payment confirmed',
        'Your order has been paid successfully.'
    );

    setTimeout(() => {
        const paymentModal = document.getElementById('paymentModal');
        if (paymentModal) {
            paymentModal.style.display = 'none';
        }
        cart.clearCart();
        cart.showNotification('Payment successful! Your order is being processed.');
        sessionStorage.removeItem('pendingCheckoutId');
        sessionStorage.removeItem('pendingOrderId');
        sessionStorage.removeItem('pendingPaymentExpiresAt');
        const paymentForm = document.getElementById('paymentForm');
        if (paymentForm) {
            paymentForm.reset();
            const submitBtn = paymentForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Pay with M-Pesa';
            }
        }
        statusDiv.style.display = 'none';

        if (typeof loadDashboard === 'function') {
            loadDashboard();
        }
    }, 1500);
}

const PAYMENT_POLL_INTERVAL_MS = 15000;

function renderPaymentStatus(statusDiv, state, title, body) {
    if (!statusDiv) return;

    statusDiv.style.display = 'block';
    statusDiv.className = `payment-status ${state}`;
    statusDiv.innerHTML = `
        <div class="payment-status-card">
            <div class="payment-status-title-row">
                ${state === 'pending' ? '<span class="spinner" aria-hidden="true"></span>' : ''}
                <strong class="payment-status-title">${title}</strong>
            </div>
            ${body ? `<p class="payment-status-copy">${body}</p>` : ''}
        </div>
    `;
}

// Initialize cart on page load
document.addEventListener('DOMContentLoaded', () => {
    cart.updateCartUI();
    cart.emitCartUpdated();

    if (window.socketClient && typeof window.socketClient.connect === 'function') {
        window.socketClient.connect();
        window.socketClient.on('paymentConfirmed', handleRealtimePaymentUpdate);
        window.socketClient.on('orderStatusUpdated', (payload) => {
            if (payload.status === 'paid') {
                handleRealtimePaymentUpdate(payload);
            }
        });
    }
});

// Payment form handler
document.addEventListener('DOMContentLoaded', () => {
    const paymentForm = document.getElementById('paymentForm');
    if (paymentForm) {
        paymentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const orderId = document.getElementById('orderId').value;
            const phone = document.getElementById('phone').value;
            const submitBtn = paymentForm.querySelector('button[type="submit"]');
            const statusDiv = document.getElementById('paymentStatus');
            
            // Disable button and show loading state
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
            
            if (statusDiv) {
                renderPaymentStatus(
                    statusDiv,
                    'pending',
                    'Starting M-Pesa request',
                    'We are sending the payment prompt to your phone now.'
                );
            }
            
            try {
                const response = await api.initiateSTKPush(orderId, phone);
                
                if (response.success) {
                    // Payment initiated successfully - data is nested in response.data
                    const checkoutId = response.data.checkoutRequestId;
                    const isSimulated = response.data.simulated || false;
                    const paymentWindowMs = Number(response.data.paymentWindowMs || 120000);
                    const paymentExpiresAt = response.data.paymentExpiresAt || new Date(Date.now() + paymentWindowMs).toISOString();
                    
                    renderPaymentStatus(
                        statusDiv,
                        'pending',
                        'Approve the payment on your phone',
                        `Open the M-Pesa prompt on ${phone} and complete the request within about ${Math.ceil(paymentWindowMs / 60000)} minute(s).`
                    );
                    
                    submitBtn.textContent = 'Waiting for Payment...';
                    
                    // Store checkout request ID for potential query
                    sessionStorage.setItem('pendingCheckoutId', checkoutId);
                    sessionStorage.setItem('pendingOrderId', orderId);
                    sessionStorage.setItem('pendingPaymentExpiresAt', paymentExpiresAt);
                    
                    // For demo/simulation purposes, we provide a way to simulate the callback
                    // In production, you would wait for the actual M-Pesa callback
                    
                    if (isSimulated) {
                        renderPaymentStatus(
                            statusDiv,
                            'pending',
                            'Approve the payment on your phone',
                            'Demo mode is active. The payment result will be confirmed automatically after a short delay.'
                        );
                        
                        // Simulate callback after delay (for demo only)
                        setTimeout(async () => {
                            try {
                                const simulateResponse = await fetch('/api/payments/simulate-callback', {
                                    method: 'POST',
                                    headers: api.getHeaders(),
                                    body: JSON.stringify({
                                        orderId: orderId,
                                        checkoutRequestId: checkoutId,
                                        success: true
                                    })
                                });
                                
                                const simulateResult = await simulateResponse.json();
                                
                                if (simulateResult.success) {
                                    renderPaymentStatus(
                                        statusDiv,
                                        'success',
                                        'Payment confirmed',
                                        `Receipt ${simulateResult.data.receiptNumber} has been recorded successfully.`
                                    );
                                    
                                    setTimeout(() => {
                                        document.getElementById('paymentModal').style.display = 'none';
                                        cart.clearCart();
                                        cart.showNotification('Payment successful! Your order is being processed.');
                                        
                                        // Refresh dashboard
                                        if (typeof loadDashboard === 'function') {
                                            loadDashboard();
                                        }
                                        
                                        // Reset form
                                        paymentForm.reset();
                                        submitBtn.disabled = false;
                                        submitBtn.textContent = 'Pay with M-Pesa';
                                        statusDiv.style.display = 'none';
                                    }, 2000);
                                }
                            } catch (err) {
                                console.error('Simulation error:', err);
                            }
                        }, 5000);
                    } else {
                        const maxAttempts = Math.max(1, Math.ceil(paymentWindowMs / PAYMENT_POLL_INTERVAL_MS));
                        let attempts = 0;
                        
                        paymentPollInterval = setInterval(async () => {
                            attempts++;
                            try {
                                const statusResult = await api.queryPaymentStatus(checkoutId);
                                const paymentStatus = statusResult.data || {};
                                
                                if (statusResult.success && paymentStatus.paymentConfirmed === true) {
                                    clearInterval(paymentPollInterval);
                                    paymentPollInterval = null;
                                    renderPaymentStatus(
                                        statusDiv,
                                        'success',
                                        'Payment confirmed',
                                        'Your order has been paid successfully.'
                                    );
                                    
                                    setTimeout(() => {
                                        document.getElementById('paymentModal').style.display = 'none';
                                        cart.clearCart();
                                        cart.showNotification('Payment successful! Your order is being processed.');
                                        sessionStorage.removeItem('pendingCheckoutId');
                                        sessionStorage.removeItem('pendingOrderId');
                                        sessionStorage.removeItem('pendingPaymentExpiresAt');
                                        
                                        // Refresh dashboard
                                        if (typeof loadDashboard === 'function') {
                                            loadDashboard();
                                        }
                                        
                                        // Reset form
                                        paymentForm.reset();
                                        submitBtn.disabled = false;
                                        submitBtn.textContent = 'Pay with M-Pesa';
                                        statusDiv.style.display = 'none';
                                    }, 2000);
                                } else if (
                                    paymentStatus.resultCode === 1037 ||
                                    paymentStatus.state === 'timed_out' ||
                                    attempts >= maxAttempts ||
                                    Date.now() >= new Date(paymentExpiresAt).getTime()
                                ) {
                                    if (paymentPollInterval) {
                                        clearInterval(paymentPollInterval);
                                        paymentPollInterval = null;
                                    }
                                    renderPaymentStatus(
                                        statusDiv,
                                        'error',
                                        'Action timed out',
                                        'The M-Pesa request expired before confirmation. Your order has returned to pending and can be paid for again.'
                                    );
                                    submitBtn.disabled = false;
                                    submitBtn.textContent = 'Pay with M-Pesa';
                                    sessionStorage.removeItem('pendingCheckoutId');
                                    sessionStorage.removeItem('pendingOrderId');
                                    sessionStorage.removeItem('pendingPaymentExpiresAt');
                                }
                            } catch (err) {
                                console.error('Status poll error:', err);
                            }
                        }, PAYMENT_POLL_INTERVAL_MS);
                    }
                } else {
                    renderPaymentStatus(
                        statusDiv,
                        'error',
                        'Payment could not be started',
                        response.message || response.responseDescription || 'Please try again.'
                    );
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Pay with M-Pesa';
                }
            } catch (error) {
                renderPaymentStatus(
                    statusDiv,
                    'error',
                    'Payment could not be started',
                    error.message || 'Please try again.'
                );
                submitBtn.disabled = false;
                submitBtn.textContent = 'Pay with M-Pesa';
            }
        });
    }

    // Delivery form handler
    const deliveryForm = document.getElementById('deliveryForm');
    if (deliveryForm) {
        deliveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const phone = document.getElementById('deliveryPhone').value;
            const deliveryAddress = document.getElementById('deliveryAddress').value;
            
            if (!phone || !deliveryAddress) {
                cart.showNotification('Please fill in all required fields');
                return;
            }
            
            // Process the delivery form and create order
            await cart.processDeliveryForm(phone, deliveryAddress);
        });
    }
});

// Make cart globally available
window.cart = cart;
