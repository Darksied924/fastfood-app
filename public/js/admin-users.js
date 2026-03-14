const ROLE_ORDER = ['admin', 'manager', 'delivery', 'customer'];
const ROLE_LABELS = {
    admin: 'Admin',
    manager: 'Manager',
    delivery: 'Delivery',
    customer: 'Customer'
};

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

        if (!Array.isArray(allUsers) || allUsers.length === 0) {
            container.innerHTML = '<p>No users found.</p>';
            return;
        }

        const groupedUsers = groupUsersByRole(allUsers);
        const unknownRoles = Object.keys(groupedUsers).filter((role) => !ROLE_ORDER.includes(role));
        const orderedRoles = [...ROLE_ORDER, ...unknownRoles];

        container.innerHTML = orderedRoles
            .filter((role) => groupedUsers[role] && groupedUsers[role].length > 0)
            .map((role) => renderRoleSection(role, groupedUsers[role]))
            .join('');
    } catch (error) {
        alert(`Failed to load users: ${error.message}`);
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

function renderRoleSection(role, users) {
    const roleLabel = ROLE_LABELS[role] || role;

    return `
        <section class="role-user-section">
            <div class="role-user-section-header">
                <h4>${roleLabel}</h4>
                <span class="role-count">${users.length}</span>
            </div>
            <table>
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
        </section>
    `;
}

function renderUserRow(user) {
    return `
        <tr>
            <td>${user.id}</td>
            <td>${user.name}</td>
            <td>${user.email}</td>
            <td>${formatDate(user.created_at)}</td>
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

