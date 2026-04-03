const express = require('express');
const { dbGet, dbAll, dbRun, dbTransaction } = require('../utils/database');
const { authenticateToken, authenticateTokenOptional } = require('../middleware/auth');
const {
    createAlipayOrder,
    verifyAlipayCallback,
    createWechatOrder,
    verifyWechatCallback,
    decryptWechatCallback
} = require('../utils/payment');
const { sendCardEmail, sendRechargeEmail } = require('../utils/email');
const { recharge, queryRechargeStatus } = require('../utils/ifaka');
const { decryptText, encryptText, generateSecureToken, hashToken, tokenMatchesHash } = require('../utils/crypto');
const {
    MANUAL_CONFIRM_MINUTES,
    RESERVATION_MINUTES,
    minutesFromNow,
    parsePaymentPayload,
    releaseExpiredReservations,
    releaseOrderReservation,
    serializePaymentPayload,
    syncProductStock
} = require('../utils/order-helpers');

const router = express.Router();

function createHttpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function getOrderAccessToken(req) {
    const tokenFromQuery = req.query?.t || req.query?.token;
    const tokenFromHeader = req.headers['x-order-token'];
    const tokenFromBody = req.body?.accessToken;

    return String(tokenFromQuery || tokenFromHeader || tokenFromBody || '').trim();
}

function buildOrderLinks(orderNo, accessToken) {
    const appUrl = process.env.APP_URL || '';

    if (!appUrl || !accessToken) {
        return {};
    }

    const encodedOrderNo = encodeURIComponent(orderNo);
    const encodedToken = encodeURIComponent(accessToken);

    return {
        paymentUrl: `${appUrl}/payment/${encodedOrderNo}?t=${encodedToken}`,
        orderUrl: `${appUrl}/order/${encodedOrderNo}?t=${encodedToken}`
    };
}

function normalizeQuantity(product, quantity) {
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    if (product.delivery_type === 'auto_recharge') {
        return 1;
    }

    return qty;
}

async function calcUnitPrice(productId, basePrice, quantity, runner = { dbAll }) {
    const tiers = await runner.dbAll(
        'SELECT * FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC',
        [productId]
    );

    if (!tiers.length) {
        return basePrice;
    }

    for (let i = tiers.length - 1; i >= 0; i -= 1) {
        const tier = tiers[i];
        if (quantity >= tier.min_qty && (tier.max_qty === null || quantity <= tier.max_qty)) {
            return tier.price;
        }
    }

    return basePrice;
}

async function loadProductForCheckout(productId, runner = { dbGet }) {
    return runner.dbGet(`
        SELECT p.*, COUNT(c.id) AS available_cards
        FROM products p
        LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
        WHERE p.id = ?
        GROUP BY p.id
    `, [productId]);
}

function orderAccessible(req, order) {
    if (!order) return false;

    if (req.user?.isAdmin) {
        return true;
    }

    if (req.user?.userId && order.user_id && req.user.userId === order.user_id) {
        return true;
    }

    return tokenMatchesHash(getOrderAccessToken(req), order.order_access_token_hash);
}

function assertOrderAccess(req, res, order) {
    if (orderAccessible(req, order)) {
        return true;
    }

    res.status(403).json({ error: '订单访问令牌无效或已失效' });
    return false;
}

async function getOrderByNo(orderNo) {
    return dbGet(`
        SELECT
            o.id,
            o.user_id,
            o.buyer_email,
            o.product_id,
            o.quantity,
            o.amount,
            o.payment_method,
            o.payment_status,
            o.transaction_id,
            o.card_id,
            o.chatgpt_token,
            o.recharge_task_id,
            o.recharge_status,
            o.created_at,
            o.paid_at,
            o.reservation_expires_at,
            o.order_access_token_hash,
            o.payment_payload,
            p.name AS product_name,
            p.delivery_type
        FROM orders o
        JOIN products p ON o.product_id = p.id
        WHERE o.transaction_id = ?
    `, [orderNo]);
}

function buildStatusResponse(order) {
    const paymentPayload = parsePaymentPayload(order.payment_payload);

    return {
        orderNo: order.transaction_id,
        status: order.payment_status,
        amount: order.amount,
        quantity: order.quantity,
        productName: order.product_name,
        deliveryType: order.delivery_type || 'email',
        rechargeStatus: order.recharge_status,
        paymentMethod: order.payment_method,
        expiresAt: order.reservation_expires_at,
        manualMode: !!paymentPayload.manualMode,
        qrImage: paymentPayload.qrImage || '',
        contactInfo: paymentPayload.contactInfo || '',
        payUrl: paymentPayload.payUrl || '',
        codeUrl: paymentPayload.codeUrl || ''
    };
}

async function createReservedOrder({ userId = 0, buyerEmail = null, productId, quantity = 1, paymentMethod, chatgptToken = '' }) {
    await releaseExpiredReservations();

    const accessToken = generateSecureToken();
    const encryptedChatgptToken = chatgptToken ? encryptText(chatgptToken) : null;

    return dbTransaction(async (runner) => {
        const product = await loadProductForCheckout(productId, runner);
        if (!product) {
            throw createHttpError(404, '商品不存在');
        }

        const qty = normalizeQuantity(product, quantity);

        if (product.delivery_type === 'auto_recharge' && qty !== 1) {
            throw createHttpError(400, '自动充值商品仅支持购买 1 件');
        }

        if (product.delivery_type === 'auto_recharge' && !encryptedChatgptToken) {
            throw createHttpError(400, '请提供 ChatGPT Access Token 以完成自动充值');
        }

        if (product.available_cards < qty) {
            throw createHttpError(400, `库存不足，当前仅剩 ${product.available_cards} 件`);
        }

        const unitPrice = await calcUnitPrice(productId, product.price, qty, runner);
        const totalAmount = parseFloat((unitPrice * qty).toFixed(2));

        const orderResult = await runner.dbRun(`
            INSERT INTO orders (
                user_id, buyer_email, product_id, quantity, amount, payment_method,
                payment_status, chatgpt_token
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `, [userId, buyerEmail, productId, qty, totalAmount, paymentMethod, encryptedChatgptToken]);

        const orderId = orderResult.id;
        const orderNo = `ORD${Date.now()}${orderId}`;
        const reservationExpiresAt = minutesFromNow(RESERVATION_MINUTES);

        await runner.dbRun(`
            UPDATE orders
            SET transaction_id = ?, order_access_token_hash = ?, reservation_expires_at = ?
            WHERE id = ?
        `, [orderNo, hashToken(accessToken), reservationExpiresAt, orderId]);

        const reservedCards = await runner.dbAll(`
            SELECT id
            FROM cards
            WHERE product_id = ? AND status = 'available'
            ORDER BY id ASC
            LIMIT ?
        `, [productId, qty]);

        if (reservedCards.length < qty) {
            throw createHttpError(400, `库存不足，当前仅剩 ${reservedCards.length} 件`);
        }

        const placeholders = reservedCards.map(() => '?').join(', ');
        const reserveResult = await runner.dbRun(
            `UPDATE cards
             SET status = 'reserved', order_id = ?
             WHERE id IN (${placeholders}) AND status = 'available'`,
            [orderId, ...reservedCards.map(card => card.id)]
        );

        if (reserveResult.changes !== reservedCards.length) {
            throw createHttpError(409, '库存已变动，请刷新后重试');
        }

        await syncProductStock(productId, runner);

        return {
            orderId,
            orderNo,
            accessToken,
            product,
            quantity: qty,
            totalAmount,
            unitPrice,
            reservationExpiresAt
        };
    });
}

async function createPaymentForReservedOrder(orderMeta) {
    try {
        const paymentInfo = orderMeta.paymentMethod === 'alipay'
            ? await createAlipayOrder({
                orderId: orderMeta.orderNo,
                amount: orderMeta.totalAmount,
                subject: orderMeta.product.name,
                description: `${orderMeta.product.name} x${orderMeta.quantity}`,
                accessToken: orderMeta.accessToken
            })
            : await createWechatOrder({
                orderId: orderMeta.orderNo,
                amount: orderMeta.totalAmount,
                subject: orderMeta.product.name,
                description: `${orderMeta.product.name} x${orderMeta.quantity}`
            });

        await dbRun(
            'UPDATE orders SET payment_payload = ? WHERE id = ?',
            [serializePaymentPayload({ ...paymentInfo, paymentMethod: orderMeta.paymentMethod }), orderMeta.orderId]
        );

        return paymentInfo;
    } catch (error) {
        await releaseOrderReservation(orderMeta.orderId, 'cancelled');
        throw createHttpError(502, '创建支付失败，请稍后重试');
    }
}

async function getCardsForOrder(orderId, quantity, productId) {
    let cards = await dbAll(`
        SELECT *
        FROM cards
        WHERE order_id = ? AND status = 'reserved'
        ORDER BY id ASC
        LIMIT ?
    `, [orderId, quantity]);

    if (cards.length >= quantity) {
        return cards;
    }

    cards = await dbAll(`
        SELECT *
        FROM cards
        WHERE product_id = ? AND status = 'available'
        ORDER BY id ASC
        LIMIT ?
    `, [productId, quantity]);

    return cards;
}

async function processCardDelivery(order, cards, transactionId) {
    await dbRun(`
        UPDATE orders
        SET payment_status = 'paid',
            card_id = ?,
            paid_at = CURRENT_TIMESTAMP,
            reservation_expires_at = NULL
        WHERE id = ?
    `, [cards[0].id, order.id]);

    for (const card of cards) {
        await dbRun(`
            UPDATE cards
            SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [order.id, card.id]);
    }

    await dbRun(
        'UPDATE products SET sold_count = sold_count + ? WHERE id = ?',
        [cards.length, order.product_id]
    );
    await syncProductStock(order.product_id);

    const emailTo = order.user_email || order.buyer_email;
    if (emailTo) {
        sendCardEmail({
            toEmail: emailTo,
            productName: order.product_name,
            cards,
            orderNo: transactionId,
            amount: order.amount
        }).catch(err => console.error('❌ 邮件发送失败:', err.message));
    }
}

async function processRecharge(order, cards, transactionId) {
    const card = cards[0];

    await dbRun(
        "UPDATE cards SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP WHERE id = ?",
        [order.id, card.id]
    );

    await dbRun(`
        UPDATE orders
        SET payment_status = 'paid',
            card_id = ?,
            paid_at = CURRENT_TIMESTAMP,
            recharge_status = 'processing',
            reservation_expires_at = NULL
        WHERE id = ?
    `, [card.id, order.id]);

    try {
        const result = await recharge(card.card_number, order.chatgpt_token, {
            allowOverwrite: false,
            maxSeconds: 120
        });

        if (result.success) {
            await dbRun(`
                UPDATE orders
                SET recharge_status = 'success', recharge_task_id = ?, chatgpt_token = NULL
                WHERE id = ?
            `, [result.taskId, order.id]);

            await dbRun(
                'UPDATE products SET sold_count = sold_count + 1 WHERE id = ?',
                [order.product_id]
            );
            await syncProductStock(order.product_id);

            const emailTo = order.user_email || order.buyer_email;
            if (emailTo) {
                sendRechargeEmail({
                    toEmail: emailTo,
                    productName: order.product_name,
                    orderNo: transactionId,
                    amount: order.amount,
                    status: 'success'
                }).catch(err => console.error('❌ 充值邮件发送失败:', err.message));
            }

            return;
        }

        await dbRun(`
            UPDATE orders
            SET recharge_status = ?, recharge_task_id = ?, chatgpt_token = NULL
            WHERE id = ?
        `, [result.status === 'TIMEOUT' ? 'pending' : 'failed', result.taskId || null, order.id]);
        await syncProductStock(order.product_id);

        const emailTo = order.user_email || order.buyer_email;
        if (emailTo && result.status !== 'TIMEOUT') {
            sendRechargeEmail({
                toEmail: emailTo,
                productName: order.product_name,
                orderNo: transactionId,
                amount: order.amount,
                status: 'failed',
                error: result.error
            }).catch(err => console.error('❌ 失败通知邮件发送失败:', err.message));
        }
    } catch (error) {
        await dbRun(
            "UPDATE orders SET recharge_status = 'failed', chatgpt_token = NULL WHERE id = ?",
            [order.id]
        );
        await syncProductStock(order.product_id);
        throw error;
    }
}

async function processPaymentSuccess(orderId, transactionId) {
    const order = await dbGet(`
        SELECT o.*, u.email AS user_email, p.name AS product_name, p.delivery_type
        FROM orders o
        JOIN products p ON o.product_id = p.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
    `, [orderId]);

    if (!order) {
        throw createHttpError(404, '订单不存在');
    }

    if (order.payment_status === 'paid') {
        return { alreadyPaid: true };
    }

    if (['cancelled', 'expired'].includes(order.payment_status)) {
        throw createHttpError(409, '订单已失效，无法继续发货');
    }

    const quantity = order.quantity || 1;
    const cards = await getCardsForOrder(order.id, quantity, order.product_id);

    if (cards.length < quantity) {
        throw createHttpError(409, `库存不足，需要 ${quantity} 张，仅剩 ${cards.length} 张`);
    }

    if ((order.delivery_type || 'email') === 'auto_recharge') {
        const decryptedToken = order.chatgpt_token ? decryptText(order.chatgpt_token) : '';
        if (!decryptedToken) {
            throw createHttpError(400, '订单缺少有效的充值凭证');
        }

        await processRecharge({ ...order, chatgpt_token: decryptedToken }, cards, transactionId);
        return { paid: true, recharge: true };
    }

    await processCardDelivery(order, cards, transactionId);
    return { paid: true };
}

function respondWithError(res, error, fallback = '操作失败，请稍后重试') {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || fallback });
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

        const orderMeta = await createReservedOrder({
            buyerEmail: email,
            productId,
            quantity,
            paymentMethod,
            chatgptToken
        });
        const paymentInfo = await createPaymentForReservedOrder({ ...orderMeta, paymentMethod });

        res.json({
            orderId: orderMeta.orderId,
            orderNo: orderMeta.orderNo,
            amount: orderMeta.totalAmount,
            unitPrice: orderMeta.unitPrice,
            quantity: orderMeta.quantity,
            productName: orderMeta.product.name,
            paymentMethod,
            deliveryType: orderMeta.product.delivery_type || 'email',
            paymentInfo,
            accessToken: orderMeta.accessToken,
            expiresAt: orderMeta.reservationExpiresAt,
            ...buildOrderLinks(orderMeta.orderNo, orderMeta.accessToken)
        });
    } catch (error) {
        respondWithError(res, error, '创建订单失败，请稍后重试');
    }
});

// ============================================
// 创建订单并发起支付（登录用户）
// ============================================
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { productId, quantity = 1, paymentMethod, chatgptToken } = req.body;

        if (!['alipay', 'wechat'].includes(paymentMethod)) {
            return res.status(400).json({ error: '不支持的支付方式' });
        }

        const user = await dbGet('SELECT email FROM users WHERE id = ?', [req.user.userId]);
        const orderMeta = await createReservedOrder({
            userId: req.user.userId,
            buyerEmail: user?.email || null,
            productId,
            quantity,
            paymentMethod,
            chatgptToken
        });
        const paymentInfo = await createPaymentForReservedOrder({ ...orderMeta, paymentMethod });

        res.json({
            orderId: orderMeta.orderId,
            orderNo: orderMeta.orderNo,
            amount: orderMeta.totalAmount,
            unitPrice: orderMeta.unitPrice,
            quantity: orderMeta.quantity,
            productName: orderMeta.product.name,
            paymentMethod,
            deliveryType: orderMeta.product.delivery_type || 'email',
            paymentInfo,
            accessToken: orderMeta.accessToken,
            expiresAt: orderMeta.reservationExpiresAt,
            ...buildOrderLinks(orderMeta.orderNo, orderMeta.accessToken)
        });
    } catch (error) {
        respondWithError(res, error, '创建订单失败，请稍后重试');
    }
});

// ============================================
// 买家标记"我已支付"（手动收款模式）
// ============================================
router.post('/mark-paid/:orderNo', authenticateTokenOptional, async (req, res) => {
    try {
        await releaseExpiredReservations();

        const order = await getOrderByNo(req.params.orderNo);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        if (!assertOrderAccess(req, res, order)) {
            return;
        }

        const paymentPayload = parsePaymentPayload(order.payment_payload);
        if (!paymentPayload.manualMode) {
            return res.status(400).json({ error: '该订单不支持手动确认支付' });
        }

        if (order.payment_status === 'paid') {
            return res.json({ message: '订单已完成支付', expiresAt: order.reservation_expires_at });
        }

        if (['cancelled', 'expired'].includes(order.payment_status)) {
            return res.status(400).json({ error: '订单已失效，请重新下单' });
        }

        const expiresAt = minutesFromNow(MANUAL_CONFIRM_MINUTES);
        await dbRun(
            `UPDATE orders
             SET payment_status = 'confirming', reservation_expires_at = ?
             WHERE id = ? AND payment_status IN ('pending', 'confirming')`,
            [expiresAt, order.id]
        );

        res.json({ message: '已提交，等待卖家确认收款', orderNo: order.transaction_id, expiresAt });
    } catch (error) {
        respondWithError(res, error);
    }
});

// ============================================
// 查询订单支付状态（供前端轮询）
// ============================================
router.get('/status/:orderNo', authenticateTokenOptional, async (req, res) => {
    try {
        await releaseExpiredReservations();

        const order = await getOrderByNo(req.params.orderNo);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        if (!assertOrderAccess(req, res, order)) {
            return;
        }

        res.json(buildStatusResponse(order));
    } catch (error) {
        respondWithError(res, error, '查询失败');
    }
});

// ============================================
// 测试支付（仅用于开发测试）
// ============================================
router.get('/test-pay/:orderNo', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).send('<h1>测试支付在生产环境下已禁用</h1>');
    }

    try {
        const order = await getOrderByNo(req.params.orderNo);
        if (!order) {
            return res.status(404).send('<h1>订单不存在</h1>');
        }

        await processPaymentSuccess(order.id, order.transaction_id);
        res.send('<h1>测试支付完成，请使用订单查询页或新的安全订单链接查看结果。</h1>');
    } catch (error) {
        console.error('测试支付错误:', error);
        res.status(500).send('<h1>支付处理失败</h1>');
    }
});

// ============================================
// 查询充值状态（前端轮询用）
// ============================================
router.get('/recharge-status/:orderNo', authenticateTokenOptional, async (req, res) => {
    try {
        await releaseExpiredReservations();

        const order = await getOrderByNo(req.params.orderNo);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        if (!assertOrderAccess(req, res, order)) {
            return;
        }

        if (order.recharge_status === 'processing' && order.recharge_task_id) {
            try {
                const ifakaResult = await queryRechargeStatus(order.recharge_task_id);
                return res.json({
                    rechargeStatus: order.recharge_status,
                    paymentStatus: order.payment_status,
                    ifakaStatus: ifakaResult.taskStatus,
                    message: ifakaResult.statusMessage || '充值处理中...'
                });
            } catch (error) {
                // ignore and fall through to local status
            }
        }

        res.json({
            rechargeStatus: order.recharge_status,
            paymentStatus: order.payment_status
        });
    } catch (error) {
        respondWithError(res, error, '查询失败');
    }
});

// ============================================
// 游客订单查询（通过邮箱 + 订单号）
// ============================================
router.get('/lookup', async (req, res) => {
    try {
        await releaseExpiredReservations();

        const { email, orderNo } = req.query;
        if (!email || !orderNo) {
            return res.status(400).json({ error: '请提供邮箱和订单号' });
        }

        const order = await dbGet(`
            SELECT o.*, p.name AS product_name, p.delivery_type
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
                SELECT card_number, card_password
                FROM cards
                WHERE order_id = ? AND status = 'sold'
                ORDER BY id ASC
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
            cards
        });
    } catch (error) {
        respondWithError(res, error, '查询失败');
    }
});

// ============================================
// 订单详情页（支付成功后展示卡密，通过订单号访问）
// ============================================
router.get('/detail/:orderNo', authenticateTokenOptional, async (req, res) => {
    try {
        await releaseExpiredReservations();

        const order = await getOrderByNo(req.params.orderNo);
        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        if (!assertOrderAccess(req, res, order)) {
            return;
        }

        let cards = [];
        if (order.payment_status === 'paid') {
            cards = await dbAll(`
                SELECT card_number, card_password
                FROM cards
                WHERE order_id = ? AND status = 'sold'
                ORDER BY id ASC
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
            cards
        });
    } catch (error) {
        respondWithError(res, error, '查询失败');
    }
});

// ============================================
// 查询订单详情（登录用户）
// ============================================
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const order = await dbGet(`
            SELECT
                o.id,
                o.transaction_id,
                o.quantity,
                o.amount,
                o.payment_method,
                o.payment_status,
                o.recharge_status,
                o.created_at,
                o.paid_at,
                p.name AS product_name,
                p.description AS product_description
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.id = ? AND o.user_id = ?
        `, [req.params.id, req.user.userId]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }

        const cards = order.payment_status === 'paid'
            ? await dbAll(`
                SELECT card_number, card_password
                FROM cards
                WHERE order_id = ? AND status = 'sold'
                ORDER BY id ASC
            `, [order.id])
            : [];

        res.json({ ...order, cards });
    } catch (error) {
        respondWithError(res, error, '查询订单失败');
    }
});

// ============================================
// 获取用户所有订单
// ============================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const orders = await dbAll(`
            SELECT
                o.id,
                o.transaction_id,
                o.quantity,
                o.amount,
                o.payment_method,
                o.payment_status,
                o.recharge_status,
                o.created_at,
                o.paid_at,
                p.name AS product_name
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `, [req.user.userId]);

        res.json(orders);
    } catch (error) {
        respondWithError(res, error, '查询订单列表失败');
    }
});

// ============================================
// 支付宝回调（生产环境）
// ============================================
router.post('/alipay-callback', async (req, res) => {
    try {
        const isValid = await verifyAlipayCallback(req.body);
        if (!isValid) {
            return res.status(400).send('fail');
        }

        const { out_trade_no: orderNo, trade_status: tradeStatus } = req.body;
        if (!orderNo) {
            return res.status(400).send('fail');
        }

        if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
            const order = await getOrderByNo(orderNo);
            if (order) {
                await processPaymentSuccess(order.id, orderNo);
            }
        }

        res.send('success');
    } catch (error) {
        console.error('支付宝回调错误:', error);
        res.status(500).send('fail');
    }
});

// ============================================
// 微信支付回调（生产环境）
// ============================================
router.post('/wechat-callback', async (req, res) => {
    try {
        const isValid = await verifyWechatCallback({
            timestamp: req.headers['wechatpay-timestamp'],
            nonce: req.headers['wechatpay-nonce'],
            body: req.rawBody || req.body,
            serial: req.headers['wechatpay-serial'],
            signature: req.headers['wechatpay-signature'],
            apiSecret: process.env.WECHAT_APIV3_KEY
        });

        if (!isValid) {
            return res.status(400).json({ code: 'FAIL', message: '签名校验失败' });
        }

        const payload = decryptWechatCallback(req.body.resource);
        const orderNo = payload?.out_trade_no;
        const tradeState = payload?.trade_state;

        if (!orderNo) {
            return res.status(400).json({ code: 'FAIL', message: '缺少订单号' });
        }

        if (tradeState === 'SUCCESS') {
            const order = await getOrderByNo(orderNo);
            if (order) {
                await processPaymentSuccess(order.id, orderNo);
            }
        }

        res.json({ code: 'SUCCESS', message: '成功' });
    } catch (error) {
        console.error('微信支付回调错误:', error);
        res.status(500).json({ code: 'FAIL', message: '失败' });
    }
});

module.exports = router;
module.exports.processPaymentSuccess = processPaymentSuccess;
