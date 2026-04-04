const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

function captureRawBody(req, res, buf) {
    if (buf && buf.length) {
        req.rawBody = buf.toString('utf8');
    }
}

// ============================================
// 中间件配置
// ============================================

// CORS 跨域配置
const allowedOrigins = [process.env.APP_URL]
    .filter(Boolean)
    .map(url => {
        try {
            return new URL(url).origin;
        } catch (error) {
            return null;
        }
    })
    .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== 'production') return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'));
    }
}));

app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// 解析 JSON 请求体
app.use(bodyParser.json({ verify: captureRawBody }));
app.use(bodyParser.urlencoded({ extended: true, verify: captureRawBody }));

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '..', 'public')));

// 请求日志
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// API 路由
// ============================================

// 引入路由模块
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const { orderLimit, authLimit, apiLimit } = require('./middleware/rate-limit');

// 挂载路由（含限流）
app.use('/api/auth', authLimit, authRoutes);
app.use('/api/products', apiLimit, productRoutes);
// 订单路由：只对下单接口限流，轮询和回调不限
app.post('/api/orders/guest-create', orderLimit);
app.post('/api/orders/create', orderLimit);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', apiLimit, adminRoutes);

// ============================================
// 首页路由
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// 商品详情页（SEO 友好的独立路由）
app.get('/product/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'product.html'));
});

// 支付页面
app.get('/payment/:orderNo', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'payment.html'));
});

// 订单成功页（展示卡密）
app.get('/order/:orderNo', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'order.html'));
});

// 订单查询页
app.get('/lookup', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'lookup.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// ============================================
// 错误处理
// ============================================

// 404 处理
app.use((req, res) => {
    // API 请求返回 JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: '接口不存在' });
    }
    // 页面请求返回友好的 404 页面
    res.status(404).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>页面不存在</title></head><body style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#eef4fb;font-family:monospace;"><div style="text-align:center;"><div style="font-size:4rem;margin-bottom:1rem;color:#728092;">404</div><p style="color:#728092;margin-bottom:1.5rem;">页面不存在或已被移除</p><a href="/" style="color:#c7ff6b;border:1px solid rgba(199,255,107,0.2);padding:0.6rem 1.4rem;border-radius:999px;text-decoration:none;">返回首页</a></div></body></html>`);
});

// 全局错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        error: '服务器内部错误',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============================================
// 启动服务器
// ============================================

app.listen(PORT, () => {
    console.log('\n🚀 服务器启动成功！');
    console.log(`\n📍 访问地址:`);
    console.log(`   前台商城: http://localhost:${PORT}`);
    console.log(`   管理后台: http://localhost:${PORT}/admin`);
    console.log(`\n⚙️  环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`\n💡 提示: 使用 Ctrl+C 停止服务器\n`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n收到 SIGINT 信号，正在关闭服务器...');
    process.exit(0);
});
