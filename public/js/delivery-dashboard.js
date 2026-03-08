let refreshTimer = null;
const chartRegistry = {};

const formatCurrency = (value) => `KSh ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
};

const formatMinutes = (value) => `${Number(value || 0).toFixed(2)} mins`;

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth() || !auth.requireRole('delivery')) return;

    const user = auth.getCurrentUser();
    const roleNode = document.getElementById('deliveryRole');
    if (user && roleNode) {
        roleNode.textContent = user.role.toUpperCase();
    }

    await loadDashboard();
    refreshTimer = setInterval(loadDashboard, 30000);
});

window.addEventListener('beforeunload', () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
});

async function loadDashboard() {
    try {
        const response = await api.getDeliveryDashboard();
        const payload = response.data;

        renderKpis(payload.performanceMetrics);
        renderAssignedOrders(payload.ordersOverview.assignedOrders);
        renderDeliveredOrders(payload.ordersOverview.deliveredOrders);
        renderCharts(payload.analytics);
        renderAdvanced(payload.advanced);
    } catch (error) {
        console.error('Failed to load delivery dashboard:', error);
        alert(`Failed to load dashboard: ${error.message}`);
    }
}

function renderKpis(metrics) {
    const cards = [
        ['Total Deliveries (All-Time)', Number(metrics.totalDeliveriesAllTime || 0).toLocaleString()],
        ['Deliveries Today', Number(metrics.deliveriesToday || 0).toLocaleString()],
        ['Deliveries This Week', Number(metrics.deliveriesThisWeek || 0).toLocaleString()],
        ['Deliveries This Month', Number(metrics.deliveriesThisMonth || 0).toLocaleString()],
        ['Average Delivery Time', formatMinutes(metrics.averageDeliveryTimeMinutes)],
        ['Fastest Delivery Time', formatMinutes(metrics.fastestDeliveryTimeMinutes)],
        ['On-Time Delivery Rate', `${Number(metrics.onTimeDeliveryRate || 0).toFixed(2)}%`]
    ];

    document.getElementById('kpiGrid').innerHTML = cards.map(([title, value]) => `
        <article class="kpi-card">
            <small>${title}</small>
            <strong>${value}</strong>
        </article>
    `).join('');
}

function renderAssignedOrders(orders) {
    const wrap = document.getElementById('assignedOrdersWrap');
    if (!orders.length) {
        wrap.innerHTML = '<p>No currently assigned orders.</p>';
        return;
    }

    wrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Assigned Time</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map((order) => `
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customerName}</td>
                        <td>${order.address || 'N/A'}</td>
                        <td>${formatDateTime(order.assignedAt)}</td>
                        <td><span class="status-badge status-${order.status}">${order.status}</span></td>
                        <td>
                            <button class="btn btn-primary btn-small" type="button" onclick="markDelivered(${order.id})">Delivered</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderDeliveredOrders(orders) {
    const wrap = document.getElementById('deliveredOrdersWrap');
    if (!orders.length) {
        wrap.innerHTML = '<p>No delivered orders found for the selected filters.</p>';
        return;
    }

    wrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Assigned Time</th>
                    <th>Delivered At</th>
                    <th>Duration</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map((order) => `
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customerName}</td>
                        <td>${order.address || 'N/A'}</td>
                        <td>${formatDateTime(order.assignedAt)}</td>
                        <td>${formatDateTime(order.deliveredAt)}</td>
                        <td>${formatMinutes(order.deliveryDurationMinutes)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderCharts(analytics) {
    drawChart('deliveriesTrendChart', 'line', {
        labels: analytics.deliveriesPerDayTrend.map((item) => item.label),
        datasets: [{
            label: 'Deliveries',
            data: analytics.deliveriesPerDayTrend.map((item) => item.deliveries),
            borderColor: '#d62828',
            backgroundColor: 'rgba(214, 40, 40, 0.2)',
            fill: true,
            tension: 0.3
        }]
    });

    drawChart('periodComparisonChart', 'bar', {
        labels: analytics.periodComparison.map((item) => item.label),
        datasets: [{
            label: 'Deliveries',
            data: analytics.periodComparison.map((item) => item.deliveries),
            backgroundColor: '#f77f00'
        }]
    });

    drawChart('onTimePieChart', 'pie', {
        labels: ['On-Time', 'Late'],
        datasets: [{
            data: [analytics.onTimeVsLate.onTime, analytics.onTimeVsLate.late],
            backgroundColor: ['#2a9d8f', '#d62828']
        }]
    });

    drawChart('durationTrendChart', 'line', {
        labels: analytics.averageDeliveryDurationTrend.map((item) => item.label),
        datasets: [{
            label: 'Avg Minutes',
            data: analytics.averageDeliveryDurationTrend.map((item) => item.averageMinutes),
            borderColor: '#264653',
            backgroundColor: 'rgba(38, 70, 83, 0.2)',
            fill: true,
            tension: 0.3
        }]
    });
}

function drawChart(canvasId, type, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartRegistry[canvasId]) {
        chartRegistry[canvasId].destroy();
    }

    chartRegistry[canvasId] = new Chart(canvas, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                }
            }
        }
    });
}

function renderAdvanced(advanced) {
    // Handle null earningsSummary for delivery personnel (payment info is protected)
    const earningsText = advanced.earningsSummary === null
        ? 'Hidden (payment information protected)'
        : advanced.earningsSummary.estimatedEarnings === null
            ? `Not configured (set commission rate to estimate). Delivered value: ${formatCurrency(advanced.earningsSummary.deliveredOrderValue)}`
            : `${formatCurrency(advanced.earningsSummary.estimatedEarnings)} (${advanced.earningsSummary.commissionRatePercent}% of ${formatCurrency(advanced.earningsSummary.deliveredOrderValue)})`;

    document.getElementById('advancedSummary').innerHTML = `
        <p><strong>Earnings Summary:</strong> ${earningsText}</p>
        <p><strong>Customer Ratings:</strong> ${advanced.customerRatingsSummary === null ? 'N/A (not captured)' : advanced.customerRatingsSummary}</p>
        <p><strong>Distance Covered:</strong> ${advanced.distanceCoveredKm === null ? 'N/A (GPS not captured)' : `${advanced.distanceCoveredKm} km`}</p>
        <p><strong>Missed Orders (Potential):</strong> ${advanced.missedOrReassignedOrders.potentiallyMissed}</p>
        <p><strong>Reassigned/Returned Orders:</strong> ${advanced.missedOrReassignedOrders.reassignedOrReturned}</p>
        <p><strong>Performance Rank:</strong> ${advanced.performanceRanking ? `${advanced.performanceRanking.rank}/${advanced.performanceRanking.totalDeliveryStaff}` : 'N/A'}</p>
    `;

    const peakHoursWrap = document.getElementById('peakHoursWrap');
    if (!advanced.peakDeliveryHours.length) {
        peakHoursWrap.innerHTML = '<p>No peak-hour delivery data yet.</p>';
        return;
    }

    peakHoursWrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Hour</th>
                    <th>Deliveries</th>
                </tr>
            </thead>
            <tbody>
                ${advanced.peakDeliveryHours.map((entry) => `
                    <tr>
                        <td>${String(entry.hourOfDay).padStart(2, '0')}:00</td>
                        <td>${entry.deliveries}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function markDelivered(orderId) {
    try {
        await api.markAsDelivered(orderId);
        await loadDashboard();
    } catch (error) {
        alert(`Failed to mark as delivered: ${error.message}`);
    }
}

window.markDelivered = markDelivered;
