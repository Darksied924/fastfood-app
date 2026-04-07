let currentCustomer = null;
let customerOrdersCache = {};
let cancellationUiInterval = null;
const CANCELLATION_WINDOW_MS = 5 * 60 * 1000;
const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

const formatDateTime = (value) => {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('en-KE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

function setLeafletDebugOverlay(message) {
    const overlay = document.getElementById('leafletDebugOverlay');
    if (!overlay) return;
    overlay.textContent = message || '';
    overlay.style.display = message ? 'block' : 'none';
}

function getPaymentState(order) {
    if (!order || order.status !== 'pending' || !order.payment_in_progress || !order.payment_expires_at) {
        return { active: false, label: '' };
    }

    const expiresAt = new Date(order.payment_expires_at);
    const timeLeftMs = expiresAt.getTime() - Date.now();

    if (Number.isNaN(expiresAt.getTime()) || timeLeftMs <= 0) {
        return { active: false, label: '' };
    }

    const minutes = Math.floor(timeLeftMs / 60000);
    const seconds = Math.floor((timeLeftMs % 60000) / 1000);

    return {
        active: true,
        label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    };
}

function getCancellationReviewMeta(order) {
    const refundStatus = String(order?.refund_status || '').toUpperCase();

    if (order?.status !== 'cancelled') {
        return null;
    }

    if (refundStatus === 'REQUESTED') {
        return {
            badgeClass: 'status-cancelled_review',
            badgeLabel: 'cancelled - under review',
            bannerClass: 'cancellation-review-banner cancellation-review-banner--requested',
            pillClass: 'cancellation-review-banner__pill cancellation-review-banner__pill--requested',
            pillLabel: 'Under review',
            summary: 'Your order was cancelled successfully and the refund review is now in progress.',
            actionLabel: 'View details'
        };
    }

    if (refundStatus === 'APPROVED') {
        return {
            badgeClass: 'status-cancelled_approved',
            badgeLabel: 'cancelled - approved',
            bannerClass: 'cancellation-review-banner cancellation-review-banner--approved',
            pillClass: 'cancellation-review-banner__pill cancellation-review-banner__pill--approved',
            pillLabel: 'Approved',
            summary: 'Your order remains cancelled and the refund review has been approved.',
            actionLabel: 'View details'
        };
    }

    if (refundStatus === 'DENIED') {
        return {
            badgeClass: 'status-cancelled_denied',
            badgeLabel: 'cancelled - denied',
            bannerClass: 'cancellation-review-banner cancellation-review-banner--denied',
            pillClass: 'cancellation-review-banner__pill cancellation-review-banner__pill--denied',
            pillLabel: 'Denied',
            summary: 'Your order remains cancelled, but the refund review was not approved.',
            actionLabel: 'View details'
        };
    }

    return {
        badgeClass: 'status-cancelled',
        badgeLabel: 'cancelled',
        bannerClass: 'cancellation-review-banner',
        pillClass: 'cancellation-review-banner__pill',
        pillLabel: 'Cancelled',
        summary: 'This order has been cancelled.',
        actionLabel: 'View details'
    };
}

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

    const agreement = document.getElementById('cancelAgreement');
    if (agreement) {
        agreement.addEventListener('change', () => {
            updateCancellationPageState();
        });
    }

    cancelOrderForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const orderId = Number(document.getElementById('cancelOrderId').value);
        const reason = String(document.getElementById('cancelReason').value || '').trim();
        const submitButton = cancelOrderForm.querySelector('button[type="submit"]');
        const order = customerOrdersCache[orderId];

        if (!orderId || !reason) {
            cart.showNotification('Please provide a cancellation reason.');
            return;
        }

        if (agreement && !agreement.checked) {
            cart.showNotification('Please confirm that you agree to the cancellation terms.');
            return;
        }

        if (!getCancellationState(order).eligible) {
            cart.showNotification('This order is no longer eligible for cancellation.');
            updateCancellationPageState();
            return;
        }

        try {
            submitButton.disabled = true;
            submitButton.textContent = 'Submitting...';

            const response = await api.cancelOrder(orderId, reason);
            cancelOrderForm.reset();
            cart.showNotification(response.message || 'Order cancelled successfully.');
            window.location.href = '/customer/orders';
        } catch (error) {
            cart.showNotification(error.message || 'Failed to cancel order.');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Confirm cancellation';
        }
    });
}

function getCancellationState(order) {
    if (!order || order.status !== 'paid') {
        return { eligible: false, timeLeftMs: 0, label: '' };
    }

    const paidAt = new Date(order.paid_at || order.created_at);
    const elapsed = Date.now() - paidAt.getTime();
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

function isOrderTrackable(order) {
    if (!order) {
        return false;
    }

    if (order.status === 'out_for_delivery') {
        return true;
    }

    if (order.status === 'paid' && !getCancellationState(order).eligible) {
        return true;
    }

    return false;
}

function openTrackOrder(orderId) {
    window.location.href = `/customer/track-order?orderId=${orderId}`;
}

window.openTrackOrder = openTrackOrder;

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
    window.location.href = `/customer/cancel-order?orderId=${orderId}`;
}

function openCancellationReviewModal(orderId) {
    const order = customerOrdersCache[orderId];
    if (!order) {
        cart.showNotification('Unable to load this cancellation review.');
        return;
    }

    const reviewMeta = getCancellationReviewMeta(order);
    if (!reviewMeta) {
        cart.showNotification('There is no cancellation review update for this order.');
        return;
    }

    const modal = document.getElementById('cancellationReviewModal');
    if (!modal) {
        cart.showNotification('Review dialog is not available on this page.');
        return;
    }

    const refundStatus = String(order.refund_status || '').toUpperCase();
    const note = String(order.refund_admin_notes || '').trim() || (
        refundStatus === 'REQUESTED'
            ? 'Your cancellation is still being reviewed. No admin note has been added yet.'
            : refundStatus === 'APPROVED'
                ? 'The refund review was approved without an additional admin note.'
                : 'No explanation was added to this denial.'
    );
    const reason = String(order.cancellation_reason || '').trim() || 'No cancellation reason was submitted.';
    const summary = refundStatus === 'REQUESTED'
        ? `Order #${order.id} has been cancelled and the refund review is still in progress.`
        : refundStatus === 'APPROVED'
            ? `Order #${order.id} remains cancelled and the refund review was approved.`
            : `Order #${order.id} remains cancelled, but the refund review was denied.`;
    const statusText = refundStatus === 'REQUESTED'
        ? `Refund review is currently under review${order.cancelled_at ? ` since ${formatDateTime(order.cancelled_at)}` : ''}.`
        : `Refund review ${refundStatus.toLowerCase()}${order.refund_processed_at ? ` on ${formatDateTime(order.refund_processed_at)}` : ''}.`;
    const title = refundStatus === 'REQUESTED'
        ? 'Refund request under review'
        : refundStatus === 'APPROVED'
            ? 'Refund request approved'
            : 'Refund request not approved';
    const outcomeLabel = refundStatus === 'REQUESTED'
        ? 'Current status'
        : refundStatus === 'APPROVED'
            ? 'Approved outcome'
            : 'Review outcome';
    const outcomeText = refundStatus === 'REQUESTED'
        ? 'Your cancellation has been recorded and is currently waiting for final refund review.'
        : refundStatus === 'APPROVED'
            ? 'Your refund request has been approved. The order stays cancelled and the approved review is now on record.'
            : 'Your cancellation remains on record, but the refund request itself was not approved.';
    const heroIcon = refundStatus === 'REQUESTED'
        ? '…'
        : refundStatus === 'APPROVED'
            ? '✓'
            : '!';

    const setText = (id, value) => {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = value;
        }
    };

    const pill = document.querySelector('.review-decision-pill');
    const modalContent = document.querySelector('#cancellationReviewModal .review-decision-modal');
    if (pill) {
        pill.textContent = `${reviewMeta.pillLabel} review`;
        pill.className = `review-decision-pill review-decision-pill--${String(refundStatus || 'cancelled').toLowerCase()}`;
    }
    if (modalContent) {
        modalContent.className = `modal-content review-decision-modal review-decision-modal--${String(refundStatus || 'cancelled').toLowerCase()}`;
    }

    setText('reviewDecisionTitle', title);
    setText('reviewDecisionSummary', summary);
    setText('reviewDecisionOutcomeLabel', outcomeLabel);
    setText('reviewDecisionOutcomeText', outcomeText);
    setText('reviewDecisionOrderId', `#${order.id}`);
    setText('reviewDecisionStatusText', statusText);
    setText('reviewDecisionProcessedAt', formatDateTime(order.refund_processed_at || order.cancelled_at));
    setText('reviewDecisionNote', note);
    setText('reviewDecisionReason', reason);
    setText('reviewDecisionHeroIcon', heroIcon);

    modal.style.display = 'block';
}

async function loadCustomerPageContent() {
    if (document.getElementById('cancelTermsPage')) {
        await loadCancellationPage();
        return;
    }

    if (document.getElementById('orderTrackingPage')) {
        await loadTrackOrderPage();
        return;
    }

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

function updateOrderCancellationButtons() {
    document.querySelectorAll('[data-cancel-button]').forEach((button) => {
        const expiresAt = Number(button.dataset.expiresAt || 0);
        if (!expiresAt || Date.now() < expiresAt) {
            return;
        }

        const actions = button.closest('.order-actions');
        button.remove();

        if (actions && actions.querySelectorAll('button').length === 0) {
            actions.remove();
        }
    });
}

async function loadCustomerProducts() {
    try {
        const response = await api.getProducts(true);
        const products = response.data;
        const container = document.getElementById('customer-products');

        container.innerHTML = products.map(product => `
            <div class="product-card">
                <div class="product-image">
                    ${product.image ? `<img src="${product.image}" alt="${product.name}" loading="lazy">` : '🍔'}
                </div>
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
                    </span>
                    <span class="status-badge ${getPaymentState(order).active ? 'status-awaiting_payment' : (getCancellationReviewMeta(order)?.badgeClass || `status-${order.status}`)}">${getPaymentState(order).active ? 'awaiting payment' : (getCancellationReviewMeta(order)?.badgeLabel || order.status)}</span>
                </div>
                <div class="order-details">
                    <p>Total: ${formatKsh(order.total)}</p>
                    <p>Date: ${new Date(order.created_at).toLocaleString()}</p>
                    ${order.delivery_name ? `<p>Delivery: ${order.delivery_name}</p>` : ''}
                    ${getPaymentState(order).active ? `<p class="payment-time">Complete M-Pesa on your phone within <span class="countdown">${getPaymentState(order).label}</span></p>` : ''}
                </div>
                ${getCancellationReviewMeta(order) ? `
                    <div class="${getCancellationReviewMeta(order).bannerClass}">
                        <div>
                            <span class="${getCancellationReviewMeta(order).pillClass}">${getCancellationReviewMeta(order).pillLabel}</span>
                            <p>${getCancellationReviewMeta(order).summary}</p>
                        </div>
                        <button class="btn btn-secondary cancellation-review-banner__action" onclick="viewCancellationReviewNote(${order.id})">
                            ${getCancellationReviewMeta(order).actionLabel}
                        </button>
                    </div>
                ` : ''}
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
                        <button
                            class="btn btn-danger"
                            data-cancel-button
                            data-order-id="${order.id}"
                            data-expires-at="${new Date(order.paid_at || order.created_at).getTime() + CANCELLATION_WINDOW_MS}"
                            onclick="requestOrderCancellation(${order.id})">
                            Cancel Order
                        </button>
                    ` : ''}                    ${!getCancellationState(order).eligible && isOrderTrackable(order) ? `
                        <button
                            class="btn btn-primary"
                            data-track-button
                            onclick="openTrackOrder(${order.id})">
                            Track Order
                        </button>
                    ` : ''}                </div>
            </div>
        `).join('');

        startCancellationUiTicker();
        updateOrderCancellationButtons();
    } catch (error) {
        console.error('Failed to load orders:', error);
    }
}

async function loadCancellationPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = Number(params.get('orderId'));

    if (!orderId) {
        renderCancellationPageUnavailable('We could not find the order you want to cancel.');
        return;
    }

    try {
        const response = await api.getMyOrders();
        const orders = response.data;
        customerOrdersCache = orders.reduce((acc, order) => {
            acc[order.id] = order;
            return acc;
        }, {});

        const order = customerOrdersCache[orderId];
        if (!order) {
            renderCancellationPageUnavailable('That order could not be found in your account.');
            return;
        }

        document.getElementById('cancelOrderId').value = String(order.id);
        document.getElementById('cancelOrderReference').textContent = `#${order.id}`;
        document.getElementById('cancelOrderTotal').textContent = formatKsh(order.total);
        document.getElementById('cancelOrderDate').textContent = formatDateTime(order.created_at);
        document.getElementById('cancelOrderStatus').textContent = order.status;
        document.getElementById('cancelAgreement').checked = false;

        startCancellationUiTicker();
        updateCancellationPageState();
    } catch (error) {
        console.error('Failed to load cancellation page:', error);
        renderCancellationPageUnavailable('We were unable to load the cancellation details for this order.');
    }
}

function renderCancellationPageUnavailable(message) {
    const state = document.getElementById('cancelEligibilityState');
    const countdown = document.getElementById('cancelWindowCountdown');
    const form = document.getElementById('cancelOrderForm');
    const agreement = document.getElementById('cancelAgreement');

    if (state) {
        state.textContent = message;
        state.className = 'cancel-page-status cancel-page-status--error';
    }

    if (countdown) {
        countdown.textContent = 'Not available';
    }

    if (agreement) {
        agreement.disabled = true;
    }

    if (form) {
        form.querySelectorAll('textarea, input, button').forEach((element) => {
            if (element.id !== 'cancelOrderId') {
                element.disabled = true;
            }
        });
    }
}

function renderTrackPageUnavailable(message) {
    const status = document.getElementById('orderTrackingStatus');
    const details = document.getElementById('trackingOrderDetails');
    const map = document.getElementById('orderTrackingMap');

    if (status) {
        status.textContent = message;
        status.className = 'map-status';
    }

    if (details) {
        details.innerHTML = `<p>${message}</p>`;
    }

    if (map) {
        map.innerHTML = '<p style="padding:1rem;">Live tracking is not available for this order.</p>';
    }
}

async function ensureLeafletLoaded() {
    if (typeof L !== 'undefined') {
        return true;
    }

    const existingScript = document.querySelector('script[src*="leaflet"]');
    if (existingScript) {
        if (existingScript.readyState === 'complete' || existingScript.readyState === 'loaded') {
            return typeof L !== 'undefined';
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                existingScript.removeEventListener('load', onLoad);
                existingScript.removeEventListener('error', onError);
                resolve(typeof L !== 'undefined');
            }, 15000);

            const onLoad = () => {
                clearTimeout(timeout);
                resolve(typeof L !== 'undefined');
            };

            const onError = () => {
                clearTimeout(timeout);
                resolve(false);
            };

            existingScript.addEventListener('load', onLoad);
            existingScript.addEventListener('error', onError);
        });
    }

    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.integrity = 'sha256-vZ7pZZUDam96Ca3XyJjz5W1KtJ5VZJriJO+o5s2Z1M4=';
        script.crossOrigin = '';
        script.onload = () => resolve(typeof L !== 'undefined');
        script.onerror = () => resolve(false);
        document.head.appendChild(script);

        setTimeout(() => {
            resolve(typeof L !== 'undefined');
        }, 15000);
    });
}

async function initializeOrderTrackingMap() {
    const mapContainer = document.getElementById('orderTrackingMap');
    if (!mapContainer) {
        return null;
    }

    if (typeof L === 'undefined') {
        const loaded = await ensureLeafletLoaded();
        if (!loaded || typeof L === 'undefined') {
            return null;
        }
    }

    const map = L.map('orderTrackingMap', {
        scrollWheelZoom: false,
        zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);

    map.setView([1.2921, 36.8219], 12);
    if (typeof map.invalidateSize === 'function') {
        setTimeout(() => map.invalidateSize(true), 200);
    }
    setLeafletDebugOverlay('Leaflet map initialized successfully.');
    return map;
}

function updateOrderTrackingMap(map, marker, latitude, longitude) {
    if (!map || latitude == null || longitude == null || typeof L === 'undefined') {
        return marker;
    }

    if (typeof map.invalidateSize === 'function') {
        map.invalidateSize(true);
    }

    const position = [latitude, longitude];

    if (!marker) {
        marker = L.marker(position).addTo(map);
    } else {
        marker.setLatLng(position);
    }

    map.setView(position, 14, {
        animate: true,
        duration: 0.5
    });

    return marker;
}

function setOrderTrackingStatus(message) {
    const status = document.getElementById('orderTrackingStatus');
    if (status) {
        status.textContent = message;
    }
}

async function setupTrackPageSocket(orderId, mapState) {
    if (!window.socketClient || typeof window.socketClient.connect !== 'function') {
        return;
    }

    window.socketClient.connect();
    window.socketClient.on('driverLocationUpdated', (payload) => {
        if (!payload || Number(payload.orderId) !== Number(orderId)) {
            return;
        }

        setOrderTrackingStatus(`Driver live location updated at ${new Date(payload.locationTime).toLocaleTimeString()}`);
        mapState.marker = updateOrderTrackingMap(mapState.map, mapState.marker, payload.latitude, payload.longitude);
    });
}

async function loadTrackOrderPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = Number(params.get('orderId'));

    if (!orderId) {
        renderTrackPageUnavailable('Order ID is missing from the URL.');
        return;
    }

    try {
        const response = await api.getMyOrders();
        const orders = response.data;
        customerOrdersCache = orders.reduce((acc, order) => {
            acc[order.id] = order;
            return acc;
        }, {});

        let order = customerOrdersCache[orderId];
        if (!order) {
            const directOrderResponse = await api.getOrder(orderId);
            order = directOrderResponse.data;
            if (!order) {
                renderTrackPageUnavailable('We could not find this order in your account.');
                return;
            }
            customerOrdersCache[order.id] = order;
        }

        document.getElementById('trackingOrderReference').textContent = `#${order.id}`;
        document.getElementById('trackingOrderStatus').textContent = order.status;
        document.getElementById('trackingOrderTotal').textContent = order.total != null ? formatKsh(order.total) : 'N/A';
        document.getElementById('trackingOrderAddress').textContent = order.delivery_address || 'Not available';
        document.getElementById('trackingOrderDate').textContent = formatDateTime(order.created_at);
        document.getElementById('trackingOrderPayment').textContent = order.payment_in_progress
            ? `Payment pending — completes by ${formatDateTime(order.payment_expires_at)}`
            : (order.paid_at
                ? `Paid at ${formatDateTime(order.paid_at)}`
                : (order.status === 'paid' ? 'Paid' : 'Not paid yet'));
        document.getElementById('trackingDriverId').textContent = order.delivery_name || (order.delivery_id ? `Driver #${order.delivery_id}` : 'Not assigned');
        document.getElementById('trackingOrderItems').innerHTML = (order.items || []).map((item) => `
            <li>${item.product_name} x${item.quantity} — ${formatKsh((item.price || 0) * item.quantity)}</li>
        `).join('');

        const mapState = {
            map: await initializeOrderTrackingMap(),
            marker: null
        };

        setOrderTrackingStatus('Loading latest driver location...');

        const locationResponse = await api.getOrderLocation(orderId);
        const locationPayload = locationResponse.data || {};
        const location = locationPayload.location;

        if (!order.delivery_name && locationPayload.deliveryName) {
            document.getElementById('trackingDriverId').textContent = locationPayload.deliveryName;
        }

        if (location && location.latitude !== null && location.longitude !== null) {
            mapState.marker = updateOrderTrackingMap(mapState.map, mapState.marker, location.latitude, location.longitude);
            setOrderTrackingStatus(`Driver last seen at ${new Date(location.locationTime).toLocaleTimeString()}`);
        } else if (order.delivery_id) {
            setOrderTrackingStatus('Driver assigned, live location will appear once the driver starts moving.');
        } else {
            setOrderTrackingStatus('No driver has been assigned yet. Please wait for assignment.');
        }

        await setupTrackPageSocket(orderId, mapState);
    } catch (error) {
        console.error('Failed to load tracking page:', error);
        renderTrackPageUnavailable('Unable to load live tracking for this order at the moment.');
    }
}

function updateCancellationPageState() {
    const orderId = Number(document.getElementById('cancelOrderId')?.value || 0);
    if (!orderId) return;

    const order = customerOrdersCache[orderId];
    const state = getCancellationState(order);
    const countdown = document.getElementById('cancelWindowCountdown');
    const status = document.getElementById('cancelEligibilityState');
    const submitButton = document.querySelector('#cancelOrderForm button[type="submit"]');
    const agreement = document.getElementById('cancelAgreement');
    const reasonInput = document.getElementById('cancelReason');

    if (!countdown || !status || !submitButton || !agreement || !reasonInput) {
        return;
    }

    if (!order) {
        renderCancellationPageUnavailable('We could not find that order.');
        return;
    }

    if (state.eligible) {
        countdown.textContent = state.label;
        status.textContent = 'This order can still be cancelled if you accept the terms below.';
        status.className = 'cancel-page-status cancel-page-status--active';
        submitButton.disabled = !agreement.checked;
        agreement.disabled = false;
        reasonInput.disabled = false;
        return;
    }

    countdown.textContent = '00:00';
    status.textContent = 'The cancellation window has closed for this order.';
    status.className = 'cancel-page-status cancel-page-status--expired';
    submitButton.disabled = true;
    agreement.disabled = true;
    reasonInput.disabled = true;
}

function startCancellationUiTicker() {
    if (cancellationUiInterval) {
        clearInterval(cancellationUiInterval);
    }

    if (!document.getElementById('customer-orders') && !document.getElementById('cancelTermsPage')) {
        return;
    }

    cancellationUiInterval = setInterval(() => {
        if (document.getElementById('customer-orders')) {
            updateOrderCancellationButtons();
        }

        if (document.getElementById('cancelTermsPage')) {
            updateCancellationPageState();
        }
    }, 1000);
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

function showPaymentModal(orderId, amount, phone = '') {
    const order = customerOrdersCache[orderId];
    const orderPhone = String(phone || order?.phone || '').trim();

    sessionStorage.setItem('resumePaymentOrder', JSON.stringify({
        orderId,
        amount,
        phone: orderPhone
    }));

    cart.showNotification(`Continuing payment for order #${orderId}.`);
    window.location.href = '/customer/cart';
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
    if (cart.getItemCount() === 0) {
        cart.showNotification('Your cart is already empty.');
        return;
    }

    const modal = document.getElementById('clearCartModal');
    if (modal) {
        modal.style.display = 'block';
        return;
    }

    if (confirm('Clear all items from cart?')) {
        cart.clearCart();
        cart.showNotification('Cart cleared.');
    }
}

function confirmClearCart() {
    cart.clearCart();
    closeModal('clearCartModal');
    cart.showNotification('Cart cleared.');
}

function openResumePaymentFromSession() {
    const resumePaymentRaw = sessionStorage.getItem('resumePaymentOrder');
    if (!resumePaymentRaw || !document.getElementById('paymentModal')) {
        return;
    }

    try {
        const resumePayment = JSON.parse(resumePaymentRaw);
        const orderId = Number(resumePayment.orderId);
        const amount = Number(resumePayment.amount);

        if (!orderId) {
            sessionStorage.removeItem('resumePaymentOrder');
            return;
        }

        const modal = document.getElementById('paymentModal');
        const orderIdInput = document.getElementById('orderId');
        const paymentAmount = document.getElementById('paymentAmount');
        const phoneInput = document.getElementById('phone');
        const statusDiv = document.getElementById('paymentStatus');

        if (!modal || !orderIdInput || !paymentAmount) {
            return;
        }

        orderIdInput.value = String(orderId);
        paymentAmount.textContent = formatKsh(amount);

        if (phoneInput) {
            phoneInput.value = String(resumePayment.phone || '');
        }

        if (statusDiv) {
            statusDiv.style.display = 'none';
            statusDiv.innerHTML = '';
        }

        modal.style.display = 'block';
        sessionStorage.removeItem('resumePaymentOrder');
    } catch (error) {
        console.error('Failed to restore payment flow:', error);
        sessionStorage.removeItem('resumePaymentOrder');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    openResumePaymentFromSession();
});

// Expose functions globally
window.checkout = checkout;
window.clearCart = clearCart;
window.confirmClearCart = confirmClearCart;
window.closeModal = closeModal;
window.requestOrderCancellation = openCancelModal;
window.viewCancellationReviewNote = openCancellationReviewModal;
window.showPaymentModal = showPaymentModal;
