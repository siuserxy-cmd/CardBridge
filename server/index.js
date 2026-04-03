const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 中间件配置
// ============================================

// CORS 跨域配置
app.use(cors());

// 解析 JSON 请求体
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

// 挂载路由
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

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
    res.status(404).json({ error: '接口不存在' });
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
