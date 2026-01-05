const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { authenticateToken } = require('../middleware/auth');
const { createAlipayOrder, createWechatOrder } = require('../utils/payment');

const router = express.Router();

// ============================================
// 创建订单并发起支付
// ============================================
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { productId, paymentMethod } = req.body;
        const userId = req.user.userId;

        // 验证支付方式
        if (!['alipay', 'wechat'].includes(paymentMethod)) {
            return res.status(400).json({ error: '不支持的支付方式' });
        }

        // 查询商品信息
        const product = await dbGet(`
            SELECT p.*, COUNT(c.id) as available_cards
            FROM products p
            LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
            WHERE p.id = ?
            GROUP BY p.id
        `, [productId]);

        if (!product) {
            return res.status(404).json({ error: '商品不存在' });
        }

        if (product.available_cards === 0) {
            return res.status(400).json({ error: '商品已售罄' });
        }

        // 创建订单
        const orderResult = await dbRun(`
            INSERT INTO orders (user_id, product_id, amount, payment_method, payment_status)
            VALUES (?, ?, ?, ?, 'pending')
        `, [userId, productId, product.price, paymentMethod]);

        const orderId = orderResult.id;

        // 生成订单号
        const orderNo = `ORD${Date.now()}${orderId}`;

        // 更新订单号
        await dbRun('UPDATE orders SET transaction_id = ? WHERE id = ?', [orderNo, orderId]);

        // 创建支付
        let paymentInfo;
        const orderInfo = {
            orderId: orderNo,
            amount: product.price,
            subject: product.name,
            description: product.description || product.name
        };

        if (paymentMethod === 'alipay') {
            paymentInfo = await createAlipayOrder(orderInfo);
        } else {
            paymentInfo = await createWechatOrder(orderInfo);
        }

        res.json({
            orderId,
            orderNo,
            amount: product.price,
            productName: product.name,
            paymentMethod,
            paymentInfo
        });
    } catch (error) {
        console.error('创建订单错误:', error);
        res.status(500).json({ error: '创建订单失败，请稍后重试' });
    }
});

// ============================================
// 测试支付（仅用于开发测试）
// ============================================
router.get('/test-pay/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;

        // 查询订单
        const order = await dbGet(`
            SELECT o.*, p.name as product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.transaction_id = ?
        `, [orderNo]);

        if (!order) {
            return res.status(404).send('<h1>订单不存在</h1>');
        }

        if (order.payment_status === 'paid') {
            return res.status(400).send('<h1>订单已支付</h1>');
        }

        // 模拟支付成功
        await processPaymentSuccess(order.id, orderNo);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>支付成功</title>
                <style>
                    body {
                        background: #0f172a;
                        color: #f8fafc;
                        font-family: sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    .container {
                        text-align: center;
                        background: #1e293b;
                        padding: 3rem;
                        border-radius: 12px;
                    }
                    .success-icon {
                        font-size: 4rem;
                        color: #10b981;
                        margin-bottom: 1rem;
                    }
                    h1 { color: #10b981; }
                    .info { color: #94a3b8; margin: 1rem 0; }
                    .btn {
                        display: inline-block;
                        background: linear-gradient(to right, #a855f7, #ec4899);
                        color: white;
                        padding: 0.75rem 2rem;
                        border-radius: 8px;
                        text-decoration: none;
                        margin-top: 2rem;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">✓</div>
                    <h1>支付成功！</h1>
                    <p class="info">订单号: ${orderNo}</p>
                    <p class="info">商品: ${order.product_name}</p>
                    <p class="info">金额: ¥${order.amount.toFixed(2)}</p>
                    <a href="/" class="btn">返回首页</a>
                    <br><br>
                    <a href="/api/orders/${order.id}" class="btn">查看卡密</a>
                </div>
                <script>
                    // 3秒后自动跳转
                    setTimeout(() => {
                        window.location.href = '/api/orders/${order.id}';
                    }, 3000);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('测试支付错误:', error);
        res.status(500).send('<h1>支付处理失败</h1>');
    }
});

// ============================================
// 处理支付成功（自动发卡）
// ============================================
async function processPaymentSuccess(orderId, transactionId) {
    try {
        // 查询订单
        const order = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (!order || order.payment_status === 'paid') {
            return;
        }

        // 查找可用卡密
        const card = await dbGet(`
            SELECT * FROM cards
            WHERE product_id = ? AND status = 'available'
            LIMIT 1
        `, [order.product_id]);

        if (!card) {
            console.error('❌ 库存不足，无法发卡');
            return;
        }

        // 更新订单状态
        await dbRun(`
            UPDATE orders
            SET payment_status = 'paid', card_id = ?, paid_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [card.id, orderId]);

        // 更新卡密状态
        await dbRun(`
            UPDATE cards
            SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [orderId, card.id]);

        console.log(`✅ 订单 ${orderId} 支付成功，已自动发卡`);
    } catch (error) {
        console.error('处理支付成功失败:', error);
    }
}

// ============================================
// 查询订单详情（包含卡密）
// ============================================
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        // 查询订单
        const order = await dbGet(`
            SELECT
                o.*,
                p.name as product_name,
                p.description as product_description,
                c.card_number,
                c.card_password
            FROM orders o
            JOIN products p ON o.product_id = p.id
            LEFT JOIN cards c ON o.card_id = c.id
            WHERE o.id = ? AND o.user_id = ?
        `, [id, userId]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        res.json(order);
    } catch (error) {
        console.error('查询订单错误:', error);
        res.status(500).json({ error: '查询订单失败' });
    }
});

// ============================================
// 获取用户所有订单
// ============================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const orders = await dbAll(`
            SELECT
                o.*,
                p.name as product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `, [userId]);

        res.json(orders);
    } catch (error) {
        console.error('查询订单列表错误:', error);
        res.status(500).json({ error: '查询订单列表失败' });
    }
});

// ============================================
// 支付宝回调（实际生产环境使用）
// ============================================
router.post('/alipay-callback', async (req, res) => {
    try {
        // 这里应该验证支付宝签名
        const { out_trade_no, trade_status } = req.body;

        if (trade_status === 'TRADE_SUCCESS') {
            const order = await dbGet('SELECT * FROM orders WHERE transaction_id = ?', [out_trade_no]);
            if (order) {
                await processPaymentSuccess(order.id, out_trade_no);
            }
        }

        res.send('success');
    } catch (error) {
        console.error('支付宝回调错误:', error);
        res.send('fail');
    }
});

// ============================================
// 微信支付回调（实际生产环境使用）
// ============================================
router.post('/wechat-callback', async (req, res) => {
    try {
        // 这里应该验证微信签名
        const { out_trade_no, trade_state } = req.body;

        if (trade_state === 'SUCCESS') {
            const order = await dbGet('SELECT * FROM orders WHERE transaction_id = ?', [out_trade_no]);
            if (order) {
                await processPaymentSuccess(order.id, out_trade_no);
            }
        }

        res.json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
        console.error('微信支付回调错误:', error);
        res.json({ code: 'FAIL', message: '失败' });
    }
});

module.exports = router;
