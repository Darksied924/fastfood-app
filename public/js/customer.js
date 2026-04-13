let currentCustomer = null;
let customerOrdersCache = {};
let cancellationUiInterval = null;
let trackOrderPollingInterval = null;
let trackOrderSocketCleanup = [];
let trackOrderSocketStatusCleanup = null;
let activeTrackOrderState = null;
let orderTrackingMapInstance = null;
let orderTrackingMapBoundsInitialized = false;
const CANCELLATION_WINDOW_MS = 5 * 60 * 1000;
const TRACK_ORDER_POLL_INTERVAL_MS = 15000;
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

    return order.status === 'out_for_delivery' && Boolean(order.delivery_id);
}

function canViewOrderProgress(order) {
    if (!order) {
        return false;
    }

    if (order.status === 'cancelled' || order.status === 'delivered') {
        return false;
    }

    if (order.status === 'out_for_delivery') {
        return true;
    }

    if ((order.status === 'paid' || order.status === 'preparing') && !getCancellationState(order).eligible) {
        return true;
    }

    return false;
}

function getOrderTrackingActionLabel(order) {
    return isOrderTrackable(order) ? 'Track Order' : 'View Order Progress';
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
                    ` : ''}                    ${!getCancellationState(order).eligible && canViewOrderProgress(order) ? `
                        <button
                            class="btn btn-primary"
                            data-track-button
                            onclick="openTrackOrder(${order.id})">
                            ${getOrderTrackingActionLabel(order)}
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
    clearTrackOrderRuntime();

    const status = document.getElementById('orderTrackingStatus');
    const connection = document.getElementById('orderTrackingConnectionStatus');
    const details = document.getElementById('trackingOrderDetails');
    const map = document.getElementById('orderTrackingMap');

    if (status) {
        status.textContent = message;
        status.className = 'map-status';
    }

    if (details) {
        details.innerHTML = `<p>${message}</p>`;
    }

    if (connection) {
        connection.textContent = 'Live updates unavailable for this order.';
    }

    if (map) {
        map.innerHTML = '<p style="padding:1rem;">Live tracking is not available for this order.</p>';
    }
}

function initMap() {
    const mapContainer = document.getElementById('orderTrackingMap');
    if (!mapContainer) {
        console.error('Map container missing');
        return null;
    }

    if (orderTrackingMapInstance) {
        return orderTrackingMapInstance;
    }

    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded');
        mapContainer.innerHTML = '<p style="padding:1rem;">Map failed to load. Live text updates will continue.</p>';
        setOrderTrackingConnectionStatus('Map failed to load, but live order updates are still active.');
        return null;
    }

    orderTrackingMapInstance = L.map(mapContainer, {
        scrollWheelZoom: false,
        zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(orderTrackingMapInstance);

    orderTrackingMapInstance.setView([1.2921, 36.8219], 12);
    return orderTrackingMapInstance;
}

function createDeliveryMarkerIcon(isPrimary = false) {
    if (typeof L === 'undefined' || typeof L.divIcon !== 'function') {
        return undefined;
    }

    const size = isPrimary ? 18 : 14;
    const halo = isPrimary ? 34 : 28;
    const color = isPrimary ? '#d62828' : '#1d3557';

    return L.divIcon({
        className: 'live-delivery-marker',
        html: `
            <span style="
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: ${size}px;
                height: ${size}px;
                border-radius: 999px;
                background: ${color};
                border: 3px solid #fff;
                box-shadow: 0 10px 22px rgba(0, 0, 0, 0.18);
            ">
                <span style="
                    position: absolute;
                    width: ${halo}px;
                    height: ${halo}px;
                    border-radius: 999px;
                    background: rgba(214, 40, 40, 0.14);
                "></span>
            </span>
        `,
        iconSize: [halo, halo],
        iconAnchor: [halo / 2, halo / 2],
        popupAnchor: [0, -(halo / 2)]
    });
}

function buildTrackingPopupContent(trackingEntry) {
    const deliveryName = trackingEntry.deliveryName || `Driver #${trackingEntry.deliveryId ?? '--'}`;
    const deliveryId = trackingEntry.deliveryId ?? '--';
    const orderId = trackingEntry.orderId ?? '--';
    const statusLabel = trackingEntry.statusLabel || 'Tracking live';
    const etaLabel = trackingEntry.etaLabel || 'ETA unavailable';
    const destination = trackingEntry.assignedDestination || 'Not available';
    const lastSeen = trackingEntry.locationTime ? formatTrackingTime(trackingEntry.locationTime) : 'Waiting for GPS';

    return `
        <div class="delivery-popup-card" style="min-width: 220px;">
            <strong>${deliveryName}</strong>
            <p style="margin: 0.5rem 0 0;">Delivery ID: ${deliveryId}</p>
            <p style="margin: 0.2rem 0 0;">Order ID: ${orderId}</p>
            <p style="margin: 0.2rem 0 0;">Status: ${statusLabel}</p>
            <p style="margin: 0.2rem 0 0;">ETA: ${etaLabel}</p>
            <p style="margin: 0.2rem 0 0;">Destination: ${destination}</p>
            <p style="margin: 0.2rem 0 0;">Last seen: ${lastSeen}</p>
        </div>
    `;
}

function animateMarkerTo(marker, latitude, longitude) {
    if (!marker || latitude == null || longitude == null || typeof L === 'undefined') {
        return;
    }

    const target = L.latLng(latitude, longitude);
    const current = typeof marker.getLatLng === 'function' ? marker.getLatLng() : target;

    if (!current) {
        marker.setLatLng(target);
        return;
    }

    const distance = typeof current.distanceTo === 'function' ? current.distanceTo(target) : 0;
    if (!Number.isFinite(distance) || distance < 0.5) {
        marker.setLatLng(target);
        return;
    }

    if (marker.__trackingAnimationFrame) {
        cancelAnimationFrame(marker.__trackingAnimationFrame);
    }

    const duration = Math.max(250, Math.min(1200, distance * 12));
    const startedAt = performance.now();
    const origin = L.latLng(current.lat, current.lng);

    const tick = (now) => {
        const elapsed = now - startedAt;
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const nextLat = origin.lat + ((target.lat - origin.lat) * eased);
        const nextLng = origin.lng + ((target.lng - origin.lng) * eased);

        marker.setLatLng([nextLat, nextLng]);

        if (progress < 1) {
            marker.__trackingAnimationFrame = requestAnimationFrame(tick);
            return;
        }

        marker.__trackingAnimationFrame = null;
    };

    marker.__trackingAnimationFrame = requestAnimationFrame(tick);
}

function getTrackingEntries(trackState, locationPayload = {}) {
    if (Array.isArray(locationPayload.trackedPersonnel) && locationPayload.trackedPersonnel.length) {
        return locationPayload.trackedPersonnel;
    }

    const location = locationPayload.location;
    if (!location || location.latitude == null || location.longitude == null) {
        return [];
    }

    return [{
        deliveryId: locationPayload.deliveryId || trackState.order?.delivery_id || null,
        deliveryName: locationPayload.deliveryName || trackState.order?.delivery_name || null,
        orderId: locationPayload.orderId || trackState.orderId,
        status: locationPayload.trackingStatus || 'en_route',
        statusLabel: locationPayload.statusLabel || 'En route',
        etaLabel: locationPayload.etaLabel || 'ETA updating live',
        assignedDestination: locationPayload.assignedDestination || trackState.order?.delivery_address || 'Not available',
        latitude: location.latitude,
        longitude: location.longitude,
        locationTime: location.locationTime || null
    }];
}

function shouldRecenterTrackingMap(map, latitude, longitude) {
    if (!map || latitude == null || longitude == null || typeof map.getBounds !== 'function' || typeof L === 'undefined') {
        return false;
    }

    const bounds = map.getBounds();
    if (!bounds || typeof bounds.pad !== 'function' || typeof bounds.contains !== 'function') {
        return false;
    }

    return !bounds.pad(-0.3).contains(L.latLng(latitude, longitude));
}

function shouldRefitTrackingBounds(map, positions = []) {
    if (!map || typeof map.getBounds !== 'function' || typeof L === 'undefined' || positions.length < 2) {
        return false;
    }

    const bounds = map.getBounds();
    if (!bounds || typeof bounds.pad !== 'function' || typeof bounds.contains !== 'function') {
        return false;
    }

    const paddedBounds = bounds.pad(-0.2);
    return positions.some(([latitude, longitude]) => !paddedBounds.contains(L.latLng(latitude, longitude)));
}

function syncTrackedPersonnelMarkers(trackState, trackingEntries = []) {
    if (!trackState?.mapState?.map || typeof L === 'undefined') {
        return null;
    }

    if (!trackState.mapState.markers) {
        trackState.mapState.markers = new Map();
    }

    const markers = trackState.mapState.markers;
    const nextIds = new Set();
    const validEntries = trackingEntries.filter((entry) => entry && entry.latitude != null && entry.longitude != null);

    validEntries.forEach((entry, index) => {
        const markerKey = String(entry.deliveryId || entry.orderId || index);
        nextIds.add(markerKey);

        const existingRecord = markers.get(markerKey);
        const icon = createDeliveryMarkerIcon(index === 0);

        if (!existingRecord) {
            const marker = L.marker([entry.latitude, entry.longitude], icon ? { icon } : undefined).addTo(trackState.mapState.map);
            marker.bindPopup(buildTrackingPopupContent(entry));
            markers.set(markerKey, { marker, entry });
            return;
        }

        if (icon && typeof existingRecord.marker.setIcon === 'function') {
            existingRecord.marker.setIcon(icon);
        }

        animateMarkerTo(existingRecord.marker, entry.latitude, entry.longitude);
        existingRecord.marker.bindPopup(buildTrackingPopupContent(entry));
        existingRecord.entry = entry;
    });

    Array.from(markers.entries()).forEach(([markerKey, record]) => {
        if (nextIds.has(markerKey)) {
            return;
        }

        if (record.marker?.__trackingAnimationFrame) {
            cancelAnimationFrame(record.marker.__trackingAnimationFrame);
        }

        trackState.mapState.map.removeLayer(record.marker);
        markers.delete(markerKey);
    });

    if (!validEntries.length) {
        return null;
    }

    const primaryKey = String(validEntries[0].deliveryId || validEntries[0].orderId || 0);
    const primaryRecord = markers.get(primaryKey) || null;
    const positions = validEntries.map((entry) => [entry.latitude, entry.longitude]);

    if (positions.length === 1) {
        if (!orderTrackingMapBoundsInitialized) {
            trackState.mapState.map.setView(positions[0], 14, {
                animate: true,
                duration: 0.6
            });
            orderTrackingMapBoundsInitialized = true;
        } else if (shouldRecenterTrackingMap(trackState.mapState.map, positions[0][0], positions[0][1])) {
            trackState.mapState.map.panTo(positions[0], {
                animate: true,
                duration: 0.6
            });
        }
    } else {
        const bounds = L.latLngBounds(positions);
        if (!orderTrackingMapBoundsInitialized || shouldRefitTrackingBounds(trackState.mapState.map, positions)) {
            trackState.mapState.map.fitBounds(bounds, {
                padding: [40, 40]
            });
            orderTrackingMapBoundsInitialized = true;
        }
    }

    trackState.mapState.marker = primaryRecord?.marker || null;
    return primaryRecord?.marker || null;
}

function setOrderTrackingStatus(message) {
    const status = document.getElementById('orderTrackingStatus');
    if (status) {
        status.textContent = message;
    }
}

function setOrderTrackingConnectionStatus(message) {
    const status = document.getElementById('orderTrackingConnectionStatus');
    if (status) {
        status.textContent = message;
    }
}

function formatTrackingTime(value) {
    if (!value) {
        return 'recently';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'recently';
    }

    return date.toLocaleTimeString();
}

function clearTrackOrderRuntime() {
    if (trackOrderPollingInterval) {
        clearInterval(trackOrderPollingInterval);
        trackOrderPollingInterval = null;
    }

    if (trackOrderSocketStatusCleanup) {
        trackOrderSocketStatusCleanup();
        trackOrderSocketStatusCleanup = null;
    }

    if (window.socketClient && typeof window.socketClient.off === 'function') {
        trackOrderSocketCleanup.forEach(({ event, handler }) => {
            window.socketClient.off(event, handler);
        });
    }

    if (activeTrackOrderState?.mapState?.markers && activeTrackOrderState.mapState.map) {
        activeTrackOrderState.mapState.markers.forEach(({ marker }) => {
            if (marker?.__trackingAnimationFrame) {
                cancelAnimationFrame(marker.__trackingAnimationFrame);
            }
            activeTrackOrderState.mapState.map.removeLayer(marker);
        });
        activeTrackOrderState.mapState.markers.clear();
    }

    trackOrderSocketCleanup = [];
    activeTrackOrderState = null;
    orderTrackingMapBoundsInitialized = false;
}

function updateTrackPageOrderSummary(order) {
    if (!order) {
        return;
    }

    document.getElementById('trackingOrderReference').textContent = `#${order.id}`;
    document.getElementById('trackingOrderStatus').textContent = order.status;
    document.getElementById('trackingOrderTotal').textContent = order.total != null ? formatKsh(order.total) : 'N/A';
    document.getElementById('trackingOrderAddress').textContent = order.delivery_address || 'Not available';
    document.getElementById('trackingOrderDate').textContent = formatDateTime(order.created_at);
    document.getElementById('trackingOrderPayment').textContent = order.payment_in_progress
        ? `Payment pending - completes by ${formatDateTime(order.payment_expires_at)}`
        : (order.paid_at
            ? `Paid at ${formatDateTime(order.paid_at)}`
            : (order.status === 'paid' ? 'Paid' : 'Not paid yet'));
    document.getElementById('trackingDriverId').textContent = order.delivery_name || (order.delivery_id ? `Driver #${order.delivery_id}` : 'Not assigned');
    document.getElementById('trackingOrderItems').innerHTML = (order.items || []).map((item) => `
        <li>${item.product_name} x${item.quantity} - ${formatKsh((item.price || 0) * item.quantity)}</li>
    `).join('');
}

function applyTrackPageLocationPayload(trackState, locationPayload = {}, source = 'api') {
    if (!trackState || !trackState.mapState) {
        return;
    }

    const order = trackState.order;
    const location = locationPayload.location || null;
    const trackingEntries = getTrackingEntries(trackState, locationPayload);

    if (locationPayload.deliveryName && trackState.order) {
        trackState.order.delivery_name = locationPayload.deliveryName;
        customerOrdersCache[trackState.order.id] = trackState.order;
        document.getElementById('trackingDriverId').textContent = locationPayload.deliveryName;
    }

    if (trackingEntries.length) {
        syncTrackedPersonnelMarkers(trackState, trackingEntries);
        setOrderTrackingStatus(
            `${source === 'socket' ? 'Driver live location updated' : 'Driver last seen'} at ${formatTrackingTime(trackingEntries[0].locationTime)}`
        );
        return;
    }

    if (isOrderTrackable(order)) {
        setOrderTrackingStatus('Driver assigned, live location will appear once the driver starts moving.');
        return;
    }

    if (canViewOrderProgress(order)) {
        setOrderTrackingStatus('Live tracking will start automatically once the driver is on the way.');
        return;
    }

    setOrderTrackingStatus('Tracking is not available for this order.');
}

function finalizeTrackPageForClosedOrder(trackState) {
    if (!trackState || !trackState.order) {
        return;
    }

        if (trackState.order.status === 'delivered') {
            setOrderTrackingStatus('Order delivered. Live tracking has ended.');
            setOrderTrackingConnectionStatus('Live updates ended for this order.');
    } else if (trackState.order.status === 'cancelled') {
        setOrderTrackingStatus('Order cancelled. Live tracking has ended.');
        setOrderTrackingConnectionStatus('Live updates ended for this order.');
    }
}

async function refreshTrackOrderData(trackState, options = {}) {
    if (!trackState || trackState.refreshInFlight) {
        return;
    }

    const {
        refreshOrder = true,
        refreshLocation = true,
        source = 'poll'
    } = options;

    trackState.refreshInFlight = true;

    try {
        if (refreshOrder) {
            const orderResponse = await api.getOrder(trackState.orderId);
            if (orderResponse && orderResponse.data) {
                trackState.order = orderResponse.data;
                customerOrdersCache[trackState.order.id] = trackState.order;
                updateTrackPageOrderSummary(trackState.order);
            }
        }

        if (!canViewOrderProgress(trackState.order)) {
            finalizeTrackPageForClosedOrder(trackState);
            clearTrackOrderRuntime();
            return;
        }

        if (!refreshLocation) {
            return;
        }

        const locationResponse = await api.getOrderLocation(trackState.orderId);
        applyTrackPageLocationPayload(trackState, locationResponse.data || {}, source);
    } finally {
        trackState.refreshInFlight = false;
    }
}

function startTrackOrderPolling(trackState) {
    if (trackOrderPollingInterval) {
        clearInterval(trackOrderPollingInterval);
    }

    trackOrderPollingInterval = setInterval(async () => {
        try {
            await refreshTrackOrderData(trackState, {
                refreshOrder: true,
                refreshLocation: true,
                source: 'poll'
            });
        } catch (error) {
            console.warn('Track order polling failed:', error.message || error);
            setOrderTrackingConnectionStatus(`Live updates retrying. Refreshing every ${TRACK_ORDER_POLL_INTERVAL_MS / 1000} seconds.`);
        }
    }, TRACK_ORDER_POLL_INTERVAL_MS);
}

async function setupTrackPageSocket(trackState) {
    if (!window.socketClient || typeof window.socketClient.connect !== 'function') {
        setOrderTrackingConnectionStatus(`Live updates unavailable. Refreshing every ${TRACK_ORDER_POLL_INTERVAL_MS / 1000} seconds.`);
        return;
    }

    if (trackOrderSocketStatusCleanup) {
        trackOrderSocketStatusCleanup();
        trackOrderSocketStatusCleanup = null;
    }

    if (window.socketClient && typeof window.socketClient.off === 'function') {
        trackOrderSocketCleanup.forEach(({ event, handler }) => {
            window.socketClient.off(event, handler);
        });
    }
    trackOrderSocketCleanup = [];

    if (typeof window.socketClient.onStatusChange === 'function') {
        trackOrderSocketStatusCleanup = window.socketClient.onStatusChange((status) => {
            if (!status || !status.message) {
                return;
            }

            if (status.state === 'connected') {
                setOrderTrackingConnectionStatus(status.message);
                return;
            }

            if (status.state === 'idle' || status.state === 'connecting') {
                setOrderTrackingConnectionStatus('Connecting to live updates...');
                return;
            }

            if (status.state === 'unauthorized') {
                setOrderTrackingConnectionStatus(status.message);
                return;
            }

            setOrderTrackingConnectionStatus(`${status.message} Polling every ${TRACK_ORDER_POLL_INTERVAL_MS / 1000} seconds.`);
        });
    }

    window.socketClient.connect();

    const driverLocationHandler = (payload) => {
        if (!payload || Number(payload.orderId) !== Number(trackState.orderId)) {
            return;
        }

        applyTrackPageLocationPayload(trackState, {
            deliveryName: payload.deliveryName || trackState.order?.delivery_name || null,
            deliveryId: payload.deliveryId || trackState.order?.delivery_id || null,
            orderId: payload.orderId || trackState.orderId,
            trackingStatus: payload.trackingStatus || null,
            statusLabel: payload.statusLabel || null,
            etaLabel: payload.etaLabel || null,
            assignedDestination: payload.assignedDestination || trackState.order?.delivery_address || null,
            trackedPersonnel: payload.trackedPersonnel || null,
            location: payload.latitude != null && payload.longitude != null ? {
                latitude: payload.latitude,
                longitude: payload.longitude,
                locationTime: payload.locationTime
            } : null
        }, 'socket');
    };

    const orderStatusHandler = async (payload) => {
        if (!payload || Number(payload.orderId) !== Number(trackState.orderId)) {
            return;
        }

        trackState.order = {
            ...(trackState.order || {}),
            status: payload.status,
            delivery_id: payload.deliveryId || trackState.order?.delivery_id || null
        };
        customerOrdersCache[trackState.order.id] = trackState.order;
        updateTrackPageOrderSummary(trackState.order);

        try {
            await refreshTrackOrderData(trackState, {
                refreshOrder: true,
                refreshLocation: true,
                source: 'status'
            });
        } catch (error) {
            console.warn('Track order status refresh failed:', error.message || error);
        }
    };

    window.socketClient.on('driverLocationUpdated', driverLocationHandler);
    trackOrderSocketCleanup.push({ event: 'driverLocationUpdated', handler: driverLocationHandler });
    window.socketClient.on('orderStatusUpdated', orderStatusHandler);
    trackOrderSocketCleanup.push({ event: 'orderStatusUpdated', handler: orderStatusHandler });
}

window.addEventListener('beforeunload', () => {
    clearTrackOrderRuntime();
    if (orderTrackingMapInstance && typeof orderTrackingMapInstance.remove === 'function') {
        orderTrackingMapInstance.remove();
        orderTrackingMapInstance = null;
    }
});

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

        if (!canViewOrderProgress(order)) {
            renderTrackPageUnavailable('Tracking is not available for this order yet.');
            return;
        }

        updateTrackPageOrderSummary(order);

        clearTrackOrderRuntime();
        activeTrackOrderState = {
            orderId,
            order,
            mapState: {
                map: null,
                marker: null,
                markers: new Map()
            },
            refreshInFlight: false
        };

        await new Promise((resolve) => {
            setTimeout(() => {
                activeTrackOrderState.mapState.map = initMap();
                if (activeTrackOrderState.mapState.map && typeof activeTrackOrderState.mapState.map.invalidateSize === 'function') {
                    activeTrackOrderState.mapState.map.invalidateSize();
                }
                resolve();
            }, 100);
        });

        if (!activeTrackOrderState.mapState.map) {
            setOrderTrackingStatus('Live location is available, but the map could not be displayed on this device.');
        }

        setOrderTrackingStatus(
            isOrderTrackable(order)
                ? 'Loading latest driver location...'
                : 'Preparing live order progress...'
        );
        setOrderTrackingConnectionStatus('Connecting to live updates...');

        await refreshTrackOrderData(activeTrackOrderState, {
            refreshOrder: false,
            refreshLocation: true,
            source: 'api'
        });
        await setupTrackPageSocket(activeTrackOrderState);
        startTrackOrderPolling(activeTrackOrderState);
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
