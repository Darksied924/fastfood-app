// Dashboard functionality
let currentUser = null;
let deliveryPersonnelCache = [];

const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    if (!auth.requireAuth()) return;

    // Get current user
    currentUser = auth.getCurrentUser();
    await refreshCurrentUser();
    
    // Update UI with user info
    renderCurrentUserHeader();

    // Load appropriate view based on role
    loadDashboard();
});

async function refreshCurrentUser() {
    try {
        const response = await api.getCurrentUser();
        currentUser = response.data;
        auth.updateCurrentUser(currentUser);
    } catch (error) {
        console.error('Failed to refresh user profile:', error);
    }
}

function renderCurrentUserHeader() {
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role.toUpperCase();
}

async function loadDashboard() {
    // Hide all role views
    document.querySelectorAll('.role-view').forEach(view => {
        view.style.display = 'none';
    });

    // Show view based on role
    switch (currentUser.role) {
        case 'customer':
            window.location.href = '/customer/menu';
            break;
        case 'admin':
            document.getElementById('adminView').style.display = 'block';
            await loadAdminDashboard();
            break;
        case 'manager':
            document.getElementById('managerView').style.display = 'block';
            await loadManagerDashboard('paid');
            break;
        case 'delivery':
            window.location.href = '/delivery/dashboard';
            break;
    }
}

// Customer Dashboard
async function loadCustomerDashboard() {
    await loadCustomerProducts();
    await loadCustomerOrders();
    cart.updateCartUI();
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
        const container = document.getElementById('customer-orders');
        
        if (orders.length === 0) {
            container.innerHTML = '<p>No orders yet</p>';
            return;
        }

        container.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <span>Order #${order.id}</span>
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div class="order-details">
                    <p>Total: ${formatKsh(order.total)}</p>
                    <p>Date: ${new Date(order.created_at).toLocaleString()}</p>
                    ${order.delivery_name ? `<p>Delivery: ${order.delivery_name}</p>` : ''}
                </div>
                <div class="order-items">
                    ${order.items.map(item => `
                        <div class="order-item">
                            <span>${item.product_name} x${item.quantity}</span>
                            <span>${formatKsh(item.price * item.quantity)}</span>
                        </div>
                    `).join('')}
                </div>
                ${order.status === 'pending' ? `
                    <button class="btn btn-primary" onclick="showPaymentModal(${order.id}, ${order.total})">
                        Pay Now
                    </button>
                ` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load orders:', error);
    }
}

// Admin Dashboard
async function loadAdminDashboard() {
    const totalSalesNode = document.getElementById('analyticsPreviewTotalSales');
    const todaySalesNode = document.getElementById('analyticsPreviewTodaySales');

    if (!totalSalesNode || !todaySalesNode) {
        return;
    }

    try {
        const response = await api.getAnalytics({ preset: 'today' });
        const analytics = response.data;
        totalSalesNode.textContent = formatKsh(analytics.kpis.totalSalesAllTime);
        todaySalesNode.textContent = formatKsh(analytics.kpis.dailySales);
    } catch (error) {
        console.error('Failed to load analytics preview:', error);
        totalSalesNode.textContent = 'N/A';
        todaySalesNode.textContent = 'N/A';
    }
}

async function loadUsers() {
    try {
        const response = await api.getAllUsers();
        const users = response.data;
        const container = document.getElementById('users-list');
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => `
                        <tr>
                            <td>${user.id}</td>
                            <td>${user.name}</td>
                            <td>${user.email}</td>
                            <td>
                                <select onchange="updateUserRole(${user.id}, this.value)">
                                    <option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option>
                                    <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
                                    <option value="delivery" ${user.role === 'delivery' ? 'selected' : ''}>Delivery</option>
                                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                                </select>
                            </td>
                            <td>
                                <button class="btn btn-secondary btn-small" onclick="deleteUser(${user.id})">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

async function loadAllProducts() {
    try {
        const response = await api.getProducts();
        const products = response.data;
        const container = document.getElementById('products-list');
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Image</th>
                        <th>Name</th>
                        <th>Price</th>
                        <th>Available</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(product => `
                        <tr>
                            <td>${product.image || '🍔'}</td>
                            <td>${product.name}</td>
                            <td>${formatKsh(product.price)}</td>
                            <td>
                                <input type="checkbox" ${product.available ? 'checked' : ''} 
                                       onchange="toggleProductAvailability(${product.id})">
                            </td>
                            <td>
                                <button class="btn btn-secondary btn-small" onclick="editProduct(${product.id})">Edit</button>
                                <button class="btn btn-secondary btn-small" onclick="deleteProduct(${product.id})">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Failed to load products:', error);
    }
}

async function loadAllOrders() {
    try {
        const response = await api.getAllOrders();
        const orders = response.data;
        const container = document.getElementById('all-orders-list');
        
        renderOrdersTable(orders, container);
    } catch (error) {
        console.error('Failed to load orders:', error);
    }
}

// Manager Dashboard
async function loadManagerDashboard(status) {
    try {
        const response = await api.getAllOrders(status);
        const orders = response.data;
        const container = document.getElementById('manager-orders-list');

        renderManagerOrdersTable(orders, container);
    } catch (error) {
        console.error('Failed to load orders:', error);
    }
}

// Delivery Dashboard
async function loadDeliveryDashboard() {
    try {
        const response = await api.getAssignedOrders();
        const orders = response.data;
        const container = document.getElementById('delivery-orders-list');
        
        if (orders.length === 0) {
            container.innerHTML = '<p>No assigned orders</p>';
            return;
        }

        container.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <span>Order #${order.id}</span>
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div class="order-details">
                    <p>Customer: ${order.customer_name}</p>
                    <p>Phone: ${order.phone}</p>
                    <p>Total: ${formatKsh(order.total)}</p>
                </div>
                <div class="order-items">
                    ${order.items.map(item => `
                        <div class="order-item">
                            <span>${item.product_name} x${item.quantity}</span>
                        </div>
                    `).join('')}
                </div>
                ${order.status === 'out_for_delivery' ? `
                    <button class="btn btn-primary" onclick="markAsDelivered(${order.id})">
                        Mark as Delivered
                    </button>
                ` : ''}
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load assigned orders:', error);
    }
}

// Helper Functions
function renderOrdersTable(orders, container, showActions = false) {
    if (orders.length === 0) {
        container.innerHTML = '<p>No orders found</p>';
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Delivery</th>
                    <th>Date</th>
                    ${showActions ? '<th>Actions</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${orders.map(order => `
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customer_name}</td>
                        <td>${formatKsh(order.total)}</td>
                        <td>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </td>
                        <td>${order.delivery_name || 'Unassigned'}</td>
                        <td>${new Date(order.created_at).toLocaleDateString()}</td>
                        ${showActions ? `
                            <td>
                                <select onchange="updateOrderStatus(${order.id}, this.value)">
                                    <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option>
                                    <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                                    <option value="out_for_delivery" ${order.status === 'out_for_delivery' ? 'selected' : ''}>Out for Delivery</option>
                                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                                </select>
                                ${!order.delivery_id && order.status === 'paid' ? `
                                    <button class="btn btn-primary btn-small" onclick="showAssignModal(${order.id})">
                                        Assign
                                    </button>
                                ` : ''}
                            </td>
                        ` : ''}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderManagerOrdersTable(orders, container) {
    if (orders.length === 0) {
        container.innerHTML = '<p>No orders found</p>';
        return;
    }

    container.innerHTML = `
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
                ${orders.map(order => `
                    <tr>
                        <td>#${order.id}</td>
                        <td>${order.customer_name}</td>
                        <td>${formatKsh(order.total)}</td>
                        <td>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </td>
                        <td>${getReadBadge(order.manager_read_at)}</td>
                        <td>${order.delivery_name || 'Unassigned'}</td>
                        <td>${new Date(order.created_at).toLocaleDateString()}</td>
                        <td>
                            ${order.status === 'paid' ? `
                                <button class="btn btn-primary btn-small" onclick="markOrderAsRead(${order.id})">
                                    Start Preparing
                                </button>
                            ` : ''}
                            ${order.status === 'preparing' ? `
                                <button class="btn btn-primary btn-small" onclick="showAssignModal(${order.id})">
                                    Assign Delivery
                                </button>
                            ` : ''}
                            ${order.status !== 'paid' && order.status !== 'preparing' ? `
                                <span style="color:#666; font-size:0.9rem;">No action</span>
                            ` : ''}
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

// Tab Functions
function showTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

function showManagerTab(status) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    loadManagerDashboard(status);
}

// Modal Functions
function showAddUserModal() {
    document.getElementById('addUserModal').style.display = 'block';
}

function showAddProductModal() {
    document.getElementById('addProductModal').style.display = 'block';
}

function showPaymentModal(orderId, amount) {
    document.getElementById('orderId').value = orderId;
    document.getElementById('paymentAmount').textContent = formatKsh(amount);
    document.getElementById('paymentModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Action Functions
async function updateUserRole(userId, role) {
    try {
        const response = await api.updateUserRole(userId, role);
        if (response.success) {
            alert('User role updated successfully');
            loadUsers();
        }
    } catch (error) {
        alert('Failed to update user role: ' + error.message);
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
        const response = await api.deleteUser(userId);
        if (response.success) {
            alert('User deleted successfully');
            loadUsers();
        }
    } catch (error) {
        alert('Failed to delete user: ' + error.message);
    }
}

async function updateOrderStatus(orderId, status) {
    try {
        const response = await api.updateOrderStatus(orderId, status);
        if (response.success) {
            alert('Order status updated successfully');
            loadDashboard();
        }
    } catch (error) {
        alert('Failed to update order status: ' + error.message);
    }
}

async function markOrderAsRead(orderId) {
    try {
        const response = await api.updateOrderStatus(orderId, 'preparing');
        if (response.success) {
            alert('Order moved to preparing');
            loadManagerDashboard('paid');
        }
    } catch (error) {
        alert('Failed to mark order as read: ' + error.message);
    }
}

async function toggleProductAvailability(productId) {
    try {
        const response = await api.toggleProductAvailability(productId);
        if (response.success) {
            alert('Product availability updated');
            loadAllProducts();
        }
    } catch (error) {
        alert('Failed to update product: ' + error.message);
    }
}

async function deleteProduct(productId) {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
        const response = await api.deleteProduct(productId);
        if (response.success) {
            alert('Product deleted successfully');
            loadAllProducts();
        }
    } catch (error) {
        alert('Failed to delete product: ' + error.message);
    }
}

async function markAsDelivered(orderId) {
    try {
        const response = await api.markAsDelivered(orderId);
        if (response.success) {
            alert('Order marked as delivered');
            loadDeliveryDashboard();
        }
    } catch (error) {
        alert('Failed to mark as delivered: ' + error.message);
    }
}

function showAssignModal(orderId) {
    openAssignDeliveryModal(orderId);
}

async function assignDelivery(orderId, deliveryId) {
    try {
        const response = await api.assignDelivery(orderId, deliveryId);
        if (response.success) {
            alert('Delivery assigned and order moved to out_for_delivery');
            loadManagerDashboard('preparing');
        }
    } catch (error) {
        alert('Failed to assign delivery: ' + error.message);
    }
}

async function loadDeliveryPersonnel() {
    const response = await api.getDeliveryPersonnel();
    return Array.isArray(response.data) ? response.data : [];
}

async function openAssignDeliveryModal(orderId) {
    try {
        deliveryPersonnelCache = await loadDeliveryPersonnel();

        const select = document.getElementById('assignDeliveryId');
        const orderIdInput = document.getElementById('assignOrderId');
        if (!select || !orderIdInput) {
            alert('Assign delivery form is not available');
            return;
        }

        if (deliveryPersonnelCache.length === 0) {
            alert('No delivery personnel available. Create a user with delivery role first.');
            return;
        }

        select.innerHTML = `
            <option value="">Select delivery person</option>
            ${deliveryPersonnelCache.map((person) => `
                <option value="${person.id}">${person.name} (${person.email})</option>
            `).join('')}
        `;

        orderIdInput.value = String(orderId);
        document.getElementById('assignDeliveryModal').style.display = 'block';
    } catch (error) {
        alert('Failed to load delivery personnel: ' + error.message);
    }
}

// Form Submissions
document.addEventListener('DOMContentLoaded', () => {
    const addUserForm = document.getElementById('addUserForm');
    if (addUserForm) {
        addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const userData = {
                name: formData.get('name'),
                email: formData.get('email'),
                password: formData.get('password'),
                role: formData.get('role')
            };
            
            try {
                const response = await api.createUser(userData);
                if (response.success) {
                    alert('User created successfully');
                    closeModal('addUserModal');
                    e.target.reset();
                    loadUsers();
                }
            } catch (error) {
                alert('Failed to create user: ' + error.message);
            }
        });
    }

    const addProductForm = document.getElementById('addProductForm');
    if (addProductForm) {
        addProductForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const productData = {
                name: formData.get('name'),
                price: parseFloat(formData.get('price')),
                image: formData.get('image'),
                available: formData.get('available') === 'on'
            };
            
            try {
                const response = await api.createProduct(productData);
                if (response.success) {
                    alert('Product created successfully');
                    closeModal('addProductModal');
                    e.target.reset();
                    loadAllProducts();
                }
            } catch (error) {
                alert('Failed to create product: ' + error.message);
            }
        });
    }

    const assignDeliveryForm = document.getElementById('assignDeliveryForm');
    if (assignDeliveryForm) {
        assignDeliveryForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData(assignDeliveryForm);
            const orderId = formData.get('orderId');
            const deliveryId = formData.get('deliveryId');

            if (!orderId || !deliveryId) {
                alert('Please select a delivery person');
                return;
            }

            await assignDelivery(orderId, deliveryId);
            closeModal('assignDeliveryModal');
            assignDeliveryForm.reset();
        });
    }
});

// Checkout function
function checkout() {
    cart.checkout();
}

function clearCart() {
    if (confirm('Are you sure you want to clear your cart?')) {
        cart.clearCart();
    }
}

// Make functions globally available
window.showTab = showTab;
window.showManagerTab = showManagerTab;
window.showAddUserModal = showAddUserModal;
window.showAddProductModal = showAddProductModal;
window.showPaymentModal = showPaymentModal;
window.closeModal = closeModal;
window.updateUserRole = updateUserRole;
window.deleteUser = deleteUser;
window.updateOrderStatus = updateOrderStatus;
window.markOrderAsRead = markOrderAsRead;
window.toggleProductAvailability = toggleProductAvailability;
window.deleteProduct = deleteProduct;
window.markAsDelivered = markAsDelivered;
window.showAssignModal = showAssignModal;
window.assignDelivery = assignDelivery;
window.checkout = checkout;
window.clearCart = clearCart;
