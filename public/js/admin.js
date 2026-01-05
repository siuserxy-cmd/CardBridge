const API_BASE = window.location.origin + '/api';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await checkAdminAuth();
    loadStats();
    loadProducts();
    loadOrders();
    setupEventListeners();
});

// 事件监听器
function setupEventListeners() {
    document.getElementById('addProductForm').addEventListener('submit', handleAddProduct);
    document.getElementById('addCardsForm').addEventListener('submit', handleAddCards);
}

// 检查管理员权限
async function checkAdminAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('请先登录');
        window.location.href = '/';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error('未登录');
        }

        const user = await response.json();
        if (!user.isAdmin) {
            alert('需要管理员权限');
            window.location.href = '/';
            return;
        }

        document.getElementById('adminEmail').textContent = user.email;
    } catch (error) {
        alert('认证失败，请重新登录');
        localStorage.removeItem('token');
        window.location.href = '/';
    }
}

// 加载统计数据
async function loadStats() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const stats = await response.json();

        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card">
                <div class="stat-label">总订单数</div>
                <div class="stat-value">${stats.totalOrders}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">今日订单</div>
                <div class="stat-value">${stats.todayOrders}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">总销售额</div>
                <div class="stat-value">¥${stats.totalRevenue.toFixed(2)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">今日销售额</div>
                <div class="stat-value">¥${stats.todayRevenue.toFixed(2)}</div>
            </div>
        `;
    } catch (error) {
        console.error('加载统计数据失败:', error);
    }
}

// 加载商品列表
async function loadProducts() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const products = await response.json();

        const tbody = document.querySelector('#productsTable tbody');
        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">暂无商品</td></tr>';
            return;
        }

        tbody.innerHTML = products.map(p => `
            <tr>
                <td>${p.id}</td>
                <td>${escapeHtml(p.name)}</td>
                <td>¥${p.price.toFixed(2)}</td>
                <td>${p.stock}</td>
                <td><span class="badge ${p.status === 'in_stock' ? 'badge-success' : 'badge-danger'}">${p.status === 'in_stock' ? '有货' : '售罄'}</span></td>
                <td>
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;" onclick="openAddCardsModal(${p.id})">添加卡密</button>
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem; background: #dc2626;" onclick="deleteProduct(${p.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载商品列表失败:', error);
    }
}

// 加载订单列表
async function loadOrders() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const orders = await response.json();

        const tbody = document.querySelector('#ordersTable tbody');
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">暂无订单</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(o => `
            <tr>
                <td>${o.id}</td>
                <td>${escapeHtml(o.email)}</td>
                <td>${escapeHtml(o.product_name)}</td>
                <td>¥${o.amount.toFixed(2)}</td>
                <td>${o.payment_method === 'alipay' ? '支付宝' : '微信'}</td>
                <td><span class="badge ${o.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}">${o.payment_status === 'paid' ? '已支付' : '待支付'}</span></td>
                <td>${new Date(o.created_at).toLocaleString()}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载订单列表失败:', error);
    }
}

// 添加商品
function openAddProductModal() {
    document.getElementById('addProductModal').classList.add('active');
}

function closeAddProductModal() {
    document.getElementById('addProductModal').classList.remove('active');
    document.getElementById('addProductForm').reset();
}

async function handleAddProduct(e) {
    e.preventDefault();

    const name = document.getElementById('productName').value;
    const description = document.getElementById('productDescription').value;
    const price = parseFloat(document.getElementById('productPrice').value);

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, description, price })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '添加失败');
            return;
        }

        alert('商品添加成功！');
        closeAddProductModal();
        loadProducts();
        loadStats();
    } catch (error) {
        console.error('添加商品失败:', error);
        alert('添加失败，请稍后重试');
    }
}

// 删除商品
async function deleteProduct(id) {
    if (!confirm('确定要删除这个商品吗？')) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/products/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json();
            alert(data.error || '删除失败');
            return;
        }

        alert('商品已删除');
        loadProducts();
    } catch (error) {
        console.error('删除商品失败:', error);
        alert('删除失败，请稍后重试');
    }
}

// 添加卡密
function openAddCardsModal(productId) {
    document.getElementById('cardsProductId').value = productId;
    document.getElementById('addCardsModal').classList.add('active');
}

function closeAddCardsModal() {
    document.getElementById('addCardsModal').classList.remove('active');
    document.getElementById('addCardsForm').reset();
}

async function handleAddCards(e) {
    e.preventDefault();

    const productId = document.getElementById('cardsProductId').value;
    const cardsText = document.getElementById('cardsText').value;

    // 解析卡密
    const lines = cardsText.split('\n').filter(line => line.trim());
    const cards = lines.map(line => {
        const parts = line.trim().split('|');
        return {
            number: parts[0],
            password: parts[1] || ''
        };
    });

    if (cards.length === 0) {
        alert('请输入卡密');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ productId, cards })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '添加失败');
            return;
        }

        alert(`成功添加 ${data.successCount} 张卡密！`);
        closeAddCardsModal();
        loadProducts();
        loadStats();
    } catch (error) {
        console.error('添加卡密失败:', error);
        alert('添加失败，请稍后重试');
    }
}

// 工具函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
