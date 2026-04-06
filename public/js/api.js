const API_BASE = '/api';

const api = {
    // Helper to get auth headers
    getHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        };
    },

    // Handle response
    async handleResponse(response) {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Something went wrong');
        }
        return data;
    },

    // Auth endpoints
    async login(email, password) {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        return this.handleResponse(response);
    },

    async getGoogleAuthConfig() {
        const response = await fetch(`${API_BASE}/auth/google/config`, {
            headers: { 'Content-Type': 'application/json' }
        });
        return this.handleResponse(response);
    },

    async googleLogin(credential) {
        const response = await fetch(`${API_BASE}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential })
        });
        return this.handleResponse(response);
    },

    async getFacebookAuthConfig() {
        const response = await fetch(`${API_BASE}/auth/facebook/config`, {
            headers: { 'Content-Type': 'application/json' }
        });
        return this.handleResponse(response);
    },

    async facebookLogin(accessToken) {
        const response = await fetch(`${API_BASE}/auth/facebook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken })
        });
        return this.handleResponse(response);
    },

    async register(userData) {
        const response = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        return this.handleResponse(response);
    },

    async forgotPassword(email) {
        const response = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        return this.handleResponse(response);
    },

    async resetPassword(token, password) {
        const response = await fetch(`${API_BASE}/auth/reset-password/${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return this.handleResponse(response);
    },

    async getCurrentUser() {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async updateProfile(profileData) {
        const response = await fetch(`${API_BASE}/auth/profile`, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify(profileData)
        });
        return this.handleResponse(response);
    },

    // Product endpoints
    async getProducts(availableOnly = false) {
        const url = availableOnly ? `${API_BASE}/products?available=true` : `${API_BASE}/products`;
        const response = await fetch(url, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async createProduct(productData) {
        const response = await fetch(`${API_BASE}/products`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(productData)
        });
        return this.handleResponse(response);
    },

    async updateProduct(id, productData) {
        const response = await fetch(`${API_BASE}/products/${id}`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify(productData)
        });
        return this.handleResponse(response);
    },

    async deleteProduct(id) {
        const response = await fetch(`${API_BASE}/products/${id}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async toggleProductAvailability(id) {
        const response = await fetch(`${API_BASE}/products/${id}/toggle-availability`, {
            method: 'PATCH',
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    // Order endpoints
    async createOrder(orderData) {
        const response = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(orderData)
        });
        return this.handleResponse(response);
    },

    async getMyOrders() {
        const response = await fetch(`${API_BASE}/orders/my-orders`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async cancelOrder(orderId, reason) {
        const response = await fetch(`${API_BASE}/orders/${orderId}/cancel`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ reason })
        });
        return this.handleResponse(response);
    },

    async getAllOrders(status = '') {
        const url = status ? `${API_BASE}/orders?status=${status}` : `${API_BASE}/orders`;
        const response = await fetch(url, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async getCancelledOrders() {
        const response = await fetch(`${API_BASE}/orders/cancelled`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async getCancellationRequests() {
        const response = await fetch(`${API_BASE}/orders/cancellations`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async adminOverrideCancel(orderId, reason = '') {
        const response = await fetch(`${API_BASE}/orders/${orderId}/override-cancel`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ reason })
        });
        return this.handleResponse(response);
    },

    async reviewRefundRequest(refundId, decision, notes = '') {
        const response = await fetch(`${API_BASE}/orders/refunds/${refundId}/review`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify({ decision, notes })
        });
        return this.handleResponse(response);
    },

    async getAssignedOrders() {
        const response = await fetch(`${API_BASE}/orders/delivery/assigned`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async getDeliveryDashboard(filters = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.set(key, value);
            }
        });

        const queryString = searchParams.toString();
        const url = queryString
            ? `${API_BASE}/orders/delivery/dashboard?${queryString}`
            : `${API_BASE}/orders/delivery/dashboard`;
        const response = await fetch(url, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async updateOrderStatus(orderId, status) {
        const response = await fetch(`${API_BASE}/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify({ status })
        });
        return this.handleResponse(response);
    },

    async assignDelivery(orderId, deliveryId) {
        const response = await fetch(`${API_BASE}/orders/${orderId}/assign`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ deliveryId })
        });
        return this.handleResponse(response);
    },

    async getDeliveryPersonnel() {
        const response = await fetch(`${API_BASE}/orders/delivery-personnel`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async markAsDelivered(orderId) {
        const response = await fetch(`${API_BASE}/orders/${orderId}/delivered`, {
            method: 'PATCH',
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async getAnalytics(filters = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.set(key, value);
            }
        });

        const queryString = searchParams.toString();
        const url = queryString ? `${API_BASE}/orders/analytics?${queryString}` : `${API_BASE}/orders/analytics`;
        const response = await fetch(url, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async exportAnalyticsCsv(filters = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                searchParams.set(key, value);
            }
        });

        const queryString = searchParams.toString();
        const url = queryString ? `${API_BASE}/orders/analytics/export?${queryString}` : `${API_BASE}/orders/analytics/export`;
        const response = await fetch(url, {
            headers: this.getHeaders()
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Failed to export analytics CSV');
        }

        return response.blob();
    },

    // User endpoints (admin only)
    async getAllUsers() {
        const response = await fetch(`${API_BASE}/users`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async createUser(userData) {
        const response = await fetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(userData)
        });
        return this.handleResponse(response);
    },

    async updateUser(id, userData) {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify(userData)
        });
        return this.handleResponse(response);
    },

    async deleteUser(id) {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },

    async updateUserRole(id, role) {
        const response = await fetch(`${API_BASE}/users/${id}/role`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify({ role })
        });
        return this.handleResponse(response);
    },

    // Payment endpoints
    async initiateSTKPush(orderId, phone) {
        const response = await fetch(`${API_BASE}/payments/stk-push`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ orderId, phone })
        });
        return this.handleResponse(response);
    },

    async queryPaymentStatus(checkoutRequestId) {
        const response = await fetch(`${API_BASE}/payments/status/${checkoutRequestId}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    }
};
