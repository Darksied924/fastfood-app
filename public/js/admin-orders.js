document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;
    if (!auth.requireRole('admin')) return;

    const filter = document.getElementById('orderStatusFilter');
    filter.addEventListener('change', async () => {
        await loadOrders(filter.value);
    });

    await refreshAdminOrdersPage();
});

const ORDER_STATUS_ORDER = ['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
let cancellationRequestsCache = {};
let cancellationRequestsList = [];
let allOrdersCache = [];
const ORDER_STATUS_LABELS = {
    pending: 'Pending',
    paid: 'Paid',
    preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

const formatDate = (value) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    return new Date(value).toLocaleString();
};

async function loadOrders(status = '') {
    try {
        const response = await api.getAllOrders(status);
        const orders = response.data;
        allOrdersCache = Array.isArray(orders) ? orders : [];
        const container = document.getElementById('all-orders-list');
        renderOrdersByStatus(allOrdersCache, container);
        renderOrdersOverview(allOrdersCache, cancellationRequestsList);
    } catch (error) {
        showToast(`Failed to load orders: ${error.message}`, 'error');
    }
}

async function loadCancellationRequests() {
    try {
        const response = await api.getCancellationRequests();
        const requests = response.data;
        cancellationRequestsList = Array.isArray(requests) ? requests : [];
        cancellationRequestsCache = cancellationRequestsList.reduce((acc, request) => {
            if (request.refund_id) {
                acc[request.refund_id] = request;
            }
            return acc;
        }, {});
        const container = document.getElementById('cancellation-requests-list');
        renderPendingApprovalsSpotlight(cancellationRequestsList);
        renderCancellationRequests(cancellationRequestsList, container);
        renderOrdersOverview(allOrdersCache, cancellationRequestsList);
    } catch (error) {
        showToast(`Failed to load cancellation requests: ${error.message}`, 'error');
    }
}

async function refreshAdminOrdersPage() {
    const status = document.getElementById('orderStatusFilter')?.value || '';
    await Promise.all([
        loadOrders(status),
        loadCancellationRequests()
    ]);
}

function renderOrdersByStatus(orders, container) {
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty-orders">No orders found.</div>';
        return;
    }

    const groupedOrders = groupOrdersByStatus(orders);
    const unknownStatuses = Object.keys(groupedOrders).filter((status) => !ORDER_STATUS_ORDER.includes(status));
    const orderedStatuses = [...ORDER_STATUS_ORDER, ...unknownStatuses];

    container.innerHTML = orderedStatuses
        .filter((status) => groupedOrders[status] && groupedOrders[status].length > 0)
        .map((status) => renderStatusSection(status, groupedOrders[status]))
        .join('');
}

function groupOrdersByStatus(orders) {
    return orders.reduce((groups, order) => {
        const status = order.status || 'unknown';
        if (!groups[status]) {
            groups[status] = [];
        }
        groups[status].push(order);
        return groups;
    }, {});
}

function renderStatusSection(status, orders) {
    const statusLabel = ORDER_STATUS_LABELS[status] || status;
    const totalValue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

    return `
        <section class="order-status-section order-status-section--${status}">
            <div class="role-user-section-header">
                <div class="role-user-section-copy">
                    <span class="role-section-kicker">Status group</span>
                    <h4>${statusLabel}</h4>
                    <p>${orders.length} order${orders.length === 1 ? '' : 's'} in this stage, worth ${formatKsh(totalValue)} in total.</p>
                </div>
                <span class="role-count">${orders.length}</span>
            </div>
            ${renderOrdersTable(orders)}
        </section>
    `;
}

function renderOrdersTable(orders) {
    return `
        <div class="review-table-wrap">
        <table class="orders-table">
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Read</th>
                    <th>Delivery</th>
                    <th>Date</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map((order) => `
                    <tr class="orders-table-row ${order.status === 'cancelled' ? 'orders-table-row--urgent' : ''}">
                        <td data-label="Order ID">#${order.id}</td>
                        <td data-label="Customer">${order.customer_name || '-'}</td>
                        <td data-label="Address">${order.delivery_address || 'N/A'}</td>
                        <td data-label="Total">${formatKsh(order.total)}</td>
                        <td data-label="Status"><span class="status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status}</span></td>
                        <td data-label="Read">${getReadBadge(order.manager_read_at)}</td>
                        <td data-label="Delivery">${order.delivery_name || 'Unassigned'}</td>
                        <td data-label="Date">${formatDate(order.created_at)}</td>
                        <td data-label="Actions">${renderOrderActions(order)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        </div>
    `;
}

function renderOrderActions(order) {
    if (order.status === 'cancelled' || order.status === 'replaced') {
        return '<span class="status-note">No action</span>';
    }

    return `
        <div class="actions-cell">
            <select onchange="updateOrderStatus(${order.id}, this.value)">
                <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option>
                <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                <option value="out_for_delivery" ${order.status === 'out_for_delivery' ? 'selected' : ''}>Out for Delivery</option>
                <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
            </select>
            ${!order.delivery_id && order.status === 'paid'
                ? `<button class="btn btn-primary btn-small" onclick="assignDeliveryPrompt(${order.id})">Assign</button>`
                : ''}
            ${order.status !== 'delivered'
                ? `<button class="btn btn-danger btn-small" onclick="overrideCancelOrder(${order.id})">Override Cancel</button>`
                : ''}
        </div>
    `;
}

function renderCancellationRequests(requests, container) {
    if (!requests.length) {
        container.innerHTML = '<div class="empty-orders">No cancellation requests found.</div>';
        return;
    }

    const pendingRequests = requests.filter((request) => request.refund_status === 'REQUESTED');
    const reviewedRequests = requests.filter((request) => request.refund_status !== 'REQUESTED');

    container.innerHTML = `
        <div class="review-queue-meta">
            <div class="review-queue-metric review-queue-metric--urgent">
                <span class="review-queue-metric-label">Pending approvals</span>
                <strong class="review-queue-metric-value">${pendingRequests.length}</strong>
            </div>
            <div class="review-queue-metric">
                <span class="review-queue-metric-label">Reviewed requests</span>
                <strong class="review-queue-metric-value">${reviewedRequests.length}</strong>
            </div>
        </div>
        <div class="review-table-wrap">
            <table class="review-table">
                <thead>
                    <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Reason</th>
                        <th>Cancelled At</th>
                        <th>Override</th>
                        <th>Refund</th>
                        <th>Review</th>
                    </tr>
                </thead>
                <tbody>
                    ${requests.map((request) => `
                        <tr class="review-table-row ${request.refund_status === 'REQUESTED' ? 'review-table-row--pending' : ''}">
                            <td data-label="Order">#${request.order_id}</td>
                            <td data-label="Customer">${request.customer_name || 'Customer deleted'}</td>
                            <td data-label="Reason">${request.reason || 'No reason provided'}</td>
                            <td data-label="Cancelled At">${formatDateTime(request.cancelled_at)}</td>
                            <td data-label="Override">${request.is_admin_override ? 'Yes' : 'No'}</td>
                            <td data-label="Refund">${renderRefundStatusBadge(request)}</td>
                            <td data-label="Review">${renderRefundActions(request)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderOrdersOverview(orders, requests) {
    const container = document.getElementById('orders-overview');

    if (!container) {
        return;
    }

    const totalOrders = orders.length;
    const pendingOrders = orders.filter((order) => order.status === 'pending').length;
    const inProgressOrders = orders.filter((order) => ['paid', 'preparing', 'out_for_delivery'].includes(order.status)).length;
    const pendingApprovals = requests.filter((request) => request.refund_status === 'REQUESTED').length;
    const cancelledOrders = orders.filter((order) => order.status === 'cancelled').length;

    container.innerHTML = `
        <article class="orders-overview-card orders-overview-card--primary">
            <span class="orders-overview-label">Total orders</span>
            <strong class="orders-overview-value">${totalOrders}</strong>
            <span class="orders-overview-detail">Current directory size</span>
        </article>
        <article class="orders-overview-card orders-overview-card--warning">
            <span class="orders-overview-label">Pending orders</span>
            <strong class="orders-overview-value">${pendingOrders}</strong>
            <span class="orders-overview-detail">Awaiting payment or action</span>
        </article>
        <article class="orders-overview-card orders-overview-card--urgent">
            <span class="orders-overview-label">Pending refund reviews</span>
            <strong class="orders-overview-value">${pendingApprovals}</strong>
            <span class="orders-overview-detail">Needs admin decision</span>
        </article>
        <article class="orders-overview-card orders-overview-card--neutral">
            <span class="orders-overview-label">Active fulfilment</span>
            <strong class="orders-overview-value">${inProgressOrders}</strong>
            <span class="orders-overview-detail">${cancelledOrders} cancelled orders logged</span>
        </article>
    `;
}

function renderPendingApprovalsSpotlight(requests) {
    const container = document.getElementById('pending-approvals-spotlight');

    if (!container) {
        return;
    }

    const pendingRequests = requests
        .filter((request) => request.refund_status === 'REQUESTED')
        .sort((a, b) => new Date(a.cancelled_at) - new Date(b.cancelled_at));

    if (!pendingRequests.length) {
        container.innerHTML = `
            <div class="priority-review-empty">
                <span class="priority-review-empty-pill">Queue clear</span>
                <p>No pending cancellation approvals right now. Reviewed items remain available below for reference.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="priority-review-header">
            <div>
                <span class="priority-review-kicker">Immediate attention</span>
                <h4>Pending approvals</h4>
                <p>These cancellation requests are still waiting on an admin decision.</p>
            </div>
            <span class="priority-review-count">${pendingRequests.length}</span>
        </div>
        <div class="priority-review-list">
            ${pendingRequests.map((request) => `
                <article class="priority-review-item">
                    <div class="priority-review-item-main">
                        <div class="priority-review-item-head">
                            <strong>Order #${request.order_id}</strong>
                            <span class="refund-status-badge refund-status-badge--requested">Pending review</span>
                        </div>
                        <p class="priority-review-meta">${request.customer_name || 'Customer deleted'} • ${formatKsh(request.total)} • ${formatDateTime(request.cancelled_at)}</p>
                        <p class="priority-review-reason">${request.reason || 'No cancellation reason provided.'}</p>
                    </div>
                    <div class="priority-review-actions">
                        <button class="btn btn-primary btn-small" onclick="openRefundReviewModal(${request.refund_id}, 'APPROVED')">Approve</button>
                        <button class="btn btn-danger btn-small" onclick="openRefundReviewModal(${request.refund_id}, 'DENIED')">Deny</button>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderRefundStatusBadge(request) {
    const status = request.refund_status || 'NOT_REQUIRED';
    const labelMap = {
        REQUESTED: 'Pending review',
        APPROVED: 'Approved',
        DENIED: 'Denied',
        NOT_REQUIRED: 'Not required'
    };

    const cssStatus = String(status).toLowerCase();
    return `<span class="refund-status-badge refund-status-badge--${cssStatus}">${labelMap[status] || status}</span>`;
}

function renderRefundActions(request) {
    if (!request.refund_id) {
        return '<span class="status-note">No refund review needed</span>';
    }

    if (request.refund_status !== 'REQUESTED') {
        return `<span class="status-note">${request.refund_status}${request.admin_notes ? `: ${request.admin_notes}` : ''}</span>`;
    }

    return `
        <div class="actions-cell">
            <button class="btn btn-primary btn-small" onclick="openRefundReviewModal(${request.refund_id}, 'APPROVED')">Approve</button>
            <button class="btn btn-danger btn-small" onclick="openRefundReviewModal(${request.refund_id}, 'DENIED')">Deny</button>
        </div>
    `;
}

function getReadBadge(managerReadAt) {
    if (managerReadAt) {
        return '<span class="status-badge read-state-badge read-state-read">Read</span>';
    }
    return '<span class="status-badge read-state-badge read-state-unread">Unread</span>';
}

function scrollToOrdersDirectory() {
    const target = document.getElementById('ordersDirectoryCard');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        const response = await api.updateOrderStatus(orderId, status);
        if (response.success) {
            showToast(response.message || 'Order status updated successfully.', 'success');
            await refreshAdminOrdersPage();
        }
    } catch (error) {
        showToast(`Failed to update order status: ${error.message}`, 'error');
    }
}

async function assignDeliveryPrompt(orderId) {
    const deliveryId = prompt('Enter delivery user ID:');
    if (!deliveryId) return;

    try {
        const response = await api.assignDelivery(orderId, deliveryId);
        if (response.success) {
            showToast('Delivery assigned successfully.', 'success');
            await refreshAdminOrdersPage();
        }
    } catch (error) {
        showToast(`Failed to assign delivery: ${error.message}`, 'error');
    }
}

async function overrideCancelOrder(orderId) {
    const reason = prompt('Reason for admin override cancellation (optional):', '');
    if (reason === null) return;

    try {
        const response = await api.adminOverrideCancel(orderId, reason);
        showToast(response.message || 'Order cancelled by admin override.', 'success');
        await refreshAdminOrdersPage();
    } catch (error) {
        showToast(`Failed to cancel order: ${error.message}`, 'error');
    }
}

async function reviewRefund(refundId, decision) {
    const notes = String(document.getElementById('refundReviewNotes')?.value || '').trim();

    try {
        const response = await api.reviewRefundRequest(refundId, decision, notes);
        closeModal('refundReviewModal');
        showToast(
            response.message || (decision === 'APPROVED'
                ? 'Order cancellation approved successfully.'
                : 'Order cancellation denied successfully.'),
            'success'
        );
        await refreshAdminOrdersPage();
    } catch (error) {
        showToast(`Failed to review refund request: ${error.message}`, 'error');
    }
}

function openRefundReviewModal(refundId, decision) {
    const request = cancellationRequestsCache[refundId];
    const modal = document.getElementById('refundReviewModal');

    if (!request || !modal) {
        showToast('Unable to open the refund review dialog right now.', 'error');
        return;
    }

    const isApproval = decision === 'APPROVED';
    const title = isApproval ? 'Approve cancellation refund' : 'Deny cancellation refund';
    const summary = isApproval
        ? 'Confirm this refund approval after reviewing the cancellation details below.'
        : 'Review this request carefully and record the reason for denying the refund.';
    const noteLabel = isApproval ? 'Approval note' : 'Denial note';
    const notePlaceholder = isApproval
        ? 'Optional note for the customer or your records...'
        : 'Explain why this refund is being denied...';

    document.getElementById('refundReviewId').value = String(refundId);
    document.getElementById('refundReviewDecision').value = decision;
    document.getElementById('refundReviewTitle').textContent = title;
    document.getElementById('refundReviewSummary').textContent = summary;
    document.getElementById('refundReviewStatusPill').textContent = isApproval ? 'Approval review' : 'Denial review';
    document.getElementById('refundReviewOrderId').textContent = `#${request.order_id}`;
    document.getElementById('refundReviewCustomer').textContent = request.customer_name || 'Customer deleted';
    document.getElementById('refundReviewCancelledAt').textContent = new Date(request.cancelled_at).toLocaleString();
    document.getElementById('refundReviewAmount').textContent = formatKsh(request.total);
    document.getElementById('refundReviewReason').textContent = request.reason || 'No cancellation reason provided.';
    document.getElementById('refundReviewNoteLabel').textContent = noteLabel;

    const notesField = document.getElementById('refundReviewNotes');
    notesField.value = '';
    notesField.placeholder = notePlaceholder;

    const confirmButton = document.getElementById('refundReviewConfirmBtn');
    confirmButton.textContent = isApproval ? 'Approve refund' : 'Deny refund';
    confirmButton.className = `btn ${isApproval ? 'btn-primary' : 'btn-danger'}`;

    modal.style.display = 'block';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        return;
    }

    modal.style.display = 'none';

    if (modalId === 'refundReviewModal') {
        const form = document.getElementById('refundReviewForm');
        if (form) {
            form.reset();
        }
    }
}

async function submitRefundReviewFromModal(event) {
    event.preventDefault();

    const refundId = Number(document.getElementById('refundReviewId').value);
    const decision = String(document.getElementById('refundReviewDecision').value || '');
    const confirmButton = document.getElementById('refundReviewConfirmBtn');

    if (!refundId || !decision) {
        showToast('Refund review details are incomplete.', 'error');
        return;
    }

    try {
        confirmButton.disabled = true;
        await reviewRefund(refundId, decision);
    } finally {
        confirmButton.disabled = false;
    }
}

window.updateOrderStatus = updateOrderStatus;
window.assignDeliveryPrompt = assignDeliveryPrompt;
window.overrideCancelOrder = overrideCancelOrder;
window.reviewRefund = reviewRefund;
window.openRefundReviewModal = openRefundReviewModal;
window.submitRefundReviewFromModal = submitRefundReviewFromModal;
window.closeModal = closeModal;
window.refreshCancellationRequests = loadCancellationRequests;
window.scrollToOrdersDirectory = scrollToOrdersDirectory;
