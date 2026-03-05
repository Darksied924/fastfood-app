// Auth utilities
const auth = {
    // Check if user is logged in
    isAuthenticated() {
        return !!localStorage.getItem('token');
    },

    // Get current user
    getCurrentUser() {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    },

    // Get auth token
    getToken() {
        return localStorage.getItem('token');
    },

    // Set user data after login
    setUserData(userData) {
        localStorage.setItem('token', userData.token);
        localStorage.setItem('user', JSON.stringify({
            id: userData.id,
            name: userData.name,
            email: userData.email,
            phone: userData.phone || null,
            role: userData.role
        }));
    },

    // Update local user details without touching token
    updateCurrentUser(userData) {
        const existingUser = this.getCurrentUser();
        if (!existingUser) return;

        localStorage.setItem('user', JSON.stringify({
            ...existingUser,
            ...userData
        }));
    },

    // Logout
    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('cart'); // Clear cart on logout
        window.location.href = '/';
    },

    // Check if user has required role
    hasRole(requiredRole) {
        const user = this.getCurrentUser();
        if (!user) return false;
        
        if (Array.isArray(requiredRole)) {
            return requiredRole.includes(user.role);
        }
        return user.role === requiredRole;
    },

    // Redirect if not authenticated
    requireAuth(redirectTo = '/login') {
        if (!this.isAuthenticated()) {
            window.location.href = redirectTo;
            return false;
        }
        return true;
    },

    // Redirect if doesn't have required role
    requireRole(requiredRole, redirectTo = '/dashboard') {
        if (!this.hasRole(requiredRole)) {
            window.location.href = redirectTo;
            return false;
        }
        return true;
    }
};

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', () => {
    // Update navigation based on auth status
    updateNavigation();
});

function updateNavigation() {
    const navLinks = document.querySelector('.nav-links');
    const headerProfile = document.getElementById('headerProfile');
    if (!navLinks) return;

    const isAuth = auth.isAuthenticated();
    const user = auth.getCurrentUser();

    let links = '';
    
    if (isAuth) {
        if (user && user.role === 'customer') {
            links += '<a href="/customer/menu">Menu</a>';
            links += '<a href="/customer/cart">Cart</a>';
            links += '<a href="/customer/orders">My Orders</a>';
        } else if (user && user.role === 'delivery') {
            links += '<a href="/delivery/dashboard">Delivery Dashboard</a>';
        } else {
            links += '<a href="/dashboard">Dashboard</a>';
        }

        if (user && user.role === 'admin') {
            links += '<a href="/admin/users">Users</a>';
            links += '<a href="/admin/products">Products</a>';
            links += '<a href="/admin/orders">Orders</a>';
            links += '<a href="/admin/analytics">Analytics</a>';
        }
        links += '<a href="#" onclick="auth.logout()">Logout</a>';
    } else {
        links += '<a href="/login">Login</a>';
        links += '<a href="/register">Register</a>';
    }

    navLinks.innerHTML = links;

    if (headerProfile) {
        if (isAuth && user) {
            headerProfile.innerHTML = `
                <a href="/profile" class="header-profile-link" title="Open profile">
                    <img class="header-profile-avatar" src="${getNavProfileImage(user.id)}" alt="${user.name} profile image">
                </a>
            `;
        } else {
            headerProfile.innerHTML = '';
        }
    }
}

function getNavProfileImage(userId) {
    const stored = localStorage.getItem(`profile-image-${userId}`);

    if (stored) {
        return stored;
    }

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><rect width='64' height='64' fill='#ffffff'/><circle cx='32' cy='24' r='12' fill='#d0d7de'/><rect x='16' y='40' width='32' height='16' rx='8' fill='#d0d7de'/></svg>"
    )}`;
}
