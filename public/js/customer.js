let currentCustomer = null;
let customerOrdersCache = {};
const CANCELLATION_WINDOW_MS = 10 * 60 * 1000;
const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;

    currentCustomer = auth.getCurrentUser();
    await refreshCurrentCustomer();

    if (!currentCustomer || currentCustomer.role !== 'customer') {
        window.location.href = '/dashboard';
        return;
    }

    renderCustomerHeader();
    initializeFloatingCartButton();
    bindCancellationForm();
    await loadCustomerPageContent();
});

async function refreshCurrentCustomer() {
    try {
        const response = await api.getCurrentUser();
        currentCustomer = response.data;
        auth.updateCurrentUser(currentCustomer);
    } catch (error) {
        console.error('Failed to refresh customer profile:', error);
    }
}

function renderCustomerHeader() {
    const nameElement = document.getElementById('userName');
    const roleElement = document.getElementById('userRole');

    if (nameElement) nameElement.textContent = currentCustomer.name;
    if (roleElement) roleElement.textContent = currentCustomer.role.toUpperCase();
}

function initializeFloatingCartButton() {
    const headerCartButton = document.getElementById('headerCartBtn');
    const headerCartCount = document.getElementById('headerCartCount');
    const floatingCartButton = document.getElementById('floatingCartBtn');
    const floatingCartCount = document.getElementById('floatingCartCount');

    // Update both header and floating cart buttons
    const updateCartCounts = (countOverride = null) => {
        const itemCount = countOverride === null ? cart.getItemCount() : countOverride;
        
        // Update header cart button if exists
        if (headerCartButton && headerCartCount) {
            headerCartCount.textContent = String(itemCount);
            headerCartButton.classList.toggle('has-items', itemCount > 0);
        }
        
        // Update floating cart button if exists
        if (floatingCartButton && floatingCartCount) {
            floatingCartCount.textContent = String(itemCount);
            floatingCartButton.classList.toggle('has-items', itemCount > 0);
        }
    };

    const animateCartButtons = () => {
        // Animate header cart button if exists
        if (headerCartButton) {
            headerCartButton.classList.remove('cart-bump');
            void headerCartButton.offsetWidth;
            headerCartButton.classList.add('cart-bump');
        }
        
        // Animate floating cart button if exists
        if (floatingCartButton) {
            floatingCartButton.classList.remove('cart-bump');
            void floatingCartButton.offsetWidth;
            floatingCartButton.classList.add('cart-bump');
        }
    };

    updateCartCounts();

    window.addEventListener('cart:updated', (event) => {
        const count = event.detail && typeof event.detail.count === 'number' ? event.detail.count : null;
        updateCartCounts(count);
    });

    window.addEventListener('cart:item-added', () => {
        updateCartCounts();
        animateCartButtons();
    });
}

function bindCancellationForm() {
    const cancelOrderForm = document.getElementById('cancelOrderForm');
    if (!cancelOrderForm) return;

    cancelOrderForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const orderId = Number(document.getElementById('cancelOrderId').value);
        const reason = String(document.getElementById('cancelReason').value || '').trim();
        const submitButton = cancelOrderForm.querySelector('button[type="submit"]');

        if (!orderId || !reason) {
            cart.showNotification('Please provide a cancellation reason.');
            return;
        }

        try {
            submitButton.disabled = true;
            submitButton.textContent = 'Submitting...';

            const response = await api.cancelOrder(orderId, reason);
            closeModal('cancelModal');
            cancelOrderForm.reset();
            cart.showNotification(response.message || 'Order cancelled successfully.');
            await loadCustomerOrders();
        } catch (error) {
            cart.showNotification(error.message || 'Failed to cancel order.');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Cancellation';
        }
    });
}

function getCancellationState(order) {
    if (!order || !['pending', 'paid'].includes(order.status)) {
        return { eligible: false, timeLeftMs: 0, label: '' };
    }

    const createdAt = new Date(order.created_at);
    const elapsed = Date.now() - createdAt.getTime();
    const timeLeftMs = CANCELLATION_WINDOW_MS - elapsed;

    if (!Number.isFinite(timeLeftMs) || timeLeftMs <= 0) {
        return { eligible: false, timeLeftMs: 0, label: '' };
    }

    const minutes = Math.floor(timeLeftMs / 60000);
    const seconds = Math.floor((timeLeftMs % 60000) / 1000);

    return {
        eligible: true,
        timeLeftMs,
        label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    };
}

function openCancelModal(orderId) {
    const order = customerOrdersCache[orderId];
    if (!order) {
        cart.showNotification('Unable to load this order.');
        return;
    }

    const cancellationState = getCancellationState(order);
    if (!cancellationState.eligible) {
        cart.showNotification('This order is no longer eligible for cancellation.');
        return;
    }

    const orderIdInput = document.getElementById('cancelOrderId');
    const reasonInput = document.getElementById('cancelReason');
    const modal = document.getElementById('cancelModal');

    if (!orderIdInput || !reasonInput || !modal) {
        cart.showNotification('Cancellation dialog is not available on this page.');
        return;
    }

    orderIdInput.value = String(orderId);
    reasonInput.value = '';
    modal.style.display = 'block';
    reasonInput.focus();
}

async function loadCustomerPageContent() {
    if (document.getElementById('customer-products')) {
        await loadCustomerProducts();
    }

    if (document.getElementById('cart-items')) {
        cart.updateCartUI();
    }

    if (document.getElementById('customer-orders')) {
        await loadCustomerOrders();
    }
}

async function loadCustomerProducts() {
    try {
        const response = await api.getProducts(true);
        const products = response.data;
        const container = document.getElementById('customer-products');

        container.innerHTML = products.map(product => `
            <div class="product-card">
                <div class="product-image">${product.image || '🍔'}</div>
                <h3>${product.name}</h3>
                <div class="product-price">${formatKsh(product.price)}</div>
                <button class="btn btn-primary" onclick="cart.addItem(${JSON.stringify(product).replace(/"/g, '&quot;')})">
                    Add to Cart
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load products:', error);
    }
}

async function loadCustomerOrders() {
    try {
        const response = await api.getMyOrders();
        const orders = response.data;
        customerOrdersCache = orders.reduce((acc, order) => {
            acc[order.id] = order;
            return acc;
        }, {});
        const container = document.getElementById('customer-orders');

        if (orders.length === 0) {
            container.innerHTML = '<p>No orders yet</p>';
            return;
        }

        container.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <span>
                        Order #${order.id}
                        ${getCancellationState(order).eligible ? '<span class="cancel-eligible-badge">Can Cancel</span>' : ''}
                    </span>
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div class="order-details">
                    <p>Total: ${formatKsh(order.total)}</p>
                    <p>Date: ${new Date(order.created_at).toLocaleString()}</p>
                    ${order.delivery_name ? `<p>Delivery: ${order.delivery_name}</p>` : ''}
                    ${getCancellationState(order).eligible ? `<p class="cancel-time">Cancellation window ends in <span class="countdown">${getCancellationState(order).label}</span></p>` : ''}
                </div>
                <div class="order-items">
                    ${order.items.map(item => `
                        <div class="order-item">
                            <span>${item.product_name} x${item.quantity}</span>
                            <span>${formatKsh(item.price * item.quantity)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="order-actions">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-primary" onclick="showPaymentModal(${order.id}, ${order.total})">
                            Pay Now
                        </button>
                        <button class="btn btn-secondary" onclick="startOrderEdit(${order.id})">
                            Edit Order
                        </button>
                    ` : ''}
                    ${getCancellationState(order).eligible ? `
                        <button class="btn btn-danger" onclick="requestOrderCancellation(${order.id})">
                            Cancel Order
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load orders:', error);
    }
}

function startOrderEdit(orderId) {
    const order = customerOrdersCache[orderId];
    if (!order) {
        cart.showNotification('Unable to load this order for editing.');
        return;
    }

    const loaded = cart.loadOrderIntoCart(order);
    if (!loaded) {
        return;
    }

    window.location.href = '/customer/cart';
}

window.startOrderEdit = startOrderEdit;

function showPaymentModal(orderId, amount) {
    const modal = document.getElementById('paymentModal');
    const orderIdInput = document.getElementById('orderId');
    const paymentAmount = document.getElementById('paymentAmount');

    if (!modal || !orderIdInput || !paymentAmount) {
        alert('Payment dialog is not available on this page.');
        return;
    }

    orderIdInput.value = orderId;
    paymentAmount.textContent = formatKsh(amount);
    modal.style.display = 'block';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

function checkout() {
    cart.checkout();
}

function clearCart() {
    if (confirm('Clear all items from cart?')) {
        cart.clearCart();
    }
}

// Expose functions globally
window.checkout = checkout;
window.clearCart = clearCart;
window.closeModal = closeModal;
window.requestOrderCancellation = openCancelModal;
