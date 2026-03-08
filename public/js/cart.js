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
            
            try {
                const response = await api.initiateSTKPush(orderId, phone);
                
                if (response.success) {
                    alert('STK push initiated! In a real app, you would receive a prompt on your phone.\nFor demo, the payment will be simulated.');
                    
                    // Simulate callback after 3 seconds
                    setTimeout(async () => {
                        // Simulate successful payment callback
                        const callbackResponse = await fetch('/api/payments/stk-callback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                orderId: orderId,
                                resultCode: 0,
                                resultDesc: 'Success',
                                mpesaReceiptNumber: `SIM${Date.now()}`
                            })
                        });
                        
                        if (callbackResponse.ok) {
                            alert('Payment successful! Your order is being processed.');
                            document.getElementById('paymentModal').style.display = 'none';
                            // Refresh dashboard
                            if (typeof loadDashboard === 'function') {
                                loadDashboard();
                            }
                        }
                    }, 3000);
                }
            } catch (error) {
                alert('Payment failed: ' + error.message);
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
