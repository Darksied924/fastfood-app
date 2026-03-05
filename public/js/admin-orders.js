document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;
    if (!auth.requireRole('admin')) return;

    const filter = document.getElementById('orderStatusFilter');
    filter.addEventListener('change', async () => {
        await loadOrders(filter.value);
    });

    await loadOrders('');
});

const ORDER_STATUS_ORDER = ['pending', 'paid', 'preparing', 'out_for_delivery', 'delivered'];
const ORDER_STATUS_LABELS = {
    pending: 'Pending',
    paid: 'Paid',
    preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered'
};

const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

async function loadOrders(status = '') {
    try {
        const response = await api.getAllOrders(status);
        const orders = response.data;
        const container = document.getElementById('all-orders-list');
        renderOrdersByStatus(orders, container);
    } catch (error) {
        alert(`Failed to load orders: ${error.message}`);
    }
}

function renderOrdersByStatus(orders, container) {
    if (orders.length === 0) {
        container.innerHTML = '<p>No orders found</p>';
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

    return `
        <section class="role-user-section">
            <div class="role-user-section-header">
                <h4>${statusLabel}</h4>
                <span class="role-count">${orders.length}</span>
            </div>
            ${renderOrdersTable(orders)}
        </section>
    `;
}

function renderOrdersTable(orders) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
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
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customer_name || '-'}</td>
                        <td>${formatKsh(order.total)}</td>
                        <td><span class="status-badge status-${order.status}">${order.status}</span></td>
                        <td>${getReadBadge(order.manager_read_at)}</td>
                        <td>${order.delivery_name || 'Unassigned'}</td>
                        <td>${new Date(order.created_at).toLocaleDateString()}</td>
                        <td>
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
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function getReadBadge(managerReadAt) {
    if (managerReadAt) {
        return '<span class="status-badge read-state-badge read-state-read">Read</span>';
    }
    return '<span class="status-badge read-state-badge read-state-unread">Unread</span>';
}

async function updateOrderStatus(orderId, status) {
    try {
        const response = await api.updateOrderStatus(orderId, status);
        if (response.success) {
            await loadOrders(document.getElementById('orderStatusFilter').value);
        }
    } catch (error) {
        alert(`Failed to update order status: ${error.message}`);
    }
}

async function assignDeliveryPrompt(orderId) {
    const deliveryId = prompt('Enter delivery user ID:');
    if (!deliveryId) return;

    try {
        const response = await api.assignDelivery(orderId, deliveryId);
        if (response.success) {
            alert('Delivery assigned successfully');
            await loadOrders(document.getElementById('orderStatusFilter').value);
        }
    } catch (error) {
        alert(`Failed to assign delivery: ${error.message}`);
    }
}

window.updateOrderStatus = updateOrderStatus;
window.assignDeliveryPrompt = assignDeliveryPrompt;
