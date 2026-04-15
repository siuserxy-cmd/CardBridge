// API 基础地址
const API_BASE = window.location.origin + '/api';

// 全局状态
let currentUser = null;
let currentProduct = null;
let isLoginMode = true;

const PRODUCT_CARD_THEMES = [
    'card-theme-terminal',
    'card-theme-ocean',
    'card-theme-ember',
    'card-theme-cyan',
    'card-theme-rose',
    'card-theme-violet',
    'card-theme-amber'
];

// ============================================
// 初始化
// ============================================
// 邀请码捕获：访问时带 ?ref= 则持久化到 localStorage，供后续下单归因使用
(function captureReferralCode() {
    try {
        const ref = new URL(location.href).searchParams.get('ref');
        if (ref && /^[A-Za-z0-9_-]{4,32}$/.test(ref)) {
            localStorage.setItem('referralCode', ref);
            localStorage.setItem('referralCodeAt', String(Date.now()));
        }
    } catch (_) {}
})();

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
    // 如果已有菜单则关闭
    const existing = document.getElementById('userDropdown');
    if (existing) { existing.remove(); return; }

    const isAdmin = currentUser && currentUser.isAdmin;
    const menu = document.createElement('div');
    menu.id = 'userDropdown';
    menu.style.cssText = 'position:fixed;right:2rem;top:4.5rem;background:rgba(20,25,33,0.98);border:1px solid rgba(148,163,184,0.15);border-radius:14px;padding:0.6rem 0;min-width:180px;z-index:9999;backdrop-filter:blur(16px);box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    menu.innerHTML = `
        <div style="color:#94a3b8;font-size:0.78rem;padding:0.5rem 1rem 0.6rem;border-bottom:1px solid rgba(148,163,184,0.1);">${escapeHtml(currentUser.email)}</div>
        ${isAdmin ? '<a href="/admin" style="display:block;color:#eef4fb;text-decoration:none;padding:0.6rem 1rem;font-size:0.88rem;transition:0.15s;" onmouseover="this.style.background=\'rgba(199,255,107,0.08)\'" onmouseout="this.style.background=\'none\'">管理后台</a>' : ''}
        <a onclick="viewMyOrders();document.getElementById(\'userDropdown\')?.remove();" style="display:block;color:#eef4fb;text-decoration:none;padding:0.6rem 1rem;cursor:pointer;font-size:0.88rem;transition:0.15s;" onmouseover="this.style.background='rgba(199,255,107,0.08)'" onmouseout="this.style.background='none'">我的订单</a>
        <div style="border-top:1px solid rgba(148,163,184,0.1);margin:0.3rem 0;"></div>
        <a onclick="logout()" style="display:block;color:#ff857f;text-decoration:none;padding:0.6rem 1rem;cursor:pointer;font-size:0.88rem;transition:0.15s;" onmouseover="this.style.background='rgba(255,133,127,0.08)'" onmouseout="this.style.background='none'">退出登录</a>
    `;
    document.body.appendChild(menu);

    // 点击外部关闭
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && e.target.id !== 'userMenuBtn') {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
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

        grid.innerHTML = products.map((product) => {
            const accent = /^#[0-9a-fA-F]{6}$/.test(product.accent_color || '') ? product.accent_color : '';
            const cardStyle = accent ? ` style="--pc-accent:${accent};"` : '';
            const icon = (product.icon || '').trim() || '◆';
            const featuredRibbon = product.is_featured
                ? '<span class="featured-ribbon">⭐ 最多人选</span>'
                : '';
            const inStock = product.status === 'in_stock';

            return `
            <article class="product-card${product.is_featured ? ' is-featured' : ''}"${cardStyle} onclick="location.href='/product/${product.id}'">
                ${featuredRibbon}
                <div class="card-top">
                    <div class="card-icon">${escapeHtml(icon)}</div>
                    <div class="card-heading">
                        <h3 class="card-title">${escapeHtml(product.name)}</h3>
                        <div class="card-price">¥${product.price.toFixed(2)}<span class="card-price-unit">/件</span></div>
                    </div>
                </div>
                <p class="card-description">${escapeHtml(product.description || '')}</p>
                <div class="card-meta-row">
                    <div class="card-meta-item">已售 <b>${product.sold_count || 0}</b></div>
                    <div class="card-meta-item">库存 <b>${product.stock}</b></div>
                    <div class="card-meta-item" style="margin-left:auto;">
                        <span class="status-badge ${product.status}">${inStock ? '有货' : '售罄'}</span>
                    </div>
                </div>
                <div class="card-footer">
                    <button class="btn-buy"
                        onclick="event.stopPropagation(); location.href='/product/${product.id}'"
                        ${!inStock ? 'disabled' : ''}>
                        ${inStock ? '立即购买 →' : '暂无库存'}
                    </button>
                </div>
            </article>
        `;
        }).join('');
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
            accessToken: data.accessToken || '',
            expiresAt: data.expiresAt || '',
            manualMode: data.paymentInfo?.manualMode || false,
            qrImage: data.paymentInfo?.qrImage || '',
            contactInfo: data.paymentInfo?.contactInfo || '',
            payUrl: data.paymentInfo?.payUrl || '',
            codeUrl: data.paymentInfo?.codeUrl || ''
        }));
        window.location.href = data.paymentUrl || `/payment/${encodeURIComponent(data.orderNo)}?t=${encodeURIComponent(data.accessToken || '')}`;
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
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const orders = await response.json();

        // 创建订单模态框
        const existing = document.getElementById('ordersModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'ordersModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

        const statusMap = { paid: '已支付', pending: '待支付', confirming: '待确认', cancelled: '已取消', expired: '已过期' };
        const statusColor = { paid: '#79f2aa', pending: '#ffd86a', confirming: '#ffd86a', cancelled: '#ff857f', expired: '#ff857f' };

        let content;
        if (orders.length === 0) {
            content = '<div style="text-align:center;color:#728092;padding:2rem;">暂无订单记录</div>';
        } else {
            content = orders.map(o => `
                <div style="padding:1rem;border:1px solid rgba(180,192,205,0.1);border-radius:12px;background:rgba(255,255,255,0.02);margin-bottom:0.8rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                        <span style="font-weight:600;">${escapeHtml(o.product_name)}</span>
                        <span style="color:${statusColor[o.payment_status] || '#728092'};font-size:0.82rem;">${statusMap[o.payment_status] || o.payment_status}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;color:#728092;font-size:0.82rem;">
                        <span>¥${parseFloat(o.amount).toFixed(2)}</span>
                        <span>${new Date(o.created_at).toLocaleString()}</span>
                    </div>
                </div>
            `).join('');
        }

        modal.innerHTML = `
            <div style="background:rgba(16,20,26,0.98);border:1px solid rgba(180,192,205,0.14);border-radius:20px;max-width:480px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.5);">
                <div style="padding:1.2rem 1.5rem;border-bottom:1px solid rgba(180,192,205,0.1);display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:700;font-size:1.1rem;">我的订单</span>
                    <button onclick="document.getElementById('ordersModal').remove()" style="background:none;border:none;color:#728092;font-size:1.4rem;cursor:pointer;padding:0.2rem 0.4rem;">&times;</button>
                </div>
                <div style="padding:1.2rem 1.5rem;">${content}</div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        console.error('查询订单失败:', error);
        alert('查询订单失败');
    }
}

// ============================================
// 工具函数
// ============================================
function getProductCardTheme(product, index) {
    return PRODUCT_CARD_THEMES[index % PRODUCT_CARD_THEMES.length];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
