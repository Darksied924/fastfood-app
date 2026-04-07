let refreshTimer = null;
const chartRegistry = {};
let assignedOrdersCache = [];

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

let deliveryUser = null;
let trackingMap = null;
let driverMarker = null;
let locationWatchId = null;
let lastSentLocation = null;

function setLeafletDebugOverlay(message) {
    const overlay = document.getElementById('leafletDebugOverlay');
    if (!overlay) return;
    overlay.textContent = message || '';
    overlay.style.display = message ? 'block' : 'none';
}

async function ensureLeafletLoaded() {
    setLeafletDebugOverlay('Checking Leaflet asset availability...');
    if (typeof L !== 'undefined') {
        setLeafletDebugOverlay('Leaflet is already available.');
        return true;
    }

    const existingScript = document.querySelector('script[src*="leaflet"]');
    if (existingScript) {
        if (existingScript.readyState === 'complete' || existingScript.readyState === 'loaded') {
            const loaded = typeof L !== 'undefined';
            setLeafletDebugOverlay(loaded ? 'Leaflet loaded from existing script.' : 'Leaflet existing script has not finished loading yet.');
            return loaded;
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                existingScript.removeEventListener('load', onLoad);
                existingScript.removeEventListener('error', onError);
                const loaded = typeof L !== 'undefined';
                setLeafletDebugOverlay(loaded ? 'Leaflet loaded after waiting.' : 'Leaflet load timed out.');
                resolve(loaded);
            }, 15000);

            const onLoad = () => {
                clearTimeout(timeout);
                setLeafletDebugOverlay('Leaflet loaded successfully.');
                resolve(typeof L !== 'undefined');
            };

            const onError = () => {
                clearTimeout(timeout);
                setLeafletDebugOverlay('Leaflet script failed to load.');
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
        script.onload = () => {
            setLeafletDebugOverlay('Leaflet downloaded successfully.');
            resolve(typeof L !== 'undefined');
        };
        script.onerror = () => {
            setLeafletDebugOverlay('Leaflet script failed to download.');
            resolve(false);
        };
        document.head.appendChild(script);

        setTimeout(() => {
            const loaded = typeof L !== 'undefined';
            setLeafletDebugOverlay(loaded ? 'Leaflet loaded after timeout.' : 'Leaflet load timed out.');
            resolve(loaded);
        }, 15000);
    });
}

function setupDeliverySocket() {
    if (!window.socketClient || typeof window.socketClient.connect !== 'function') {
        return;
    }

    window.socketClient.connect();
    window.socketClient.on('deliveryAssigned', () => {
        loadDashboard();
    });
    window.socketClient.on('orderStatusUpdated', (payload) => {
        if (!deliveryUser || Number(payload.deliveryId) !== Number(deliveryUser.id)) {
            return;
        }
        loadDashboard();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth() || !auth.requireRole('delivery')) return;

    const user = auth.getCurrentUser();
    deliveryUser = user;
    const roleNode = document.getElementById('deliveryRole');
    if (user && roleNode) {
        roleNode.textContent = user.role.toUpperCase();
    }

    await loadDashboard();
    await loadDriverLocation();
    setupDeliverySocket();
    await setupDeliveryTracking();
    refreshTimer = setInterval(loadDashboard, 30000);
});

window.addEventListener('beforeunload', () => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    if (locationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
    }
});

async function initializeDeliveryMap() {
    const mapContainer = document.getElementById('deliveryLocationMap');
    const statusNode = document.getElementById('deliveryLocationStatus');
    if (!mapContainer) {
        if (statusNode) {
            statusNode.textContent = 'Unable to initialize map container. Please refresh or contact support.';
        }
        return;
    }

    if (typeof L === 'undefined') {
        if (statusNode) {
            statusNode.textContent = 'Loading map assets...';
        }
        const loaded = await ensureLeafletLoaded();
        if (!loaded || typeof L === 'undefined') {
            if (statusNode) {
                statusNode.textContent = 'Unable to initialize map. Please refresh or try again later.';
            }
            return;
        }
    }

    mapContainer.style.width = '100%';
    mapContainer.style.minHeight = '360px';
    mapContainer.style.height = '360px';

    if (!trackingMap) {
        trackingMap = L.map('deliveryLocationMap', {
            scrollWheelZoom: false,
            zoomControl: true
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(trackingMap);

        trackingMap.setView([1.2921, 36.8219], 12);

        setTimeout(() => {
            if (trackingMap && typeof trackingMap.invalidateSize === 'function') {
                trackingMap.invalidateSize(true);
            }
            setLeafletDebugOverlay('Leaflet map initialized successfully.');
        }, 200);
    }
}

async function updateDeliveryMap(latitude, longitude) {
    if (!trackingMap || typeof L === 'undefined') {
        await initializeDeliveryMap();
    }

    if (!trackingMap) {
        return;
    }

    const position = [latitude, longitude];

    if (trackingMap && typeof trackingMap.invalidateSize === 'function') {
        trackingMap.invalidateSize(true);
    }

    if (!driverMarker) {
        driverMarker = L.marker(position).addTo(trackingMap);
    } else {
        driverMarker.setLatLng(position);
    }

    trackingMap.setView(position, 14, {
        animate: true,
        duration: 0.5
    });

    const statusNode = document.getElementById('deliveryLocationStatus');
    if (statusNode) {
        statusNode.textContent = `Current driver location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
}

async function sendDriverLocation(latitude, longitude) {
    const locationSignature = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    if (lastSentLocation === locationSignature) {
        return;
    }

    lastSentLocation = locationSignature;

    try {
        await api.updateDeliveryLocation({ latitude, longitude });
    } catch (error) {
        console.warn('Driver location update failed:', error.message || error);
    }
}

async function setupDeliveryTracking() {
    await initializeDeliveryMap();

    if (!navigator.geolocation) {
        const statusNode = document.getElementById('deliveryLocationStatus');
        if (statusNode) {
            statusNode.textContent = 'Geolocation is not supported by this browser.';
        }
        return;
    }

    const options = {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 15000
    };

    locationWatchId = navigator.geolocation.watchPosition(
        async (position) => {
            if (!position || !position.coords) {
                return;
            }

            const { latitude, longitude } = position.coords;
            await updateDeliveryMap(latitude, longitude);
            await sendDriverLocation(latitude, longitude);
        },
        (error) => {
            const statusNode = document.getElementById('deliveryLocationStatus');
            if (statusNode) {
                statusNode.textContent = `Location error: ${error.message || 'Unable to read location'}`;
            }
            console.warn('Geolocation watch error:', error);
        },
        options
    );
}

async function loadDriverLocation() {
    await initializeDeliveryMap();

    try {
        const response = await api.getDeliveryLocation();
        const location = response.data;
        if (location && location.latitude !== null && location.longitude !== null) {
            await updateDeliveryMap(location.latitude, location.longitude);
        }
    } catch (error) {
        console.warn('Unable to load last known driver location:', error.message || error);
    }
}

async function loadDashboard() {
    try {
        const response = await api.getDeliveryDashboard();
        const payload = response.data;

        renderKpis(payload.performanceMetrics);
        
        // Sort assigned orders by assignedAt time (earliest first, most recent last)
        const sortedAssignedOrders = [...payload.ordersOverview.assignedOrders].sort((a, b) => {
            return new Date(a.assignedAt) - new Date(b.assignedAt);
        });
        renderAssignedOrders(sortedAssignedOrders);
        
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
        assignedOrdersCache = [];
        return;
    }

    // Store orders in cache for use in markDelivered
    assignedOrdersCache = orders;

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
    // Get the order details from cache
    const order = assignedOrdersCache.find(o => o.id === orderId);
    const customerName = order?.customerName || 'Customer';
    
    try {
        await api.markAsDelivered(orderId);
        // Show toast notification with order details
        showToast(`✅ Order #${orderId} (${customerName}) marked as Delivered! 🎉`, 'success');
        await loadDashboard();
    } catch (error) {
        showToast(`Failed to mark as delivered: ${error.message}`, 'error');
    }
}

window.markDelivered = markDelivered;
