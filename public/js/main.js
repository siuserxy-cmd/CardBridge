// API 基础地址
const API_BASE = window.location.origin + '/api';

// 全局状态
let currentUser = null;
let currentProduct = null;
let isLoginMode = true;

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadProducts();
    setupEventListeners();
});

// ============================================
// 事件监听器设置
// ============================================
function setupEventListeners() {
    // 登录/注册表单
    document.getElementById('authForm').addEventListener('submit', handleAuth);

    // 切换登录/注册模式
    document.getElementById('switchAuthMode').addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        updateAuthModal();
    });

    // 用户菜单按钮
    document.getElementById('userMenuBtn').addEventListener('click', () => {
        if (currentUser) {
            showUserMenu();
        } else {
            openAuthModal();
        }
    });
}

// ============================================
// 检查登录状态
// ============================================
async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            currentUser = await response.json();
            updateUserMenu();
        } else {
            localStorage.removeItem('token');
        }
    } catch (error) {
        console.error('检查登录状态失败:', error);
    }
}

// 更新用户菜单显示
function updateUserMenu() {
    const userMenuBtn = document.getElementById('userMenuBtn');
    if (currentUser) {
        userMenuBtn.textContent = currentUser.email;
    } else {
        userMenuBtn.textContent = '登录/注册';
    }
}

// 显示用户菜单
function showUserMenu() {
    const isAdmin = currentUser && currentUser.isAdmin;
    const menuHtml = `
        <div style="position: absolute; right: 2rem; top: 4rem; background: #1e293b; border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 1rem; min-width: 150px;">
            <div style="color: #94a3b8; font-size: 0.875rem; margin-bottom: 0.5rem;">${currentUser.email}</div>
            ${isAdmin ? '<a href="/admin" style="display: block; color: #f8fafc; text-decoration: none; padding: 0.5rem 0; border-bottom: 1px solid rgba(148, 163, 184, 0.1);">管理后台</a>' : ''}
            <a onclick="viewMyOrders()" style="display: block; color: #f8fafc; text-decoration: none; padding: 0.5rem 0; cursor: pointer;">我的订单</a>
            <a onclick="logout()" style="display: block; color: #ef4444; text-decoration: none; padding: 0.5rem 0; cursor: pointer;">退出登录</a>
        </div>
    `;
    // 简单实现：使用 confirm
    if (confirm('查看我的订单？')) {
        viewMyOrders();
    }
}

// 退出登录
function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    updateUserMenu();
    location.reload();
}

// ============================================
// 加载商品列表
// ============================================
async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE}/products`);
        const products = await response.json();

        const grid = document.getElementById('productGrid');
        if (products.length === 0) {
            grid.innerHTML = '<div class="loading">暂无商品</div>';
            return;
        }

        grid.innerHTML = products.map(product => `
            <article class="product-card" onclick="location.href='/product.html?id=${product.id}'" style="cursor:pointer;">
                <div class="card-content">
                    <div class="card-header">
                        <h3 class="card-title">${escapeHtml(product.name)}</h3>
                        <span class="status-badge ${product.status}">
                            ${product.status === 'in_stock' ? '有货' : '售罄'}
                        </span>
                    </div>
                    <p class="card-description">${escapeHtml(product.description || '')}</p>
                    <div class="card-stats-row">
                        <div class="card-stat">
                            <div class="card-stat-label">单价</div>
                            <div class="card-stat-value price">¥${product.price.toFixed(2)}</div>
                        </div>
                        <div class="card-stat">
                            <div class="card-stat-label">已售</div>
                            <div class="card-stat-value sold">${product.sold_count || 0}<small style="font-size:0.7rem;color:var(--text-dim);"> 件</small></div>
                        </div>
                        <div class="card-stat">
                            <div class="card-stat-label">库存</div>
                            <div class="card-stat-value stock">${product.stock}<small style="font-size:0.7rem;color:var(--text-dim);"> 件</small></div>
                        </div>
                    </div>
                    <div class="card-footer">
                        <button class="btn-buy" style="width:100%"
                            onclick="event.stopPropagation(); location.href='/product.html?id=${product.id}'"
                            ${product.status !== 'in_stock' ? 'disabled' : ''}>
                            ${product.status === 'in_stock' ? '查看详情' : '暂无库存'}
                        </button>
                    </div>
                </div>
            </article>
        `).join('');
    } catch (error) {
        console.error('加载商品失败:', error);
        document.getElementById('productGrid').innerHTML =
            '<div class="loading">加载失败，请刷新重试</div>';
    }
}

// ============================================
// 购买流程
// ============================================
function handleBuyClick(productId, productName, price) {
    if (!currentUser) {
        alert('请先登录');
        openAuthModal();
        return;
    }

    currentProduct = { id: productId, name: productName, price };
    openPaymentModal();
}

// 创建订单
async function createOrder(paymentMethod) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/orders/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                productId: currentProduct.id,
                paymentMethod
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || '创建订单失败');
            return;
        }

        closePaymentModal();

        // Save order data and redirect to payment page
        sessionStorage.setItem('pendingOrder', JSON.stringify({
            orderNo: data.orderNo,
            amount: data.amount,
            quantity: data.quantity,
            productName: data.productName,
            paymentMethod: paymentMethod,
            manualMode: data.paymentInfo?.manualMode || false,
            qrImage: data.paymentInfo?.qrImage || '',
            contactInfo: data.paymentInfo?.contactInfo || '',
            payUrl: data.paymentInfo?.payUrl || data.paymentInfo?.codeUrl || ''
        }));
        window.location.href = `/payment/${data.orderNo}`;
    } catch (error) {
        console.error('创建订单失败:', error);
        alert('创建订单失败，请稍后重试');
    }
}

// ============================================
// 认证模态框
// ============================================
function openAuthModal() {
    document.getElementById('authModal').classList.add('active');
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

function updateAuthModal() {
    const title = document.getElementById('authModalTitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const switchLink = document.getElementById('switchAuthMode');

    if (isLoginMode) {
        title.textContent = '登录';
        submitBtn.textContent = '登录';
        switchLink.textContent = '还没有账号？立即注册';
    } else {
        title.textContent = '注册';
        submitBtn.textContent = '注册';
        switchLink.textContent = '已有账号？立即登录';
    }
}

async function handleAuth(e) {
    e.preventDefault();

    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;

    const endpoint = isLoginMode ? '/auth/login' : '/auth/register';

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || (isLoginMode ? '登录失败' : '注册失败'));
            return;
        }

        // 保存 token
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        updateUserMenu();

        alert(data.message);
        closeAuthModal();

        // 清空表单
        document.getElementById('authForm').reset();
    } catch (error) {
        console.error('认证失败:', error);
        alert('操作失败，请稍后重试');
    }
}

// ============================================
// 支付模态框
// ============================================
function openPaymentModal() {
    document.getElementById('paymentInfo').innerHTML = `
        <div style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">${escapeHtml(currentProduct.name)}</div>
        <div style="font-size: 1.5rem; color: #10b981; font-weight: 700;">¥${currentProduct.price.toFixed(2)}</div>
    `;
    document.getElementById('paymentModal').classList.add('active');
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.remove('active');
}

// ============================================
// 查看我的订单
// ============================================
async function viewMyOrders() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE}/orders`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const orders = await response.json();

        if (orders.length === 0) {
            alert('您还没有订单');
            return;
        }

        // 简单展示订单列表
        let ordersHtml = '您的订单：\n\n';
        orders.forEach((order, index) => {
            ordersHtml += `${index + 1}. ${order.product_name}\n`;
            ordersHtml += `   金额: ¥${order.amount}\n`;
            ordersHtml += `   状态: ${order.payment_status === 'paid' ? '已支付' : '待支付'}\n`;
            ordersHtml += `   时间: ${new Date(order.created_at).toLocaleString()}\n\n`;
        });

        alert(ordersHtml);
    } catch (error) {
        console.error('查询订单失败:', error);
        alert('查询订单失败');
    }
}

// ============================================
// 工具函数
// ============================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
