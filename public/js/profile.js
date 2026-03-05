let currentUser = null;
let draftImageDataUrl = null;

const DEFAULT_AVATAR = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><rect width='160' height='160' fill='#f3f4f6'/><circle cx='80' cy='62' r='30' fill='#cfd8dc'/><rect x='42' y='100' width='76' height='36' rx='18' fill='#cfd8dc'/></svg>"
)}`;

const ui = {
    profileForm: null,
    profileName: null,
    profileEmail: null,
    profilePhone: null,
    profileRole: null,
    profileAvatarPreview: null,
    profileImage: null,
    profileImageLabel: null,
    editProfileBtn: null,
    saveProfileBtn: null,
    cancelEditBtn: null
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;

    bindElements();
    bindEvents();

    await loadProfile();
    setEditMode(false);
});

function bindElements() {
    ui.profileForm = document.getElementById('profileForm');
    ui.profileName = document.getElementById('profileName');
    ui.profileEmail = document.getElementById('profileEmail');
    ui.profilePhone = document.getElementById('profilePhone');
    ui.profileRole = document.getElementById('profileRole');
    ui.profileAvatarPreview = document.getElementById('profileAvatarPreview');
    ui.profileImage = document.getElementById('profileImage');
    ui.profileImageLabel = document.getElementById('profileImageLabel');
    ui.editProfileBtn = document.getElementById('editProfileBtn');
    ui.saveProfileBtn = document.getElementById('saveProfileBtn');
    ui.cancelEditBtn = document.getElementById('cancelEditBtn');
}

function bindEvents() {
    ui.profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await saveProfile();
    });

    ui.editProfileBtn.addEventListener('click', () => {
        setEditMode(true);
    });

    ui.cancelEditBtn.addEventListener('click', () => {
        resetFormToCurrentUser();
        draftImageDataUrl = null;
        loadStoredImage();
        setEditMode(false);
    });

    ui.profileImage.addEventListener('change', handleProfileImageUpload);
}

async function loadProfile() {
    try {
        const response = await api.getCurrentUser();
        currentUser = response.data;
        auth.updateCurrentUser(currentUser);

        resetFormToCurrentUser();
        ui.profileRole.textContent = (currentUser.role || 'USER').toUpperCase();
        loadStoredImage();
    } catch (error) {
        alert(`Failed to load profile: ${error.message}`);
    }
}

function resetFormToCurrentUser() {
    ui.profileName.value = currentUser?.name || '';
    ui.profileEmail.value = currentUser?.email || '';
    ui.profilePhone.value = currentUser?.phone || '';
}

function setEditMode(isEditing) {
    ui.profileName.disabled = !isEditing;
    ui.profileEmail.disabled = !isEditing;
    ui.profilePhone.disabled = !isEditing;

    ui.editProfileBtn.classList.toggle('profile-hidden', isEditing);
    ui.saveProfileBtn.classList.toggle('profile-hidden', !isEditing);
    ui.cancelEditBtn.classList.toggle('profile-hidden', !isEditing);
    ui.profileImageLabel.classList.toggle('profile-hidden', !isEditing);

    if (!isEditing) {
        ui.profileImage.value = '';
    }
}

function getProfileImageStorageKey() {
    return `profile-image-${currentUser?.id || 'current'}`;
}

function loadStoredImage() {
    const savedImage = localStorage.getItem(getProfileImageStorageKey());
    ui.profileAvatarPreview.src = savedImage || DEFAULT_AVATAR;
}

function handleProfileImageUpload(event) {
    const [file] = event.target.files;

    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please choose a valid image file.');
        ui.profileImage.value = '';
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        alert('Image must be 2MB or smaller.');
        ui.profileImage.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        draftImageDataUrl = reader.result;
        ui.profileAvatarPreview.src = draftImageDataUrl;
    };
    reader.readAsDataURL(file);
}

async function saveProfile() {
    const name = ui.profileName.value.trim();
    const email = ui.profileEmail.value.trim();
    const phone = ui.profilePhone.value.trim();

    const payload = {};

    if (name && name !== (currentUser?.name || '')) {
        payload.name = name;
    }

    if (email && email !== (currentUser?.email || '')) {
        payload.email = email;
    }

    if (phone && phone !== (currentUser?.phone || '')) {
        payload.phone = phone;
    }

    const hasProfileChanges = Object.keys(payload).length > 0;
    const hasImageChange = Boolean(draftImageDataUrl);

    try {
        if (hasProfileChanges) {
            const response = await api.updateProfile(payload);
            currentUser = response.data;
            auth.updateCurrentUser(currentUser);
            updateNavigation();
        }

        if (hasImageChange) {
            localStorage.setItem(getProfileImageStorageKey(), draftImageDataUrl);
            draftImageDataUrl = null;
            updateNavigation();
        }

        if (!hasProfileChanges && !hasImageChange) {
            alert('No changes to save.');
            setEditMode(false);
            return;
        }

        resetFormToCurrentUser();
        setEditMode(false);
        alert('Profile updated successfully');
    } catch (error) {
        alert(`Failed to update profile: ${error.message}`);
    }
}
