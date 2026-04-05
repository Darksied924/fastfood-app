// Manager Products JS (fallback if not exist)
async function loadCancelledOrders() {
    try {
        const response = await api.getCancelledOrders();
        const container = document.getElementById('cancelled-orders-list');
        container.innerHTML = response.data.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <span>#${order.id}</span>
                    <span class="status-badge status-cancelled">CANCELLED</span>
                </div>
                <div class="order-details">
                    <p>Customer: ${order.customer_name}</p>
                    <p>Cancelled: ${order.reason}</p>
                    <p>Refund: ${order.refund_status}</p>
                </div>
            </div>
        `).join('') || '<p>No cancelled orders</p>';
    } catch (error) {
        document.getElementById('cancelled-orders-list').innerHTML = '<p>Error loading cancelled orders</p>';
    }
}
