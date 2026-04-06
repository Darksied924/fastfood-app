const ROLE_ORDER = ['admin', 'manager', 'delivery', 'customer'];
const ROLE_LABELS = {
    admin: 'Admin',
    manager: 'Manager',
    delivery: 'Delivery',
    customer: 'Customer'
};
const STAFF_ROLES = ['admin', 'manager', 'delivery'];

let allUsers = [];
let selectedUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;
    if (!auth.requireRole('admin')) return;

    await loadUsers();

    const addUserForm = document.getElementById('addUserForm');
    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(addUserForm);
        const userData = {
            name: formData.get('name'),
            email: formData.get('email'),
            password: formData.get('password'),
            role: formData.get('role')
        };

        try {
            const response = await api.createUser(userData);
            if (response.success) {
                showToast('User created successfully', 'success');
                closeModal('addUserModal');
                addUserForm.reset();
                await loadUsers();
            }
        } catch (error) {
            showToast(`Failed to create user: ${error.message}`, 'error');
        }
    });
});

async function loadUsers() {
    try {
        const response = await api.getAllUsers();
        allUsers = response.data;
        const container = document.getElementById('users-list');
        const summaryContainer = document.getElementById('users-summary');

        if (!Array.isArray(allUsers) || allUsers.length === 0) {
            if (summaryContainer) {
                summaryContainer.innerHTML = '';
            }
            container.innerHTML = '<div class="empty-users">No users found.</div>';
            return;
        }

        const groupedUsers = groupUsersByRole(allUsers);
        const unknownRoles = Object.keys(groupedUsers).filter((role) => !ROLE_ORDER.includes(role));
        const orderedRoles = [...ROLE_ORDER, ...unknownRoles];
        const totalUsers = allUsers.length;

        if (summaryContainer) {
            summaryContainer.innerHTML = renderUsersSummary(groupedUsers, totalUsers);
        }

        container.innerHTML = orderedRoles
            .filter((role) => groupedUsers[role] && groupedUsers[role].length > 0)
            .map((role) => renderRoleSection(role, groupedUsers[role], totalUsers))
            .join('');
    } catch (error) {
        const container = document.getElementById('users-list');
        const summaryContainer = document.getElementById('users-summary');

        if (summaryContainer) {
            summaryContainer.innerHTML = '';
        }
        if (container) {
            container.innerHTML = '<div class="error-message">Failed to load users. Please try again.</div>';
        }
        showToast(`Failed to load users: ${error.message}`, 'error');
    }
}

function groupUsersByRole(users) {
    return users.reduce((groups, user) => {
        const role = user.role || 'unknown';
        if (!groups[role]) {
            groups[role] = [];
        }
        groups[role].push(user);
        return groups;
    }, {});
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function pluralizeRole(role, count) {
    const label = ROLE_LABELS[role] || role;
    if (count === 1) {
        return label;
    }
    return role === 'delivery' ? 'Delivery Staff' : `${label}s`;
}

function getLatestUser(users) {
    return [...users]
        .filter((user) => user && user.created_at)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
}

function renderUsersSummary(groupedUsers, totalUsers) {
    const staffCount = allUsers.filter((user) => STAFF_ROLES.includes(user.role)).length;
    const customerCount = allUsers.filter((user) => user.role === 'customer').length;
    const newestUser = getLatestUser(allUsers);
    const adminCount = (groupedUsers.admin || []).length;

    const summaryCards = [
        {
            label: 'Total Accounts',
            value: totalUsers,
            detail: `${Object.keys(groupedUsers).length} active role groups`,
            tone: 'primary'
        },
        {
            label: 'Staff Accounts',
            value: staffCount,
            detail: `${adminCount} admin${adminCount === 1 ? '' : 's'} included`,
            tone: 'accent'
        },
        {
            label: 'Customer Accounts',
            value: customerCount,
            detail: `${Math.round((customerCount / totalUsers) * 100) || 0}% of all users`,
            tone: 'success'
        },
        {
            label: 'Latest Registration',
            value: newestUser ? newestUser.name : 'N/A',
            detail: newestUser ? formatDateTime(newestUser.created_at) : 'No registrations yet',
            tone: 'neutral'
        }
    ];

    return summaryCards.map((card) => `
        <article class="users-summary-card users-summary-card--${card.tone}">
            <span class="users-summary-label">${card.label}</span>
            <strong class="users-summary-value">${card.value}</strong>
            <span class="users-summary-detail">${card.detail}</span>
        </article>
    `).join('');
}

function renderRoleSection(role, users, totalUsers) {
    const roleLabel = ROLE_LABELS[role] || role;
    const roleShare = Math.round((users.length / totalUsers) * 100) || 0;

    return `
        <section class="role-user-section role-user-section--${role}">
            <div class="role-user-section-header">
                <div class="role-user-section-copy">
                    <span class="role-section-kicker">Role group</span>
                    <h4>${pluralizeRole(role, users.length)}</h4>
                    <p>${users.length} account${users.length === 1 ? '' : 's'} in this group, representing ${roleShare}% of the directory.</p>
                </div>
                <span class="role-count">${users.length}</span>
            </div>
            <div class="role-user-table-wrap">
                <table class="role-user-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Date Registered</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map((user) => renderUserRow(user)).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderUserRow(user) {
    return `
        <tr class="role-user-row">
            <td data-label="ID">#${user.id}</td>
            <td data-label="Name">
                <div class="user-row-primary">
                    <span class="user-row-name">${user.name}</span>
                    <span class="role-badge role-${user.role}">${ROLE_LABELS[user.role] || user.role}</span>
                </div>
            </td>
            <td data-label="Email"><span class="user-row-email">${user.email}</span></td>
            <td data-label="Date Registered">${formatDate(user.created_at)}</td>
        </tr>
    `;
}

// Edit Users Modal Functions
function showEditUsersModal() {
    renderRoleGroupSelector();
    document.getElementById('editUsersModal').style.display = 'block';
}

function renderRoleGroupSelector() {
    const groupedUsers = groupUsersByRole(allUsers);
    const container = document.getElementById('roleGroupSelector');
    
    const unknownRoles = Object.keys(groupedUsers).filter((role) => !ROLE_ORDER.includes(role));
    const orderedRoles = [...ROLE_ORDER, ...unknownRoles];

    container.innerHTML = orderedRoles
        .filter((role) => groupedUsers[role] && groupedUsers[role].length > 0)
        .map((role) => {
            const roleLabel = ROLE_LABELS[role] || role;
            const users = groupedUsers[role];
            
            return `
                <div class="role-group-card">
                    <div class="role-group-header">
                        <h4>${roleLabel}</h4>
                        <span class="role-count">${users.length}</span>
                    </div>
                    <div class="role-group-users">
                        ${users.map((user) => `
                            <button class="user-select-btn" onclick="selectUserForEdit(${user.id})">
                                <span class="user-select-name">${user.name}</span>
                                <span class="user-select-email">${user.email}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
}

function selectUserForEdit(userId) {
    selectedUser = allUsers.find(u => u.id === userId);
    if (!selectedUser) {
        alert('User not found');
        return;
    }
    
    // Close edit users modal and open user actions modal
    closeModal('editUsersModal');
    showUserActionsModal();
}

function showUserActionsModal() {
    if (!selectedUser) {
        alert('Please select a user first');
        return;
    }
    
    const container = document.getElementById('selectedUserInfo');
    const roleSelect = document.getElementById('editUserRole');
    
    // Set current role in dropdown
    roleSelect.value = selectedUser.role;
    
    // Render selected user info
    container.innerHTML = `
        <div class="user-info-card">
            <div class="user-avatar-large">
                ${selectedUser.name.charAt(0).toUpperCase()}
            </div>
            <div class="user-details">
                <h4>${selectedUser.name}</h4>
                <p>${selectedUser.email}</p>
                <span class="role-badge role-${selectedUser.role}">${ROLE_LABELS[selectedUser.role] || selectedUser.role}</span>
                <p class="date-registered">Registered: ${formatDate(selectedUser.created_at)}</p>
            </div>
        </div>
    `;
    
    document.getElementById('userActionsModal').style.display = 'block';
}

async function updateUserRoleFromModal() {
    if (!selectedUser) return;
    
    const newRole = document.getElementById('editUserRole').value;
    
    try {
        const response = await api.updateUserRole(selectedUser.id, newRole);
        if (response.success) {
            showToast('User role updated successfully', 'success');
            closeModal('userActionsModal');
            selectedUser = null;
            await loadUsers();
        }
    } catch (error) {
        showToast(`Failed to update user role: ${error.message}`, 'error');
    }
}

async function deleteUserFromModal() {
    showDeleteConfirmModal();
}

function showDeleteConfirmModal() {
    if (!selectedUser) return;
    
    const messageEl = document.getElementById('deleteConfirmMessage');
    messageEl.innerHTML = `Are you sure you want to delete user <strong>"${selectedUser.name}"</strong>?<br><span class="warning-text">This action cannot be undone.</span>`;
    
    document.getElementById('deleteConfirmModal').style.display = 'block';
}

async function confirmDeleteUser() {
    if (!selectedUser) return;
    
    try {
        const response = await api.deleteUser(selectedUser.id);
        if (response.success) {
            showToast('User deleted successfully', 'success');
            closeModal('deleteConfirmModal');
            closeModal('userActionsModal');
            selectedUser = null;
            await loadUsers();
        }
    } catch (error) {
        showToast(`Failed to delete user: ${error.message}`, 'error');
    }
}

function showAddUserModal() {
    document.getElementById('addUserModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Toast Notification System
function showToast(message, type = 'success') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    
    // Add toast to body
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};

// Make functions globally available
window.showEditUsersModal = showEditUsersModal;
window.showAddUserModal = showAddUserModal;
window.closeModal = closeModal;
window.selectUserForEdit = selectUserForEdit;
window.updateUserRoleFromModal = updateUserRoleFromModal;
window.deleteUserFromModal = deleteUserFromModal;
window.showDeleteConfirmModal = showDeleteConfirmModal;
window.confirmDeleteUser = confirmDeleteUser;
