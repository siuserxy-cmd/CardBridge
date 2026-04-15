const API_BASE = window.location.origin + '/api';

// 分页状态
let orderPage = 1;
const orderPageSize = 50;
let orderStatusFilter = 'all';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await checkAdminAuth();
    setupEventListeners();
    await populateCDKProductSelect();
    loadStats();
    loadProducts();
    loadOrders();
    loadCDKList();
    loadBlockedEmails();
    loadReferralCodes();
    loadReferralRecords();
});

// 事件监听器
function setupEventListeners() {
    document.getElementById('addProductForm').addEventListener('submit', handleAddProduct);
    document.getElementById('addCardsForm').addEventListener('submit', handleAddCards);
    document.getElementById('editProductForm')?.addEventListener('submit', handleEditProduct);
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

        renderLowStock(stats.productStats || []);
    } catch (error) {
        console.error('加载统计数据失败:', error);
    }
}

// 低库存预警：商品库存 < LOW_STOCK_THRESHOLD 时在统计区下方展示
function renderLowStock(productStats) {
    const LOW_STOCK_THRESHOLD = 5;
    const low = productStats
        .filter(p => (p.stock || 0) < LOW_STOCK_THRESHOLD)
        .sort((a, b) => (a.stock || 0) - (b.stock || 0));

    let box = document.getElementById('lowStockBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'lowStockBox';
        box.style.cssText = 'margin:1rem 0 1.5rem;padding:1rem 1.25rem;border-radius:10px;border:1px solid rgba(255,133,127,0.28);background:rgba(255,133,127,0.06);';
        const grid = document.getElementById('statsGrid');
        grid.parentNode.insertBefore(box, grid.nextSibling);
    }

    if (low.length === 0) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';

    const escAttr = (s) => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
    const rows = low.map(p => {
        const soldOut = (p.stock || 0) === 0;
        const stockColor = soldOut ? '#ff857f' : '#ffd86a';
        const stockLabel = soldOut ? '已售罄' : `仅剩 ${p.stock}`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px dashed rgba(148,163,184,0.12);">
            <span style="color:#e2e8f0;font-size:0.85rem;">${escAttr(p.name)}</span>
            <span style="color:${stockColor};font-size:0.78rem;font-weight:700;">${stockLabel}</span>
        </div>`;
    }).join('');

    box.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">
            <span style="font-size:1rem;">⚠️</span>
            <span style="color:#ff857f;font-weight:700;font-size:0.9rem;">低库存预警</span>
            <span style="color:#94a3b8;font-size:0.74rem;">库存低于 ${LOW_STOCK_THRESHOLD} 的商品 (${low.length})</span>
        </div>
        ${rows}
    `;
}

// 全局商品缓存，给编辑按钮 lookup
let __productsCache = [];

// 加载商品列表
async function loadProducts() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const products = await response.json();
        __productsCache = products;

        const tbody = document.querySelector('#productsTable tbody');
        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">暂无商品</td></tr>';
            return;
        }

        tbody.innerHTML = products.map(p => {
            const deliveryLabel = p.delivery_type === 'auto_recharge'
                ? '<span class="badge" style="background:rgba(168,85,247,0.15);color:#a855f7;border-color:rgba(168,85,247,0.3);">自动充值</span>'
                : '<span class="badge" style="background:rgba(121,242,170,0.1);color:#79f2aa;border-color:rgba(121,242,170,0.2);">邮件发卡</span>';
            const featuredMark = p.is_featured
                ? '<span class="badge" style="margin-left:4px;background:rgba(255,216,106,0.18);color:#ffd86a;border-color:rgba(255,216,106,0.35);">⭐ 最多人选</span>'
                : '';
            const iconPreview = p.icon ? `<span style="font-size:1.15rem;margin-right:6px;">${escapeHtml(p.icon)}</span>` : '';
            const colorDot = p.accent_color
                ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeHtml(p.accent_color)};vertical-align:middle;margin-right:6px;"></span>`
                : '';
            return `
            <tr>
                <td>${p.id}</td>
                <td>${colorDot}${iconPreview}${escapeHtml(p.name)}${featuredMark}</td>
                <td>¥${p.price.toFixed(2)}</td>
                <td>${p.stock}</td>
                <td>${deliveryLabel}</td>
                <td><span class="badge ${p.status === 'in_stock' ? 'badge-success' : 'badge-danger'}">${p.status === 'in_stock' ? '有货' : '售罄'}</span></td>
                <td>
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem; background: #2563eb;" onclick="openEditProductModalById(${p.id})">编辑</button>
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem;" onclick="openAddCardsModal(${p.id})">添加卡密</button>
                    <button class="btn btn-secondary" style="padding: 0.5rem 1rem; font-size: 0.875rem; background: #dc2626;" onclick="deleteProduct(${p.id})">删除</button>
                </td>
            </tr>
        `}).join('');
    } catch (error) {
        console.error('加载商品列表失败:', error);
    }
}

// 订单筛选
function filterOrders(status) {
    orderStatusFilter = status;
    orderPage = 1;
    loadOrders();
}

function goOrderPage(page) {
    orderPage = page;
    loadOrders();
}

// 加载订单列表
async function loadOrders() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/orders?page=${orderPage}&pageSize=${orderPageSize}&status=${orderStatusFilter}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        const orders = data.orders || data;
        const pagination = data.pagination;

        const tbody = document.querySelector('#ordersTable tbody');
        if (!orders.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading">暂无订单</td></tr>';
            const paginationEl = document.getElementById('orderPagination');
            if (paginationEl) paginationEl.innerHTML = '';
            return;
        }

        tbody.innerHTML = orders.map(o => {
            let statusBadge, actionHtml = '';
            switch (o.payment_status) {
                case 'paid':
                    statusBadge = '<span class="badge badge-success">已支付</span>';
                    break;
                case 'confirming':
                    statusBadge = '<span class="badge badge-warning" style="background:rgba(255,216,106,0.15);color:#ffd86a;border-color:rgba(255,216,106,0.3);">待确认</span>';
                    actionHtml = `
                        <button class="btn btn-secondary" style="padding:0.4rem 0.8rem;font-size:0.8rem;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;" onclick="confirmOrder(${o.id})">确认收款</button>
                        <button class="btn btn-secondary" style="padding:0.4rem 0.8rem;font-size:0.8rem;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:4px;" onclick="rejectOrder(${o.id})">拒绝</button>
                    `;
                    break;
                case 'cancelled':
                    statusBadge = '<span class="badge badge-danger">已取消</span>';
                    break;
                case 'expired':
                    statusBadge = '<span class="badge badge-danger">已过期</span>';
                    break;
                default:
                    statusBadge = '<span class="badge badge-warning">待支付</span>';
            }
            return `
                <tr${o.payment_status === 'confirming' ? ' style="background:rgba(255,216,106,0.05);"' : ''}>
                    <td>${o.id}</td>
                    <td>${escapeHtml(o.email || o.buyer_email || '-')}</td>
                    <td>${escapeHtml(o.product_name)}</td>
                    <td>¥${o.amount.toFixed(2)}</td>
                    <td>${o.payment_method === 'alipay' ? '支付宝' : '微信'}</td>
                    <td>${statusBadge} ${actionHtml}</td>
                    <td>${new Date(o.created_at).toLocaleString()}</td>
                </tr>
            `;
        }).join('');

        // 渲染分页
        if (pagination) {
            const paginationEl = document.getElementById('orderPagination');
            if (paginationEl) {
                const { page, totalPages, total } = pagination;
                let html = `<span style="color:#94a3b8;font-size:0.82rem;">共 ${total} 条</span>`;
                if (totalPages > 1) {
                    html += ` <button onclick="goOrderPage(${page - 1})" ${page <= 1 ? 'disabled' : ''} style="padding:0.3rem 0.6rem;border:1px solid rgba(148,163,184,0.2);background:rgba(255,255,255,0.04);color:#eef4fb;border-radius:6px;cursor:pointer;font-size:0.82rem;">上一页</button>`;
                    html += ` <span style="color:#eef4fb;font-size:0.82rem;">${page} / ${totalPages}</span>`;
                    html += ` <button onclick="goOrderPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''} style="padding:0.3rem 0.6rem;border:1px solid rgba(148,163,184,0.2);background:rgba(255,255,255,0.04);color:#eef4fb;border-radius:6px;cursor:pointer;font-size:0.82rem;">下一页</button>`;
                }
                paginationEl.innerHTML = html;
            }
        }
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
    const deliveryTypeEl = document.getElementById('productDeliveryType');
    const delivery_type = deliveryTypeEl ? deliveryTypeEl.value : 'email';
    const icon = (document.getElementById('productIcon')?.value || '').trim();
    const accent_color = (document.getElementById('productAccentColor')?.value || '').trim();
    const is_featured = document.getElementById('productIsFeatured')?.checked ? 1 : 0;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, description, price, delivery_type, icon, accent_color, is_featured })
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

// 编辑商品（优先按 id 从缓存 lookup）
function openEditProductModalById(id) {
    const p = __productsCache.find(x => x.id === id);
    if (!p) return alert('商品不存在，请刷新重试');
    document.getElementById('editProductId').value = p.id;
    document.getElementById('editProductName').value = p.name || '';
    document.getElementById('editProductDescription').value = p.description || '';
    document.getElementById('editProductPrice').value = p.price;
    document.getElementById('editProductDeliveryType').value = p.delivery_type || 'email';
    document.getElementById('editProductIcon').value = p.icon || '';
    document.getElementById('editProductAccentColor').value = p.accent_color || '';
    document.getElementById('editProductIsFeatured').checked = !!p.is_featured;
    document.getElementById('editProductModal').classList.add('active');
}

// 旧签名保留兼容（可能有其他地方调用）
function openEditProductModal(id) {
    openEditProductModalById(id);
}

function closeEditProductModal() {
    document.getElementById('editProductModal').classList.remove('active');
}

async function handleEditProduct(e) {
    e.preventDefault();

    const id = document.getElementById('editProductId').value;
    const name = document.getElementById('editProductName').value;
    const description = document.getElementById('editProductDescription').value;
    const price = parseFloat(document.getElementById('editProductPrice').value);
    const delivery_type = document.getElementById('editProductDeliveryType').value;
    const icon = (document.getElementById('editProductIcon')?.value || '').trim();
    const accent_color = (document.getElementById('editProductAccentColor')?.value || '').trim();
    const is_featured = document.getElementById('editProductIsFeatured')?.checked ? 1 : 0;
    // status 没在编辑表单里，用原商品的状态透传
    const prev = __productsCache.find(x => String(x.id) === String(id));
    const status = prev ? prev.status : 'in_stock';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/products/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, description, price, status, delivery_type, icon, accent_color, is_featured })
        });

        const data = await response.json();
        if (!response.ok) {
            alert(data.error || '更新失败');
            return;
        }

        alert('商品更新成功！');
        closeEditProductModal();
        loadProducts();
    } catch (error) {
        console.error('更新商品失败:', error);
        alert('更新失败，请稍后重试');
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

// 确认收款
async function confirmOrder(orderId) {
    if (!confirm('确认已收到付款？确认后将自动发卡给买家。')) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/orders/${orderId}/confirm`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '操作失败');
            return;
        }

        alert(data.message || '已确认收款');
        loadOrders();
        loadStats();
    } catch (error) {
        console.error('确认收款失败:', error);
        alert('操作失败，请重试');
    }
}

// 拒绝订单
async function rejectOrder(orderId) {
    if (!confirm('确定要拒绝此订单吗？')) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/admin/orders/${orderId}/reject`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '操作失败');
            return;
        }

        alert('订单已拒绝');
        loadOrders();
    } catch (error) {
        console.error('拒绝订单失败:', error);
        alert('操作失败，请重试');
    }
}

// ============================================
// CDK 管理
// ============================================

// 加载 CDK 列表
async function loadCDKList() {
    try {
        const token = localStorage.getItem('token');
        const type = document.getElementById('cdkFilterType')?.value || 'all';
        const status = document.getElementById('cdkFilterStatus')?.value || 'all';

        const res = await fetch(`${API_BASE}/admin/cdk-list?type=${type}&status=${status}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const cards = await res.json();

        const tbody = document.querySelector('#cdkTable tbody');
        if (!cards.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无 CDK</td></tr>';
            return;
        }

        tbody.innerHTML = cards.map(c => {
            const masked = c.card_number.substring(0, 4) + '************' + (c.card_number.length > 4 ? '' : '');
            const typeLabel = c.card_type === 'yearly'
                ? '<span class="badge" style="background:rgba(168,85,247,0.15);color:#a855f7;border-color:rgba(168,85,247,0.3);">年卡</span>'
                : '<span class="badge" style="background:rgba(59,130,246,0.15);color:#3b82f6;border-color:rgba(59,130,246,0.3);">月卡</span>';
            const statusLabel = c.status === 'available'
                ? '<span class="badge badge-success">可用</span>'
                : '<span class="badge badge-danger">已用</span>';
            return `<tr>
                <td>${c.id}</td>
                <td>
                    <span id="cdk-masked-${c.id}">${escapeHtml(masked)}</span>
                    <span id="cdk-full-${c.id}" style="display:none;">${escapeHtml(c.card_number)}</span>
                    <a href="#" onclick="toggleCDK(${c.id});return false;" style="color:#a855f7;font-size:0.8rem;margin-left:4px;" id="cdk-toggle-${c.id}">显示</a>
                </td>
                <td>${typeLabel}</td>
                <td>${statusLabel}</td>
                <td>${escapeHtml(c.order_no || '-')}</td>
                <td>${escapeHtml(c.used_at || c.sold_at || '-')}</td>
                <td style="color:${c.error_info ? '#ef4444' : '#94a3b8'};font-size:0.82rem;">${escapeHtml(c.error_info || '-')}</td>
                <td>${c.created_at ? new Date(c.created_at).toLocaleString() : '-'}</td>
                <td>${c.status === 'available' ? `<button class="btn" style="padding:0.4rem 0.8rem;font-size:0.8rem;background:#dc2626;" onclick="deleteCDK(${c.id})">删除</button>` : ''}</td>
            </tr>`;
        }).join('');

        // 更新导入面板的商品下拉
        populateCDKProductSelect();
    } catch (e) {
        console.error('加载CDK列表失败:', e);
    }
}

function toggleCDK(id) {
    const masked = document.getElementById(`cdk-masked-${id}`);
    const full = document.getElementById(`cdk-full-${id}`);
    const toggle = document.getElementById(`cdk-toggle-${id}`);
    if (masked.style.display !== 'none') {
        masked.style.display = 'none';
        full.style.display = 'inline';
        toggle.textContent = '隐藏';
    } else {
        masked.style.display = 'inline';
        full.style.display = 'none';
        toggle.textContent = '显示';
    }
}

async function populateCDKProductSelect() {
    const select = document.getElementById('cdkImportProduct');
    if (!select) return;
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/products`, { headers: { 'Authorization': `Bearer ${token}` } });
        const products = await res.json();
        if (!products.length) {
            select.innerHTML = '<option value="">暂无商品，请先添加</option>';
            return;
        }
        select.innerHTML = products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    } catch (e) {
        console.error('加载商品下拉失败:', e);
    }
}

async function importCDK() {
    const text = document.getElementById('cdkImportText').value.trim();
    const type = document.getElementById('cdkImportType').value;
    const productId = document.getElementById('cdkImportProduct').value;

    if (!text) { alert('请输入 CDK'); return; }
    if (!productId) { alert('请选择商品'); return; }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/admin/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ productId, cdkList: text, cardType: type })
        });
        const data = await res.json();

        if (!res.ok) { alert(data.error || '导入失败'); return; }

        alert(data.message);
        document.getElementById('cdkImportText').value = '';
        loadCDKList();
        loadProducts();
        loadStats();
    } catch (e) {
        alert('导入失败，请重试');
    }
}

async function deleteCDK(id) {
    if (!confirm('确定要删除这个 CDK 吗？')) return;
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/admin/cards/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            loadCDKList();
            loadProducts();
        } else {
            const data = await res.json();
            alert(data.error || '删除失败');
        }
    } catch (e) {
        alert('删除失败');
    }
}

// 修改密码
async function changePassword() {
    const oldPassword = prompt('请输入当前密码:');
    if (!oldPassword) return;
    const newPassword = prompt('请输入新密码（至少6位）:');
    if (!newPassword) return;
    if (newPassword.length < 6) { alert('新密码长度至少为 6 位'); return; }
    const confirmPassword = prompt('请再次输入新密码:');
    if (newPassword !== confirmPassword) { alert('两次输入的密码不一致'); return; }

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || '修改失败'); return; }
        alert('密码修改成功，请重新登录');
        localStorage.removeItem('token');
        window.location.href = '/';
    } catch (e) {
        alert('修改失败，请重试');
    }
}

// 导出订单为 CSV
async function exportOrders() {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/admin/orders?page=1&pageSize=10000&status=${orderStatusFilter}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const orders = data.orders || data;
        if (!orders.length) { alert('没有可导出的订单'); return; }

        const BOM = '\uFEFF';
        const header = '订单号,邮箱,商品,数量,金额,支付方式,状态,创建时间\n';
        const rows = orders.map(o =>
            `${o.transaction_id || ''},${o.email || o.buyer_email || ''},${escapeHtml(o.product_name).replace(/,/g, '，')},${o.quantity || 1},${o.amount},${o.payment_method === 'alipay' ? '支付宝' : '微信'},${o.payment_status},${o.created_at}`
        ).join('\n');

        const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('导出失败');
    }
}

// 工具函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ====== 邮箱黑名单 ======
async function loadBlockedEmails() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/blocked-emails`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = await resp.json();
        const tbody = document.querySelector('#blockedEmailsTable tbody');
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading">暂无黑名单</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td style="font-family:monospace;">${escapeHtml(r.email)}</td>
                <td>${escapeHtml(r.reason || '-')}</td>
                <td>${escapeHtml(r.created_at || '-')}</td>
                <td>
                    <button class="btn btn-danger" style="padding:0.3rem 0.7rem;font-size:0.78rem;"
                        onclick="removeBlockedEmail('${encodeURIComponent(r.email)}')">移除</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('加载黑名单失败:', err);
    }
}

async function addBlockedEmail() {
    const emailEl = document.getElementById('blockEmailInput');
    const reasonEl = document.getElementById('blockReasonInput');
    const email = (emailEl.value || '').trim().toLowerCase();
    const reason = (reasonEl.value || '').trim();
    if (!email) { alert('请填写邮箱'); return; }
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/blocked-emails`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ email, reason })
        });
        const data = await resp.json();
        if (!resp.ok) { alert(data.error || '添加失败'); return; }
        emailEl.value = '';
        reasonEl.value = '';
        loadBlockedEmails();
    } catch (err) {
        console.error('添加黑名单失败:', err);
        alert('添加失败');
    }
}

// ====== 邀请返现 ======
async function loadReferralCodes() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/referrals/codes`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = await resp.json();
        const tbody = document.querySelector('#referralCodesTable tbody');
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无邀请码</td></tr>';
            return;
        }
        const host = location.origin;
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>
                    <div style="font-family:monospace;color:#c7ff6b;">${escapeHtml(r.code)}</div>
                    <div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;cursor:pointer;" onclick="copyToClipboard('${host}/?ref=${encodeURIComponent(r.code)}', this)">📋 点击复制推广链接</div>
                </td>
                <td>
                    <div>${escapeHtml(r.referrer_name || '-')}</div>
                    <div style="font-size:0.72rem;color:#94a3b8;">${escapeHtml(r.referrer_contact || '')}</div>
                </td>
                <td>${(r.commission_rate * 100).toFixed(0)}%</td>
                <td>${r.orders_count}</td>
                <td>¥${Number(r.total_amount).toFixed(2)}</td>
                <td>¥${Number(r.total_commission).toFixed(2)}</td>
                <td style="color:${r.pending_commission > 0 ? '#ffd86a' : '#94a3b8'};">¥${Number(r.pending_commission).toFixed(2)}</td>
                <td><span class="badge ${r.is_active ? 'badge-success' : 'badge-danger'}">${r.is_active ? '启用' : '禁用'}</span></td>
                <td>
                    <button class="btn btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.78rem;"
                        onclick="toggleReferralCode('${encodeURIComponent(r.code)}')">${r.is_active ? '禁用' : '启用'}</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('加载邀请码失败:', err);
    }
}

async function loadReferralRecords() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/referrals/records`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const rows = await resp.json();
        const tbody = document.querySelector('#referralRecordsTable tbody');
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">暂无记录</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td style="font-size:0.78rem;">${escapeHtml((r.created_at || '').slice(0, 16))}</td>
                <td style="font-family:monospace;color:#c7ff6b;">${escapeHtml(r.referral_code)}</td>
                <td>${escapeHtml(r.referrer_name || '-')}</td>
                <td style="font-family:monospace;font-size:0.78rem;">${escapeHtml(r.transaction_id || '')}</td>
                <td>${escapeHtml(r.buyer_email || '-')}</td>
                <td>¥${Number(r.order_amount || 0).toFixed(2)}</td>
                <td><b>¥${Number(r.commission || 0).toFixed(2)}</b></td>
                <td><span class="badge ${r.status === 'paid' ? 'badge-success' : 'badge-warning'}" style="${r.status === 'pending' ? 'background:rgba(255,216,106,0.15);color:#ffd86a;border-color:rgba(255,216,106,0.3);' : ''}">${r.status === 'paid' ? '已结算' : '待结算'}</span></td>
                <td>
                    ${r.status === 'pending' ? `<button class="btn btn-secondary" style="padding:0.3rem 0.7rem;font-size:0.78rem;" onclick="markRefPaid(${r.id})">标记已结算</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('加载返现记录失败:', err);
    }
}

async function createReferralCode() {
    const referrer_name = document.getElementById('refName').value.trim();
    const referrer_contact = document.getElementById('refContact').value.trim();
    const commission_rate = parseFloat(document.getElementById('refRate').value) || 0.10;
    const code = document.getElementById('refCode').value.trim();
    const note = document.getElementById('refNote').value.trim();
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/referrals/codes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ referrer_name, referrer_contact, commission_rate, code, note })
        });
        const data = await resp.json();
        if (!resp.ok) { alert(data.error || '创建失败'); return; }
        alert('已创建: ' + data.code);
        ['refName','refContact','refCode','refNote'].forEach(id => document.getElementById(id).value = '');
        loadReferralCodes();
    } catch (err) {
        console.error(err); alert('创建失败');
    }
}

async function toggleReferralCode(encodedCode) {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/referrals/codes/${encodedCode}/toggle`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) { alert('操作失败'); return; }
        loadReferralCodes();
    } catch (err) { console.error(err); }
}

async function markRefPaid(id) {
    if (!confirm('确认该条返现已线下结算？')) return;
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/referrals/records/${id}/mark-paid`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) { alert('操作失败'); return; }
        loadReferralRecords();
        loadReferralCodes();
    } catch (err) { console.error(err); }
}

function copyToClipboard(text, btn) {
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ 已复制';
        setTimeout(() => { btn.textContent = orig; }, 1400);
    }).catch(() => {
        prompt('按 Cmd/Ctrl+C 复制：', text);
    });
}

async function removeBlockedEmail(encodedEmail) {
    if (!confirm('确定从黑名单移除吗？')) return;
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_BASE}/admin/blocked-emails/${encodedEmail}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) { alert(data.error || '移除失败'); return; }
        loadBlockedEmails();
    } catch (err) {
        console.error('移除黑名单失败:', err);
        alert('移除失败');
    }
}
