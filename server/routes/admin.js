const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { processPaymentSuccess } = require('./orders');
const { releaseExpiredReservations, releaseOrderReservation, syncProductStock } = require('../utils/order-helpers');

const router = express.Router();

// 管理操作审计日志
function auditLog(adminEmail, action, detail = '') {
    const timestamp = new Date().toISOString();
    console.log(`[AUDIT] ${timestamp} | ${adminEmail} | ${action} | ${detail}`);
}

// 所有管理接口都需要管理员权限
router.use(authenticateToken, requireAdmin);

// ============================================
// 商品管理
// ============================================

// 添加商品
router.post('/products', async (req, res) => {
    try {
        const { name, description, price, delivery_type } = req.body;

        if (!name || !price) {
            return res.status(400).json({ error: '商品名称和价格不能为空' });
        }

        const result = await dbRun(`
            INSERT INTO products (name, description, price, stock, status, delivery_type)
            VALUES (?, ?, ?, 0, 'out_of_stock', ?)
        `, [name, description, price, delivery_type || 'email']);

        auditLog(req.user.email, 'ADD_PRODUCT', `id=${result.id} name=${name} price=${price}`);
        res.status(201).json({
            message: '商品添加成功',
            productId: result.id
        });
    } catch (error) {
        console.error('添加商品错误:', error);
        res.status(500).json({ error: '添加商品失败' });
    }
});

// 更新商品
router.put('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price, status, delivery_type } = req.body;

        await dbRun(`
            UPDATE products
            SET name = ?, description = ?, price = ?, status = ?, delivery_type = COALESCE(?, delivery_type), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [name, description, price, status, delivery_type || null, id]);

        auditLog(req.user.email, 'UPDATE_PRODUCT', `id=${id} name=${name}`);
        res.json({ message: '商品更新成功' });
    } catch (error) {
        console.error('更新商品错误:', error);
        res.status(500).json({ error: '更新商品失败' });
    }
});

// 删除商品
router.delete('/products/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const existingCard = await dbGet(
            'SELECT id FROM cards WHERE product_id = ? LIMIT 1',
            [id]
        );
        if (existingCard) {
            return res.status(400).json({ error: '该商品仍有关联卡密，删除前请先清理卡密数据' });
        }

        const existingOrder = await dbGet(
            'SELECT id FROM orders WHERE product_id = ? LIMIT 1',
            [id]
        );
        if (existingOrder) {
            return res.status(400).json({ error: '该商品已有订单记录，不能直接删除' });
        }

        await dbRun('DELETE FROM products WHERE id = ?', [id]);

        auditLog(req.user.email, 'DELETE_PRODUCT', `id=${id}`);
        res.json({
            message: '商品删除成功',
            unusedCards: 0
        });
    } catch (error) {
        console.error('删除商品错误:', error);
        res.status(500).json({ error: '删除商品失败' });
    }
});

// ============================================
// 卡密管理
// ============================================

// 批量添加卡密（兼容旧格式 + 新 CDK 导入）
router.post('/cards', async (req, res) => {
    try {
        const { productId, cards, cdkList, cardType } = req.body;

        // 新 CDK 导入模式：cdkList 是换行分隔的字符串
        if (cdkList && productId) {
            const product = await dbGet('SELECT * FROM products WHERE id = ?', [productId]);
            if (!product) return res.status(404).json({ error: '商品不存在' });

            const lines = cdkList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return res.status(400).json({ error: '请输入 CDK' });

            const type = cardType || 'monthly';
            let successCount = 0;
            for (const line of lines) {
                try {
                    await dbRun(
                        'INSERT INTO cards (product_id, card_number, card_password, status, card_type) VALUES (?, ?, ?, "available", ?)',
                        [productId, line, '', type]
                    );
                    successCount++;
                } catch (e) {
                    console.error('插入CDK失败:', line, e.message);
                }
            }

            // 更新库存
            await syncProductStock(productId);

            auditLog(req.user.email, 'IMPORT_CDK', `productId=${productId} success=${successCount}/${lines.length} type=${type}`);
            return res.json({ message: `成功导入 ${successCount} 个 CDK`, successCount, totalCount: lines.length });
        }

        // 旧格式：cards 数组
        if (!productId || !Array.isArray(cards) || cards.length === 0) {
            return res.status(400).json({ error: '参数错误' });
        }

        const product = await dbGet('SELECT * FROM products WHERE id = ?', [productId]);
        if (!product) return res.status(404).json({ error: '商品不存在' });

        let successCount = 0;
        for (const card of cards) {
            try {
                await dbRun(
                    'INSERT INTO cards (product_id, card_number, card_password, status, card_type) VALUES (?, ?, ?, "available", ?)',
                    [productId, card.number, card.password || '', cardType || 'monthly']
                );
                successCount++;
            } catch (error) {
                console.error('插入卡密失败:', card, error);
            }
        }

        await syncProductStock(productId);

        res.json({ message: `成功添加 ${successCount} 张卡密`, successCount, totalCount: cards.length });
    } catch (error) {
        console.error('添加卡密错误:', error);
        res.status(500).json({ error: '添加卡密失败' });
    }
});

// CDK 列表（支持按类型、状态筛选）
router.get('/cdk-list', async (req, res) => {
    try {
        const { type, status } = req.query;
        let sql = `SELECT c.*, o.transaction_id as order_no FROM cards c LEFT JOIN orders o ON c.order_id = o.id WHERE 1=1`;
        const params = [];

        if (type && type !== 'all') { sql += ' AND c.card_type = ?'; params.push(type); }
        if (status && status !== 'all') { sql += ' AND c.status = ?'; params.push(status); }

        sql += ' ORDER BY c.created_at DESC LIMIT 200';
        const cards = await dbAll(sql, params);
        res.json(cards);
    } catch (error) {
        console.error('查询CDK列表错误:', error);
        res.status(500).json({ error: '查询失败' });
    }
});

// 查询商品的所有卡密
router.get('/cards/:productId', async (req, res) => {
    try {
        const { productId } = req.params;

        const cards = await dbAll(`
            SELECT c.*, o.transaction_id, u.email
            FROM cards c
            LEFT JOIN orders o ON c.order_id = o.id
            LEFT JOIN users u ON o.user_id = u.id
            WHERE c.product_id = ?
            ORDER BY c.created_at DESC
        `, [productId]);

        res.json(cards);
    } catch (error) {
        console.error('查询卡密错误:', error);
        res.status(500).json({ error: '查询卡密失败' });
    }
});

// 删除卡密
router.delete('/cards/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const card = await dbGet('SELECT * FROM cards WHERE id = ?', [id]);
        if (!card) {
            return res.status(404).json({ error: '卡密不存在' });
        }

        if (['sold', 'reserved'].includes(card.status)) {
            return res.status(400).json({ error: '已售出或已预占的卡密无法删除' });
        }

        await dbRun('DELETE FROM cards WHERE id = ?', [id]);

        // 更新商品库存
        await syncProductStock(card.product_id);

        res.json({ message: '卡密删除成功' });
    } catch (error) {
        console.error('删除卡密错误:', error);
        res.status(500).json({ error: '删除卡密失败' });
    }
});

// ============================================
// 订单管理
// ============================================

// 获取所有订单
router.get('/orders', async (req, res) => {
    try {
        await releaseExpiredReservations();

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
        const statusFilter = req.query.status || 'all';
        const offset = (page - 1) * pageSize;

        let whereClause = '';
        const params = [];
        if (statusFilter && statusFilter !== 'all') {
            whereClause = 'AND o.payment_status = ?';
            params.push(statusFilter);
        }

        const countResult = await dbGet(`
            SELECT COUNT(*) as total FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE 1=1 ${whereClause}
        `, params);

        const orders = await dbAll(`
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
                o.recharge_status,
                o.created_at,
                o.paid_at,
                COALESCE(u.email, o.buyer_email) as email,
                p.name as product_name,
                c.card_number
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id AND o.user_id != 0
            JOIN products p ON o.product_id = p.id
            LEFT JOIN cards c ON o.card_id = c.id
            WHERE 1=1 ${whereClause}
            ORDER BY
                CASE WHEN o.payment_status = 'confirming' THEN 0 ELSE 1 END,
                o.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, pageSize, offset]);

        res.json({
            orders,
            pagination: {
                page,
                pageSize,
                total: countResult.total,
                totalPages: Math.ceil(countResult.total / pageSize)
            }
        });
    } catch (error) {
        console.error('查询订单错误:', error);
        res.status(500).json({ error: '查询订单失败' });
    }
});

// 确认收款（手动收款模式）
router.post('/orders/:id/confirm', async (req, res) => {
    try {
        const { id } = req.params;
        const order = await dbGet('SELECT * FROM orders WHERE id = ?', [id]);

        if (!order) {
            return res.status(404).json({ error: '订单不存在' });
        }
        if (!['pending', 'confirming'].includes(order.payment_status)) {
            return res.status(400).json({ error: '该订单当前无法确认收款' });
        }
        if (order.payment_status === 'paid') {
            return res.json({ message: '订单已完成' });
        }

        await processPaymentSuccess(order.id, order.transaction_id);
        auditLog(req.user.email, 'CONFIRM_ORDER', `orderId=${id} txn=${order.transaction_id}`);
        res.json({ message: '已确认收款，卡密已自动发送' });
    } catch (error) {
        console.error('确认收款错误:', error);
        res.status(500).json({ error: '确认收款失败' });
    }
});

// 拒绝订单
router.post('/orders/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        await releaseOrderReservation(id, 'cancelled');
        auditLog(req.user.email, 'REJECT_ORDER', `orderId=${id}`);
        res.json({ message: '订单已拒绝' });
    } catch (error) {
        console.error('拒绝订单错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// ============================================
// 统计数据
// ============================================
router.get('/stats', async (req, res) => {
    try {
        await releaseExpiredReservations();

        // 总订单数
        const totalOrders = await dbGet('SELECT COUNT(*) as count FROM orders');

        // 今日订单数
        const todayOrders = await dbGet(`
            SELECT COUNT(*) as count FROM orders
            WHERE DATE(created_at) = DATE('now')
        `);

        // 总销售额
        const totalRevenue = await dbGet(`
            SELECT SUM(amount) as total FROM orders WHERE payment_status = 'paid'
        `);

        // 今日销售额
        const todayRevenue = await dbGet(`
            SELECT SUM(amount) as total FROM orders
            WHERE payment_status = 'paid' AND DATE(created_at) = DATE('now')
        `);

        // 商品统计
        const productStats = await dbAll(`
            SELECT
                p.id,
                p.name,
                COUNT(DISTINCT o.id) as sales_count,
                SUM(CASE WHEN o.payment_status = 'paid' THEN o.amount ELSE 0 END) as revenue,
                (SELECT COUNT(*) FROM cards WHERE product_id = p.id AND status = 'available') as stock
            FROM products p
            LEFT JOIN orders o ON p.id = o.product_id
            GROUP BY p.id
        `);

        res.json({
            totalOrders: totalOrders.count,
            todayOrders: todayOrders.count,
            totalRevenue: totalRevenue.total || 0,
            todayRevenue: todayRevenue.total || 0,
            productStats
        });
    } catch (error) {
        console.error('查询统计数据错误:', error);
        res.status(500).json({ error: '查询统计数据失败' });
    }
});

module.exports = router;
