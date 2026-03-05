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

    const editProductForm = document.getElementById('editProductForm');
    editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateProduct(editProductForm);
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
                            <td>${product.image || '🍔'}</td>
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
        alert(`Failed to load products: ${error.message}`);
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
    document.getElementById('editProductImage').value = product.image || '🍔';
    document.getElementById('editProductAvailable').checked = Boolean(product.available);
}

async function createProduct(addProductForm) {
    const formData = new FormData(addProductForm);
    const productData = {
        name: String(formData.get('name') || '').trim(),
        price: Number(formData.get('price')),
        image: String(formData.get('image') || '').trim() || '🍔',
        available: formData.get('available') === 'on'
    };

    try {
        const response = await api.createProduct(productData);
        if (response.success) {
            alert('Product created successfully');
            closeModal('addProductModal');
            addProductForm.reset();
            document.getElementById('productImage').value = '🍔';
            await loadProducts();
        }
    } catch (error) {
        alert(`Failed to create product: ${error.message}`);
    }
}

function showEditProductModal() {
    if (productsCache.length === 0) {
        alert('No products available');
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
        image: String(formData.get('image') || '').trim() || '🍔',
        available: formData.get('available') === 'on'
    };

    try {
        const response = await api.updateProduct(productId, productData);
        if (response.success) {
            alert('Product updated successfully');
            closeModal('editProductModal');
            await loadProducts();
        }
    } catch (error) {
        alert(`Failed to update product: ${error.message}`);
    }
}
async function deleteSelectedProduct() {
    const select = document.getElementById('editProductSelect');
    const productId = select?.value;
    if (!productId) {
        alert('Please select a product');
        return;
    }

    if (!confirm('Are you sure you want to delete this product?')) return;

    try {
        const response = await api.deleteProduct(productId);
        if (response.success) {
            alert('Product deleted successfully');
            closeModal('editProductModal');
            await loadProducts();
        }
    } catch (error) {
        alert(`Failed to delete product: ${error.message}`);
    }
}

function showAddProductModal() {
    document.getElementById('addProductModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

window.showAddProductModal = showAddProductModal;
window.showEditProductModal = showEditProductModal;
window.closeModal = closeModal;
