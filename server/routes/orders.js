const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { authenticateToken } = require('../middleware/auth');
const { createAlipayOrder, createWechatOrder } = require('../utils/payment');
const { sendCardEmail, sendRechargeEmail } = require('../utils/email');
const { recharge, queryRechargeStatus } = require('../utils/ifaka');

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
        const { productId, quantity = 1, email, paymentMethod, chatgptToken } = req.body;

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

        // 自动充值类商品必须提供 ChatGPT Token
        if (product.delivery_type === 'auto_recharge' && !chatgptToken) {
            return res.status(400).json({ error: '请提供 ChatGPT Access Token 以完成自动充值' });
        }

        // 计算阶梯价格
        const unitPrice = await calcUnitPrice(productId, product.price, qty);
        const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

        // 创建订单
        const orderResult = await dbRun(`
            INSERT INTO orders (user_id, buyer_email, product_id, quantity, amount, payment_method, payment_status, chatgpt_token)
            VALUES (0, ?, ?, ?, ?, ?, 'pending', ?)
        `, [email, productId, qty, totalAmount, paymentMethod, chatgptToken || null]);

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

        res.json({ orderId, orderNo, amount: totalAmount, unitPrice, quantity: qty, productName: product.name, paymentMethod, deliveryType: product.delivery_type || 'email', paymentInfo });
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
// 买家标记"我已支付"（手动收款模式）
// ============================================
router.post('/mark-paid/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;
        const order = await dbGet(
            'SELECT * FROM orders WHERE transaction_id = ?', [orderNo]
        );

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }
        if (order.payment_status === 'paid') {
            return res.json({ message: '订单已完成支付' });
        }

        await dbRun(
            "UPDATE orders SET payment_status = 'confirming' WHERE id = ?",
            [order.id]
        );

        res.json({ message: '已提交，等待卖家确认收款', orderNo });
    } catch (error) {
        console.error('标记已支付错误:', error);
        res.status(500).json({ error: '操作失败' });
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
                   o.recharge_status,
                   p.name as product_name, p.delivery_type
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
            productName: order.product_name,
            deliveryType: order.delivery_type || 'email',
            rechargeStatus: order.recharge_status,
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
// 处理支付成功（自动发卡 + 邮件通知 / ifaka 自动充值）
// ============================================
async function processPaymentSuccess(orderId, transactionId) {
    try {
        // 查询订单（含用户邮箱 + 商品交付类型）
        const order = await dbGet(`
            SELECT o.*, u.email as user_email, p.name as product_name, p.delivery_type
            FROM orders o
            JOIN products p ON o.product_id = p.id
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.id = ?
        `, [orderId]);

        if (!order || order.payment_status === 'paid') {
            return;
        }

        const quantity = order.quantity || 1;
        const deliveryType = order.delivery_type || 'email';

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

        // ============ 自动充值模式 ============
        if (deliveryType === 'auto_recharge' && order.chatgpt_token) {
            await processRecharge(order, cards, transactionId);
            return;
        }

        // ============ 邮件发卡模式（默认）============
        await processCardDelivery(order, cards, transactionId);
    } catch (error) {
        console.error('处理支付成功失败:', error);
    }
}

/**
 * 邮件发卡流程（原有逻辑）
 */
async function processCardDelivery(order, cards, transactionId) {
    const quantity = order.quantity || 1;

    // 更新订单状态
    await dbRun(`
        UPDATE orders
        SET payment_status = 'paid', card_id = ?, paid_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `, [cards[0].id, order.id]);

    // 批量更新卡密状态
    for (const card of cards) {
        await dbRun(`
            UPDATE cards
            SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [order.id, card.id]);
    }

    // 更新商品已售数量
    await dbRun(
        'UPDATE products SET sold_count = sold_count + ? WHERE id = ?',
        [cards.length, order.product_id]
    );

    console.log(`✅ 订单 ${order.id} 支付成功，已自动发卡 ${cards.length} 张`);

    // 发送卡密邮件
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
}

/**
 * ifaka 自动充值流程
 */
async function processRecharge(order, cards, transactionId) {
    const card = cards[0]; // 充值一次用一张 CDK

    // 先标记 CDK 为使用中
    await dbRun(
        "UPDATE cards SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP WHERE id = ?",
        [order.id, card.id]
    );

    // 更新订单状态为处理中
    await dbRun(`
        UPDATE orders
        SET payment_status = 'paid', card_id = ?, paid_at = CURRENT_TIMESTAMP,
            recharge_status = 'processing'
        WHERE id = ?
    `, [card.id, order.id]);

    console.log(`⚡ 订单 ${order.id} 开始 ifaka 自动充值，CDK: ${card.card_number.substring(0, 4)}****`);

    try {
        // 调用 ifaka API 充值
        const result = await recharge(card.card_number, order.chatgpt_token, {
            allowOverwrite: false,
            maxSeconds: 120,
        });

        if (result.success) {
            // 充值成功
            await dbRun(`
                UPDATE orders
                SET recharge_status = 'success', recharge_task_id = ?
                WHERE id = ?
            `, [result.taskId, order.id]);

            await dbRun(
                'UPDATE products SET sold_count = sold_count + 1 WHERE id = ?',
                [order.product_id]
            );

            console.log(`✅ 订单 ${order.id} ifaka 充值成功！`);

            // 发送充值成功邮件
            const emailTo = order.user_email || order.buyer_email;
            if (emailTo) {
                sendRechargeEmail({
                    toEmail: emailTo,
                    productName: order.product_name,
                    orderNo: transactionId,
                    amount: order.amount,
                    status: 'success',
                }).catch(err => console.error('❌ 充值邮件发送失败:', err.message));
            }

            // 充值完成后清除敏感的 ChatGPT Token
            await dbRun('UPDATE orders SET chatgpt_token = NULL WHERE id = ?', [order.id]);

        } else {
            // 充值失败
            console.error(`❌ 订单 ${order.id} ifaka 充值失败: ${result.error}`);

            await dbRun(`
                UPDATE orders
                SET recharge_status = 'failed', recharge_task_id = ?
                WHERE id = ?
            `, [result.taskId || null, order.id]);

            // 判断是 CDK 问题还是 Token 问题
            if (result.status === 'TIMEOUT') {
                // 超时 → 不归还 CDK，后台继续轮询
                await dbRun(`UPDATE orders SET recharge_status = 'pending' WHERE id = ?`, [order.id]);
            } else {
                // CDK 可能有问题，标记为无效；如果是 Token 问题，归还 CDK
                // 简单处理：统一标记 CDK 已消耗，管理员后台处理退款
            }

            // 通知用户充值失败
            const emailTo = order.user_email || order.buyer_email;
            if (emailTo) {
                sendRechargeEmail({
                    toEmail: emailTo,
                    productName: order.product_name,
                    orderNo: transactionId,
                    amount: order.amount,
                    status: 'failed',
                    error: result.error,
                }).catch(err => console.error('❌ 失败通知邮件发送失败:', err.message));
            }
        }
    } catch (err) {
        console.error(`❌ 订单 ${order.id} ifaka 充值异常:`, err.message);
        await dbRun(`
            UPDATE orders SET recharge_status = 'failed' WHERE id = ?
        `, [order.id]);
    }
}

// ============================================
// 查询充值状态（前端轮询用）
// ============================================
router.get('/recharge-status/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;
        const order = await dbGet(`
            SELECT o.recharge_status, o.recharge_task_id, o.payment_status
            FROM orders o
            WHERE o.transaction_id = ?
        `, [orderNo]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        // 如果还在处理中且有 taskId，实时查询 ifaka
        if (order.recharge_status === 'processing' && order.recharge_task_id) {
            try {
                const ifakaResult = await queryRechargeStatus(order.recharge_task_id);
                return res.json({
                    rechargeStatus: order.recharge_status,
                    ifakaStatus: ifakaResult.taskStatus,
                    message: ifakaResult.statusMessage || '充值处理中...',
                });
            } catch (e) {
                // ifaka 查询失败，返回本地状态
            }
        }

        res.json({
            rechargeStatus: order.recharge_status,
            paymentStatus: order.payment_status,
        });
    } catch (error) {
        console.error('查询充值状态错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// ============================================
// 游客订单查询（通过邮箱 + 订单号）
// ============================================
router.get('/lookup', async (req, res) => {
    try {
        const { email, orderNo } = req.query;
        if (!email || !orderNo) {
            return res.status(400).json({ error: '请提供邮箱和订单号' });
        }

        const order = await dbGet(`
            SELECT o.*, p.name as product_name, p.delivery_type
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.transaction_id = ? AND o.buyer_email = ?
        `, [orderNo, email]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在或邮箱不匹配' });
        }

        let cards = [];
        if (order.payment_status === 'paid') {
            cards = await dbAll(`
                SELECT card_number, card_password FROM cards
                WHERE order_id = ? AND status = 'sold'
            `, [order.id]);
        }

        res.json({
            orderNo: order.transaction_id,
            productName: order.product_name,
            amount: order.amount,
            quantity: order.quantity,
            status: order.payment_status,
            deliveryType: order.delivery_type || 'email',
            rechargeStatus: order.recharge_status,
            createdAt: order.created_at,
            paidAt: order.paid_at,
            cards: cards,
        });
    } catch (error) {
        console.error('订单查询错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// ============================================
// 订单详情页（支付成功后展示卡密，通过订单号访问）
// ============================================
router.get('/detail/:orderNo', async (req, res) => {
    try {
        const { orderNo } = req.params;

        const order = await dbGet(`
            SELECT o.*, p.name as product_name, p.delivery_type
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.transaction_id = ?
        `, [orderNo]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        let cards = [];
        if (order.payment_status === 'paid') {
            cards = await dbAll(`
                SELECT card_number, card_password FROM cards
                WHERE order_id = ? AND status = 'sold'
            `, [order.id]);
        }

        res.json({
            orderNo: order.transaction_id,
            email: order.buyer_email,
            productName: order.product_name,
            amount: order.amount,
            quantity: order.quantity,
            status: order.payment_status,
            deliveryType: order.delivery_type || 'email',
            rechargeStatus: order.recharge_status,
            createdAt: order.created_at,
            paidAt: order.paid_at,
            cards: cards,
        });
    } catch (error) {
        console.error('订单详情错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

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
module.exports.processPaymentSuccess = processPaymentSuccess;
