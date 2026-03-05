let analyticsUser = null;
let refreshTimer = null;
const chartRegistry = {};

const formatCurrency = (value) => `KSh ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;

const formatDate = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString();
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth() || !auth.requireRole('admin')) return;

    analyticsUser = auth.getCurrentUser();
    const roleNode = document.querySelector('.dashboard-header .user-role');
    if (analyticsUser && roleNode) {
        roleNode.textContent = analyticsUser.role.toUpperCase();
    }

    bindEvents();
    await loadAnalytics();
    refreshTimer = setInterval(loadAnalytics, 30000);
});

window.addEventListener('beforeunload', () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
});

function bindEvents() {
    document.getElementById('applyFiltersBtn').addEventListener('click', loadAnalytics);
    document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('exportPdfBtn').addEventListener('click', () => window.print());
    document.getElementById('rangePreset').addEventListener('change', toggleCustomDateInputs);
    toggleCustomDateInputs();
}

function getFilters() {
    const preset = document.getElementById('rangePreset').value;
    const granularity = document.getElementById('trendGranularity').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    const filters = { preset, granularity };
    if (preset === 'custom') {
        if (startDate) filters.startDate = `${startDate}T00:00:00`;
        if (endDate) filters.endDate = `${endDate}T23:59:59`;
    }
    return filters;
}

function toggleCustomDateInputs() {
    const preset = document.getElementById('rangePreset').value;
    const isCustom = preset === 'custom';
    document.getElementById('startDate').disabled = !isCustom;
    document.getElementById('endDate').disabled = !isCustom;
}

function resetFilters() {
    document.getElementById('rangePreset').value = 'month';
    document.getElementById('trendGranularity').value = 'daily';
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    toggleCustomDateInputs();
    loadAnalytics();
}

async function loadAnalytics() {
    try {
        const response = await api.getAnalytics(getFilters());
        const analytics = response.data;

        renderKpis(analytics.kpis);
        renderCharts(analytics.visualizations);
        renderExpenses(analytics.expenses);
        renderInsights(analytics.insights);
        renderDeliveryPerformance(analytics.deliveryStaffPerformance);
        renderCustomerAnalytics(analytics.customerAnalytics);
        renderAdditionalAnalytics(analytics.highValueAdditions);
    } catch (error) {
        console.error('Failed to load analytics data:', error);
        alert(`Failed to load analytics: ${error.message}`);
    }
}

async function exportCsv() {
    try {
        const blob = await api.exportAnalyticsCsv(getFilters());
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert(`CSV export failed: ${error.message}`);
    }
}

function renderKpis(kpis) {
    const cards = [
        ['Total Sales (All-time)', formatCurrency(kpis.totalSalesAllTime)],
        ['Daily Sales', formatCurrency(kpis.dailySales)],
        ['Weekly Sales', formatCurrency(kpis.weeklySales)],
        ['Monthly Sales', formatCurrency(kpis.monthlySales)],
        ['Total Orders', Number(kpis.totalOrders || 0).toLocaleString()],
        ['Average Order Value', formatCurrency(kpis.averageOrderValue)],
        ['Revenue Growth Rate', formatPercent(kpis.revenueGrowthRate)]
    ];

    document.getElementById('kpiGrid').innerHTML = cards.map(([title, value]) => `
        <article class="kpi-card">
            <small>${title}</small>
            <strong>${value}</strong>
        </article>
    `).join('');
}

function renderCharts(visualizations) {
    drawChart('salesTrendChart', 'line', {
        labels: visualizations.salesTrend.map((x) => x.label),
        datasets: [{
            label: 'Sales',
            data: visualizations.salesTrend.map((x) => x.sales),
            borderColor: '#d62828',
            backgroundColor: 'rgba(214, 40, 40, 0.18)',
            fill: true,
            tension: 0.35
        }]
    });

    drawChart('revenueExpensesChart', 'bar', {
        labels: visualizations.revenueVsExpenses.map((x) => x.label),
        datasets: [{
            label: 'Revenue',
            data: visualizations.revenueVsExpenses.map((x) => x.revenue),
            backgroundColor: '#f77f00'
        }, {
            label: 'Expenses',
            data: visualizations.revenueVsExpenses.map((x) => x.expenses),
            backgroundColor: '#577590'
        }]
    });

    drawChart('salesCategoryChart', 'pie', {
        labels: visualizations.salesDistributionByCategory.map((x) => x.category),
        datasets: [{
            data: visualizations.salesDistributionByCategory.map((x) => x.revenue),
            backgroundColor: ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#003049', '#2a9d8f']
        }]
    });

    drawChart('topProductsChart', 'bar', {
        labels: visualizations.topSellingProducts.map((x) => x.name),
        datasets: [{
            label: 'Qty Sold',
            data: visualizations.topSellingProducts.map((x) => x.quantitySold),
            backgroundColor: '#2a9d8f'
        }]
    });

    drawChart('productComparisonChart', 'bar', {
        labels: visualizations.productComparison.map((x) => x.name),
        datasets: [{
            label: 'Quantity',
            data: visualizations.productComparison.map((x) => x.quantitySold),
            backgroundColor: '#264653'
        }, {
            label: 'Revenue',
            data: visualizations.productComparison.map((x) => x.revenue),
            backgroundColor: '#e76f51'
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

function renderExpenses(expenses) {
    document.getElementById('expenseSummary').innerHTML = `
        <p><strong>Total Expenses:</strong> ${formatCurrency(expenses.totalExpenses)}</p>
        <p><strong>Net Profit:</strong> ${formatCurrency(expenses.netProfit)}</p>
    `;

    if (!expenses.breakdown.length) {
        document.getElementById('expenseBreakdown').innerHTML = '<p>No expense entries found for selected period.</p>';
        return;
    }

    document.getElementById('expenseBreakdown').innerHTML = `
        <table>
            <thead><tr><th>Category</th><th>Total</th></tr></thead>
            <tbody>
                ${expenses.breakdown.map((item) => `<tr><td>${item.category}</td><td>${formatCurrency(item.total)}</td></tr>`).join('')}
            </tbody>
        </table>
    `;
}

function renderInsights(insights) {
    document.getElementById('salesInsights').innerHTML = `
        <p><strong>Most Selling Day:</strong> ${insights.mostSellingDay ? `${formatDate(insights.mostSellingDay.date)} (${formatCurrency(insights.mostSellingDay.revenue)})` : 'N/A'}</p>
        <p><strong>Most Selling Product:</strong> ${insights.mostSellingProduct ? `${insights.mostSellingProduct.name} (Qty ${insights.mostSellingProduct.quantity}, ${formatCurrency(insights.mostSellingProduct.revenue)})` : 'N/A'}</p>
        <p><strong>Slowest Day:</strong> ${insights.slowestDay ? `${formatDate(insights.slowestDay.date)} (${formatCurrency(insights.slowestDay.revenue)})` : 'N/A'}</p>
        <p><strong>Best Performing Time of Day:</strong> ${insights.bestPerformingTimeOfDay ? `${insights.bestPerformingTimeOfDay.hour}:00 (${formatCurrency(insights.bestPerformingTimeOfDay.revenue)})` : 'N/A'}</p>
    `;
}

function renderDeliveryPerformance(performance) {
    if (!performance.length) {
        document.getElementById('deliveryPerformance').innerHTML = '<p>No delivery performance data available.</p>';
        return;
    }

    document.getElementById('deliveryPerformance').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Staff</th>
                    <th>Total Deliveries</th>
                    <th>Total Sales</th>
                    <th>Avg Delivery Time</th>
                    <th>Customer Rating</th>
                </tr>
            </thead>
            <tbody>
                ${performance.map((person, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${person.name}</td>
                        <td>${person.totalDeliveries}</td>
                        <td>${formatCurrency(person.totalSalesHandled)}</td>
                        <td>${person.averageDeliveryTimeMinutes.toFixed(2)} mins</td>
                        <td>${person.customerRating === null ? 'N/A' : person.customerRating}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderCustomerAnalytics(customerAnalytics) {
    const frequent = customerAnalytics.mostFrequentCustomers.slice(0, 5);
    const highest = customerAnalytics.highestSpendingCustomers.slice(0, 5);
    const customerOfMonth = customerAnalytics.customerOfTheMonth;

    document.getElementById('customerAnalytics').innerHTML = `
        <p><strong>Customer Retention Rate:</strong> ${formatPercent(customerAnalytics.retentionRate)}</p>
        <p><strong>Repeat vs New:</strong> ${customerAnalytics.repeatVsNewCustomerRatio.repeatCustomers} repeat / ${customerAnalytics.repeatVsNewCustomerRatio.newCustomers} new</p>
        <p><strong>Customer of the Month:</strong> ${customerOfMonth ? `${customerOfMonth.name} (${formatCurrency(customerOfMonth.spending)}, ${customerOfMonth.orderCount} orders, Reward Eligible: ${customerOfMonth.rewardEligible ? 'Yes' : 'No'})` : 'N/A'}</p>
        <h4>Most Frequent Customers</h4>
        <table>
            <thead><tr><th>Name</th><th>Orders</th><th>Spending</th></tr></thead>
            <tbody>
                ${frequent.map((item) => `<tr><td>${item.name}</td><td>${item.orderCount}</td><td>${formatCurrency(item.spending)}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>'}
            </tbody>
        </table>
        <h4>Highest Spending Customers</h4>
        <table>
            <thead><tr><th>Name</th><th>Spending</th><th>Orders</th></tr></thead>
            <tbody>
                ${highest.map((item) => `<tr><td>${item.name}</td><td>${formatCurrency(item.spending)}</td><td>${item.orderCount}</td></tr>`).join('') || '<tr><td colspan="3">No data</td></tr>'}
            </tbody>
        </table>
    `;
}

function renderAdditionalAnalytics(additions) {
    document.getElementById('additionalAnalytics').innerHTML = `
        <p><strong>Sales Forecasting (Next Period Revenue):</strong> ${formatCurrency(additions.salesForecasting.projectedNextPeriodRevenue)}</p>
        <p><strong>Conversion Rate:</strong> ${additions.conversionRate === null ? 'N/A (no funnel data)' : formatPercent(additions.conversionRate)}</p>
        <p><strong>Abandoned Cart Rate:</strong> ${additions.abandonedCartRate === null ? 'N/A (cart abandonment tracking unavailable)' : formatPercent(additions.abandonedCartRate)}</p>
        <p><strong>Refund / Cancellation Rate:</strong> ${additions.refundCancellationRate === null ? 'N/A (no refund/cancel events)' : formatPercent(additions.refundCancellationRate)}</p>
        <p><strong>Inventory Turnover Rate:</strong> ${additions.inventoryTurnoverRate === null ? 'N/A' : additions.inventoryTurnoverRate}</p>
        <p><strong>Low-Stock Alerts:</strong> ${additions.lowStockAlerts.length ? additions.lowStockAlerts.join(', ') : 'No low-stock alerts data'}</p>
        <p><strong>Profit Margin per Product:</strong> ${additions.profitMarginPerProduct === null ? 'N/A (cost data unavailable)' : additions.profitMarginPerProduct}</p>
        <p><strong>Geographic Sales Distribution:</strong> ${additions.geographicSalesDistribution === null ? 'N/A (location data unavailable)' : additions.geographicSalesDistribution}</p>
    `;

    renderHeatmap(additions.peakOrderingHoursHeatmap || []);
}

function renderHeatmap(heatmapData) {
    const container = document.getElementById('peakHoursHeatmap');
    if (!heatmapData.length) {
        container.innerHTML = '<p>No heatmap data for selected period.</p>';
        return;
    }

    const maxOrders = Math.max(...heatmapData.map((x) => x.orderCount), 1);
    const matrix = new Map(heatmapData.map((x) => [`${x.dayOfWeek}-${x.hourOfDay}`, x.orderCount]));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const rows = days.map((day, dayIndex) => {
        const cols = Array.from({ length: 24 }, (_, hour) => {
            const value = matrix.get(`${dayIndex + 1}-${hour}`) || 0;
            const intensity = Math.min(1, value / maxOrders);
            return `<span class="heat-cell" style="background: rgba(214, 40, 40, ${0.12 + intensity * 0.88})" title="${day} ${hour}:00 (${value} orders)"></span>`;
        }).join('');
        return `<div class="heat-row"><label>${day}</label><div class="heat-cols">${cols}</div></div>`;
    }).join('');

    container.innerHTML = rows;
}
