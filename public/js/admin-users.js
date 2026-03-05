const ROLE_ORDER = ['admin', 'manager', 'delivery', 'customer'];
const ROLE_LABELS = {
    admin: 'Admin',
    manager: 'Manager',
    delivery: 'Delivery',
    customer: 'Customer'
};

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
                alert('User created successfully');
                closeModal('addUserModal');
                addUserForm.reset();
                await loadUsers();
            }
        } catch (error) {
            alert(`Failed to create user: ${error.message}`);
        }
    });
});

async function loadUsers() {
    try {
        const response = await api.getAllUsers();
        const users = response.data;
        const container = document.getElementById('users-list');

        if (!Array.isArray(users) || users.length === 0) {
            container.innerHTML = '<p>No users found.</p>';
            return;
        }

        const groupedUsers = groupUsersByRole(users);
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
                        <th>Role</th>
                        <th>Actions</th>
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
    `;
}

async function updateUserRole(userId, role) {
    try {
        const response = await api.updateUserRole(userId, role);
        if (response.success) {
            alert('User role updated successfully');
            await loadUsers();
        }
    } catch (error) {
        alert(`Failed to update user role: ${error.message}`);
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
        const response = await api.deleteUser(userId);
        if (response.success) {
            alert('User deleted successfully');
            await loadUsers();
        }
    } catch (error) {
        alert(`Failed to delete user: ${error.message}`);
    }
}

function showAddUserModal() {
    document.getElementById('addUserModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

window.updateUserRole = updateUserRole;
window.deleteUser = deleteUser;
window.showAddUserModal = showAddUserModal;
window.closeModal = closeModal;
