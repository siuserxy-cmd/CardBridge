const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { authenticateToken } = require('../middleware/auth');
const { createAlipayOrder, createWechatOrder } = require('../utils/payment');
const { sendCardEmail } = require('../utils/email');

const router = express.Router();

// ============================================
// 工具：根据数量计算阶梯单价
// ============================================
async function calcUnitPrice(productId, basePrice, quantity) {
    const tiers = await dbAll(
        'SELECT * FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC',
        [productId]
    );
    if (!tiers.length) return basePrice;

    // 找到匹配的档位（max_qty 为 NULL 表示"及以上"）
    for (let i = tiers.length - 1; i >= 0; i--) {
        const t = tiers[i];
        if (quantity >= t.min_qty && (t.max_qty === null || quantity <= t.max_qty)) {
            return t.price;
        }
    }
    return basePrice;
}

// ============================================
// 游客下单（无需登录，填邮箱即可）
// ============================================
router.post('/guest-create', async (req, res) => {
    try {
        const { productId, quantity = 1, email, paymentMethod } = req.body;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: '请填写正确的邮箱地址' });
        }
        if (!['alipay', 'wechat'].includes(paymentMethod)) {
            return res.status(400).json({ error: '不支持的支付方式' });
        }
        const qty = Math.max(1, parseInt(quantity) || 1);

        // 查询商品
        const product = await dbGet(`
            SELECT p.*, COUNT(c.id) as available_cards
            FROM products p
            LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
            WHERE p.id = ?
            GROUP BY p.id
        `, [productId]);

        if (!product) return res.status(404).json({ error: '商品不存在' });
        if (product.available_cards < qty) {
            return res.status(400).json({ error: `库存不足，当前仅剩 ${product.available_cards} 件` });
        }

        // 计算阶梯价格
        const unitPrice = await calcUnitPrice(productId, product.price, qty);
        const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

        // 创建订单
        const orderResult = await dbRun(`
            INSERT INTO orders (user_id, buyer_email, product_id, quantity, amount, payment_method, payment_status)
            VALUES (0, ?, ?, ?, ?, ?, 'pending')
        `, [email, productId, qty, totalAmount, paymentMethod]);

        const orderId = orderResult.id;
        const orderNo = `ORD${Date.now()}${orderId}`;
        await dbRun('UPDATE orders SET transaction_id = ? WHERE id = ?', [orderNo, orderId]);

        // 发起支付
        const orderInfo = {
            orderId: orderNo,
            amount: totalAmount,
            subject: product.name,
            description: `${product.name} x${qty}`
        };
        const paymentInfo = paymentMethod === 'alipay'
            ? await createAlipayOrder(orderInfo)
            : await createWechatOrder(orderInfo);

        res.json({ orderId, orderNo, amount: totalAmount, unitPrice, quantity: qty, productName: product.name, paymentMethod, paymentInfo });
    } catch (error) {
        console.error('游客下单错误:', error);
        res.status(500).json({ error: '创建订单失败，请稍后重试' });
    }
});

// ============================================
// 创建订单并发起支付（登录用户）
// ============================================
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { productId, quantity = 1, paymentMethod } = req.body;
        const userId = req.user.userId;
        const qty = Math.max(1, parseInt(quantity) || 1);

        if (!['alipay', 'wechat'].includes(paymentMethod)) {
            return res.status(400).json({ error: '不支持的支付方式' });
        }

        const product = await dbGet(`
            SELECT p.*, COUNT(c.id) as available_cards
            FROM products p
            LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
            WHERE p.id = ?
            GROUP BY p.id
        `, [productId]);

        if (!product) return res.status(404).json({ error: '商品不存在' });
        if (product.available_cards < qty) {
            return res.status(400).json({ error: `库存不足，当前仅剩 ${product.available_cards} 件` });
        }

        const unitPrice = await calcUnitPrice(productId, product.price, qty);
        const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

        const orderResult = await dbRun(`
            INSERT INTO orders (user_id, product_id, quantity, amount, payment_method, payment_status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `, [userId, productId, qty, totalAmount, paymentMethod]);

        const orderId = orderResult.id;
        const orderNo = `ORD${Date.now()}${orderId}`;
        await dbRun('UPDATE orders SET transaction_id = ? WHERE id = ?', [orderNo, orderId]);

        const orderInfo = {
            orderId: orderNo,
            amount: totalAmount,
            subject: product.name,
            description: `${product.name} x${qty}`
        };
        const paymentInfo = paymentMethod === 'alipay'
            ? await createAlipayOrder(orderInfo)
            : await createWechatOrder(orderInfo);

        res.json({ orderId, orderNo, amount: totalAmount, unitPrice, quantity: qty, productName: product.name, paymentMethod, paymentInfo });
    } catch (error) {
        console.error('创建订单错误:', error);
        res.status(500).json({ error: '创建订单失败，请稍后重试' });
    }
});

// ============================================
// 查询订单支付状态（供前端轮询）
// ============================================
router.get('/status/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;
        const order = await dbGet(`
            SELECT o.id, o.transaction_id, o.payment_status, o.amount, o.quantity,
                   p.name as product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.transaction_id = ?
        `, [orderNo]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        res.json({
            orderNo: order.transaction_id,
            status: order.payment_status,
            amount: order.amount,
            quantity: order.quantity,
            productName: order.product_name
        });
    } catch (error) {
        console.error('查询订单状态错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// ============================================
// 测试支付（仅用于开发测试）
// ============================================
router.get('/test-pay/:orderNo', async (req, res) => {
    // 生产环境禁止使用测试支付
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).send('<h1>测试支付在生产环境下已禁用</h1>');
    }

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
// 处理支付成功（自动发卡 + 邮件通知）
// ============================================
async function processPaymentSuccess(orderId, transactionId) {
    try {
        // 查询订单（含用户邮箱）
        const order = await dbGet(`
            SELECT o.*, u.email as user_email, p.name as product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.id = ?
        `, [orderId]);

        if (!order || order.payment_status === 'paid') {
            return;
        }

        const quantity = order.quantity || 1;

        // 查找足够数量的可用卡密
        const cards = await dbAll(`
            SELECT * FROM cards
            WHERE product_id = ? AND status = 'available'
            LIMIT ?
        `, [order.product_id, quantity]);

        if (cards.length < quantity) {
            console.error(`❌ 库存不足，需要 ${quantity} 张，仅剩 ${cards.length} 张`);
            return;
        }

        // 更新订单状态（card_id 记录第一张卡，其余通过 order_id 关联）
        await dbRun(`
            UPDATE orders
            SET payment_status = 'paid', card_id = ?, paid_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [cards[0].id, orderId]);

        // 批量更新卡密状态
        for (const card of cards) {
            await dbRun(`
                UPDATE cards
                SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [orderId, card.id]);
        }

        // 更新商品已售数量
        await dbRun(
            'UPDATE products SET sold_count = sold_count + ? WHERE id = ?',
            [cards.length, order.product_id]
        );

        console.log(`✅ 订单 ${orderId} 支付成功，已自动发卡 ${cards.length} 张`);

        // 发送卡密邮件（不阻塞主流程）
        const emailTo = order.user_email || order.buyer_email;
        if (emailTo) {
            sendCardEmail({
                toEmail: emailTo,
                productName: order.product_name,
                cards,
                orderNo: transactionId,
                amount: order.amount,
            }).catch(err => console.error('❌ 邮件发送失败:', err.message));
        }
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
