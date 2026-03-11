// Cart management using localStorage
const cart = {
    formatKsh(amount) {
        return `KSh ${Number(amount || 0).toLocaleString('en-KE', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        })}`;
    },

    // Get cart from localStorage
    getCart() {
        const cartStr = localStorage.getItem('cart');
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

    // Save cart to localStorage
    saveCart(cartItems) {
        localStorage.setItem('cart', JSON.stringify(cartItems));
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
        localStorage.removeItem('cart');
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

// Initialize cart on page load
document.addEventListener('DOMContentLoaded', () => {
    cart.updateCartUI();
    cart.emitCartUpdated();
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
                statusDiv.style.display = 'block';
                statusDiv.className = 'payment-status';
                statusDiv.innerHTML = '<div class="alert alert-info">Initiating M-Pesa payment...</div>';
            }
            
            try {
                const response = await api.initiateSTKPush(orderId, phone);
                
                if (response.success) {
                    // Payment initiated successfully - data is nested in response.data
                    const checkoutId = response.data.checkoutRequestId;
                    const isSimulated = response.data.simulated || false;
                    
                    statusDiv.innerHTML = '<div class="alert alert-info">' + 
                        'Please check your phone and enter your M-Pesa PIN to complete the payment.<br>' +
                        'Checkout ID: ' + checkoutId + 
                        '</div>';
                    
                    submitBtn.textContent = 'Waiting for Payment...';
                    
                    // Store checkout request ID for potential query
                    sessionStorage.setItem('pendingCheckoutId', checkoutId);
                    sessionStorage.setItem('pendingOrderId', orderId);
                    
                    // For demo/simulation purposes, we provide a way to simulate the callback
                    // In production, you would wait for the actual M-Pesa callback
                    
                    if (isSimulated) {
                        statusDiv.innerHTML += '<div class="alert alert-warning" style="margin-top:10px;">' +
                            '<strong>Demo Mode:</strong> Since M-Pesa is in sandbox/simulation, ' +
                            'the payment will be auto-confirmed in a few seconds. ' +
                            'In production, you would receive an actual M-Pesa prompt on your phone.</div>';
                        
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
                                    statusDiv.innerHTML = '<div class="alert alert-success">' +
                                        'Payment successful! Receipt: ' + simulateResult.data.receiptNumber + 
                                        '</div>';
                                    
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
                        // Real M-Pesa - start polling for payment status
                        statusDiv.innerHTML += '<div class="alert alert-info" style="margin-top:10px;">' +
                            '<strong>Waiting for payment confirmation...</strong><br>' +
                            'If you completed payment but status doesn\'t update, the callback URL may not be configured correctly.</div>';
                        
                        // Poll for payment status every 5 seconds
                        const maxAttempts = 24; // Poll for up to 2 minutes
                        let attempts = 0;
                        
                        const pollInterval = setInterval(async () => {
                            attempts++;
                            try {
                                const statusResult = await api.queryPaymentStatus(checkoutId);
                                
                                if (statusResult.success && statusResult.data.resultCode === 0) {
                                    clearInterval(pollInterval);
                                    statusDiv.innerHTML = '<div class="alert alert-success">' +
                                        'Payment successful! Order has been paid.</div>';
                                    
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
                                } else if (attempts >= maxAttempts) {
                                    clearInterval(pollInterval);
                                    statusDiv.innerHTML += '<div class="alert alert-warning" style="margin-top:10px;">' +
                                        'Still waiting for payment confirmation. Please check your phone and try again.</div>';
                                    submitBtn.disabled = false;
                                    submitBtn.textContent = 'Pay with M-Pesa';
                                }
                            } catch (err) {
                                console.error('Status poll error:', err);
                            }
                        }, 15000);
                    }
                } else {
                    // Payment initiation failed
                    statusDiv.innerHTML = '<div class="alert alert-danger">' +
                        'Payment failed: ' + (response.message || response.responseDescription || 'Unknown error') + 
                        '</div>';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Pay with M-Pesa';
                }
            } catch (error) {
                statusDiv.innerHTML = '<div class="alert alert-danger">' +
                    'Error: ' + error.message + 
                    '</div>';
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
