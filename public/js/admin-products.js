let productsCache = [];
const formatKsh = (amount) => `KSh ${Number(amount || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
})}`;

document.addEventListener('DOMContentLoaded', async () => {
    if (!auth.requireAuth()) return;
    if (!auth.requireRole('admin')) return;

    await loadProducts();

    const addProductForm = document.getElementById('addProductForm');
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createProduct(addProductForm);
    });

    // Add image preview handler for add product
    const productImageInput = document.getElementById('productImage');
    productImageInput.addEventListener('change', (e) => {
        handleImagePreview(e, 'imagePreview', 'previewImg');
    });

    const editProductForm = document.getElementById('editProductForm');
    editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateProduct(editProductForm);
    });

    // Add image preview handler for edit product
    const editProductImageInput = document.getElementById('editProductImage');
    editProductImageInput.addEventListener('change', (e) => {
        handleImagePreview(e, 'editImagePreview', 'editPreviewImg');
    });

    const editProductSelect = document.getElementById('editProductSelect');
    editProductSelect.addEventListener('change', () => {
        populateEditForm(editProductSelect.value);
    });

    const deleteSelectedProductBtn = document.getElementById('deleteSelectedProductBtn');
    deleteSelectedProductBtn.addEventListener('click', async () => {
        await deleteSelectedProduct();
    });
});

async function loadProducts() {
    try {
        const response = await api.getProducts();
        const products = Array.isArray(response.data) ? response.data : [];
        productsCache = products;

        const container = document.getElementById('products-list');
        if (products.length === 0) {
            container.innerHTML = '<p>No products found.</p>';
            populateEditProductOptions();
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Image</th>
                        <th>Name</th>
                        <th>Price</th>
                        <th>Available</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map((product) => `
                        <tr>
                            <td>${product.image && product.image.startsWith('/') ? '<img src="' + product.image + '" style="max-width: 50px; max-height: 50px;"/>' : (product.image || '🍔')}</td>
                            <td>${product.name}</td>
                            <td>${formatKsh(product.price)}</td>
                            <td>${product.available ? 'Yes' : 'No'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        populateEditProductOptions();
    } catch (error) {
        showToast(`Failed to load products: ${error.message}`, 'error');
    }
}

function populateEditProductOptions(selectedProductId) {
    const select = document.getElementById('editProductSelect');
    if (!select) return;

    if (productsCache.length === 0) {
        select.innerHTML = '';
        return;
    }

    const preferredId = selectedProductId ? Number(selectedProductId) : Number(productsCache[0].id);

    select.innerHTML = productsCache.map((product) => `
        <option value="${product.id}" ${Number(product.id) === preferredId ? 'selected' : ''}>
            #${product.id} - ${product.name}
        </option>
    `).join('');

    populateEditForm(preferredId);
}

function populateEditForm(productId) {
    const product = productsCache.find((item) => Number(item.id) === Number(productId));
    if (!product) return;

    document.getElementById('editProductName').value = product.name || '';
    document.getElementById('editProductPrice').value = String(Math.round(Number(product.price)));
    document.getElementById('editProductAvailable').checked = Boolean(product.available);
    
    // Clear file input and show current image if available
    document.getElementById('editProductImage').value = '';
    const previewDiv = document.getElementById('editImagePreview');
    const previewImg = document.getElementById('editPreviewImg');
    
    if (product.image && product.image.startsWith('/images/')) {
        previewImg.src = product.image;
        previewDiv.style.display = 'block';
    } else {
        previewDiv.style.display = 'none';
    }
}

async function createProduct(addProductForm) {
    const formData = new FormData(addProductForm);
    const productData = {
        name: String(formData.get('name') || '').trim(),
        price: Number(formData.get('price')),
        available: formData.get('available') === 'on'
    };

    // Validate required fields
    if (!productData.name) {
        showToast('Please enter a product name.', 'error');
        return;
    }
    if (!productData.price || productData.price <= 0) {
        showToast('Please enter a valid price.', 'error');
        return;
    }

    try {
        // Use FormData for file upload
        const submitData = new FormData();
        submitData.append('name', productData.name);
        submitData.append('price', productData.price);
        submitData.append('available', productData.available ? 1 : 0);
        
        const imageFile = formData.get('image');
        if (imageFile && imageFile.size > 0) {
            submitData.append('image', imageFile);
        }

        const response = await api.createProduct(submitData);
        if (response.success) {
            showToast('Menu item added successfully.', 'success');
            closeModal('addProductModal');
            addProductForm.reset();
            document.getElementById('imagePreview').style.display = 'none';
            await loadProducts();
        }
    } catch (error) {
        showToast(`Failed to create product: ${error.message}`, 'error');
    }
}

function showEditProductModal() {
    if (productsCache.length === 0) {
        showToast('No products available yet. Please add one first.', 'info');
        return;
    }

    populateEditProductOptions();
    document.getElementById('editProductModal').style.display = 'block';
}

async function updateProduct(editProductForm) {
    const formData = new FormData(editProductForm);
    const productId = formData.get('id');
    const productData = {
        name: String(formData.get('name') || '').trim(),
        price: Number(formData.get('price')),
        available: formData.get('available') === 'on'
    };

    // Validate required fields
    if (!productData.name) {
        showToast('Please enter a product name.', 'error');
        return;
    }
    if (!productData.price || productData.price <= 0) {
        showToast('Please enter a valid price.', 'error');
        return;
    }

    try {
        // Use FormData for file upload
        const submitData = new FormData();
        submitData.append('name', productData.name);
        submitData.append('price', productData.price);
        submitData.append('available', productData.available ? 1 : 0);
        
        const imageFile = formData.get('image');
        if (imageFile && imageFile.size > 0) {
            submitData.append('image', imageFile);
        }

        const response = await api.updateProduct(productId, submitData);
        if (response.success) {
            showToast('Menu item updated successfully.', 'success');
            closeModal('editProductModal');
            await loadProducts();
        }
    } catch (error) {
        showToast(`Failed to update product: ${error.message}`, 'error');
    }
}

async function deleteSelectedProduct() {
    const select = document.getElementById('editProductSelect');
    const productId = select?.value;
    if (!productId) {
        showToast('Please select a product to edit.', 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        const response = await api.deleteProduct(productId);
        if (response.success) {
            showToast('Product removed successfully.', 'success');
            closeModal('editProductModal');
            await loadProducts();
        }
    } catch (error) {
        showToast(`Failed to delete product: ${error.message}`, 'error');
    }
}

function showAddProductModal() {
    document.getElementById('addProductModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function handleImagePreview(event, previewDivId, previewImgId) {
    const file = event.target.files[0];
    const previewDiv = document.getElementById(previewDivId);
    const previewImg = document.getElementById(previewImgId);

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewDiv.style.display = 'block';
        };
        reader.readAsDataURL(file);
    } else {
        previewDiv.style.display = 'none';
    }
}

window.showAddProductModal = showAddProductModal;
window.showEditProductModal = showEditProductModal;
window.closeModal = closeModal;
