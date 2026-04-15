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

// 清洗 accent_color 为有效 HEX，否则返回空
function normalizeHex(raw) {
    if (!raw) return '';
    const v = String(raw).trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
}

// 添加商品
router.post('/products', async (req, res) => {
    try {
        const { name, description, price, delivery_type, is_featured, icon, accent_color } = req.body;

        if (!name || !price) {
            return res.status(400).json({ error: '商品名称和价格不能为空' });
        }

        const result = await dbRun(`
            INSERT INTO products (name, description, price, stock, status, delivery_type, is_featured, icon, accent_color)
            VALUES (?, ?, ?, 0, 'out_of_stock', ?, ?, ?, ?)
        `, [
            name, description, price, delivery_type || 'email',
            is_featured ? 1 : 0,
            String(icon || '').trim().slice(0, 8),
            normalizeHex(accent_color)
        ]);

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
        const { name, description, price, status, delivery_type, is_featured, icon, accent_color } = req.body;

        await dbRun(`
            UPDATE products
            SET name = ?,
                description = ?,
                price = ?,
                status = ?,
                delivery_type = COALESCE(?, delivery_type),
                is_featured = ?,
                icon = ?,
                accent_color = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [
            name, description, price, status,
            delivery_type || null,
            is_featured ? 1 : 0,
            String(icon || '').trim().slice(0, 8),
            normalizeHex(accent_color),
            id
        ]);

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

// ============================================
// 买家邮箱黑名单
// ============================================

// 列表
router.get('/blocked-emails', async (req, res) => {
    try {
        const rows = await dbAll(
            'SELECT email, reason, created_at FROM blocked_emails ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) {
        console.error('查询黑名单错误:', err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 添加
router.post('/blocked-emails', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const reason = String(req.body.reason || '').trim().slice(0, 200);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: '请填写正确的邮箱地址' });
        }
        await dbRun(
            'INSERT OR REPLACE INTO blocked_emails (email, reason, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [email, reason || null]
        );
        auditLog(req.user.email, 'BLOCK_EMAIL', `${email} reason=${reason}`);
        res.json({ message: '已加入黑名单', email });
    } catch (err) {
        console.error('添加黑名单错误:', err);
        res.status(500).json({ error: '添加失败' });
    }
});

// 移除
router.delete('/blocked-emails/:email', async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        const result = await dbRun('DELETE FROM blocked_emails WHERE email = ?', [email]);
        if (!result.changes) {
            return res.status(404).json({ error: '该邮箱不在黑名单' });
        }
        auditLog(req.user.email, 'UNBLOCK_EMAIL', email);
        res.json({ message: '已移除' });
    } catch (err) {
        console.error('移除黑名单错误:', err);
        res.status(500).json({ error: '移除失败' });
    }
});

// ============================================
// 邀请返现
// ============================================

function genRefCode() {
    return 'R' + Math.random().toString(36).slice(2, 10).toUpperCase();
}

// 列出所有邀请码 + 汇总（订单数、累计金额、累计佣金、待结算）
router.get('/referrals/codes', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT rc.code, rc.referrer_name, rc.referrer_contact, rc.commission_rate, rc.note, rc.is_active, rc.created_at,
                   COUNT(rr.id) AS orders_count,
                   COALESCE(SUM(rr.order_amount), 0) AS total_amount,
                   COALESCE(SUM(rr.commission), 0) AS total_commission,
                   COALESCE(SUM(CASE WHEN rr.status='pending' THEN rr.commission ELSE 0 END), 0) AS pending_commission
            FROM referral_codes rc
            LEFT JOIN referral_records rr ON rc.code = rr.referral_code
            GROUP BY rc.code
            ORDER BY rc.created_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('查询邀请码错误:', err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 创建邀请码
router.post('/referrals/codes', async (req, res) => {
    try {
        const { referrer_name, referrer_contact, commission_rate, note, code: customCode } = req.body;
        const code = customCode ? String(customCode).trim().slice(0, 32) : genRefCode();
        if (!/^[A-Za-z0-9_-]{4,32}$/.test(code)) {
            return res.status(400).json({ error: '邀请码格式错误（4-32 位字母数字）' });
        }
        const rate = Math.max(0, Math.min(1, parseFloat(commission_rate) || 0.10));
        await dbRun(`
            INSERT INTO referral_codes (code, referrer_name, referrer_contact, commission_rate, note)
            VALUES (?, ?, ?, ?, ?)
        `, [code, (referrer_name || '').trim().slice(0, 80), (referrer_contact || '').trim().slice(0, 120), rate, (note || '').trim().slice(0, 200)]);
        auditLog(req.user.email, 'CREATE_REFERRAL', `code=${code} name=${referrer_name}`);
        res.json({ message: '已创建', code });
    } catch (err) {
        if (err.message?.includes('UNIQUE')) {
            return res.status(409).json({ error: '该邀请码已存在' });
        }
        console.error('创建邀请码错误:', err);
        res.status(500).json({ error: '创建失败' });
    }
});

// 启用/禁用
router.post('/referrals/codes/:code/toggle', async (req, res) => {
    try {
        const code = req.params.code;
        const existing = await dbGet('SELECT is_active FROM referral_codes WHERE code = ?', [code]);
        if (!existing) return res.status(404).json({ error: '邀请码不存在' });
        const newState = existing.is_active ? 0 : 1;
        await dbRun('UPDATE referral_codes SET is_active = ? WHERE code = ?', [newState, code]);
        auditLog(req.user.email, 'TOGGLE_REFERRAL', `code=${code} active=${newState}`);
        res.json({ message: '已切换', is_active: newState });
    } catch (err) {
        console.error('切换邀请码错误:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

// 返现记录列表
router.get('/referrals/records', async (req, res) => {
    try {
        const code = req.query.code || '';
        const whereClause = code ? 'WHERE rr.referral_code = ?' : '';
        const params = code ? [code] : [];
        const rows = await dbAll(`
            SELECT rr.id, rr.referral_code, rr.order_id, rr.buyer_email,
                   rr.order_amount, rr.commission, rr.status, rr.created_at,
                   o.transaction_id,
                   rc.referrer_name
            FROM referral_records rr
            LEFT JOIN orders o ON rr.order_id = o.id
            LEFT JOIN referral_codes rc ON rr.referral_code = rc.code
            ${whereClause}
            ORDER BY rr.created_at DESC
            LIMIT 200
        `, params);
        res.json(rows);
    } catch (err) {
        console.error('查询返现记录错误:', err);
        res.status(500).json({ error: '查询失败' });
    }
});

// 标记某条记录为已结算
router.post('/referrals/records/:id/mark-paid', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        await dbRun("UPDATE referral_records SET status = 'paid' WHERE id = ?", [id]);
        auditLog(req.user.email, 'PAY_REFERRAL', `id=${id}`);
        res.json({ message: '已标记为已结算' });
    } catch (err) {
        console.error('标记返现错误:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

module.exports = router;
