const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 所有管理接口都需要管理员权限
router.use(authenticateToken, requireAdmin);

// ============================================
// 商品管理
// ============================================

// 添加商品
router.post('/products', async (req, res) => {
    try {
        const { name, description, price } = req.body;

        if (!name || !price) {
            return res.status(400).json({ error: '商品名称和价格不能为空' });
        }

        const result = await dbRun(`
            INSERT INTO products (name, description, price, stock, status)
            VALUES (?, ?, ?, 0, 'out_of_stock')
        `, [name, description, price]);

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
        const { name, description, price, status } = req.body;

        await dbRun(`
            UPDATE products
            SET name = ?, description = ?, price = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [name, description, price, status, id]);

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

        // 检查是否有未售出的卡密
        const cards = await dbAll('SELECT * FROM cards WHERE product_id = ? AND status = "available"', [id]);

        await dbRun('DELETE FROM products WHERE id = ?', [id]);

        res.json({
            message: '商品删除成功',
            unusedCards: cards.length
        });
    } catch (error) {
        console.error('删除商品错误:', error);
        res.status(500).json({ error: '删除商品失败' });
    }
});

// ============================================
// 卡密管理
// ============================================

// 批量添加卡密
router.post('/cards', async (req, res) => {
    try {
        const { productId, cards } = req.body;

        if (!productId || !Array.isArray(cards) || cards.length === 0) {
            return res.status(400).json({ error: '参数错误' });
        }

        // 检查商品是否存在
        const product = await dbGet('SELECT * FROM products WHERE id = ?', [productId]);
        if (!product) {
            return res.status(404).json({ error: '商品不存在' });
        }

        // 批量插入卡密
        const stmt = 'INSERT INTO cards (product_id, card_number, card_password, status) VALUES (?, ?, ?, "available")';
        let successCount = 0;

        for (const card of cards) {
            try {
                await dbRun(stmt, [productId, card.number, card.password || '']);
                successCount++;
            } catch (error) {
                console.error('插入卡密失败:', card, error);
            }
        }

        // 更新商品库存
        const stockResult = await dbGet(`
            SELECT COUNT(*) as count FROM cards WHERE product_id = ? AND status = 'available'
        `, [productId]);

        await dbRun(`
            UPDATE products SET stock = ?, status = ? WHERE id = ?
        `, [stockResult.count, stockResult.count > 0 ? 'in_stock' : 'out_of_stock', productId]);

        res.json({
            message: `成功添加 ${successCount} 张卡密`,
            successCount,
            totalCount: cards.length
        });
    } catch (error) {
        console.error('添加卡密错误:', error);
        res.status(500).json({ error: '添加卡密失败' });
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

        if (card.status === 'sold') {
            return res.status(400).json({ error: '已售出的卡密无法删除' });
        }

        await dbRun('DELETE FROM cards WHERE id = ?', [id]);

        // 更新商品库存
        const stockResult = await dbGet(`
            SELECT COUNT(*) as count FROM cards WHERE product_id = ? AND status = 'available'
        `, [card.product_id]);

        await dbRun(`
            UPDATE products SET stock = ?, status = ? WHERE id = ?
        `, [stockResult.count, stockResult.count > 0 ? 'in_stock' : 'out_of_stock', card.product_id]);

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
        const orders = await dbAll(`
            SELECT
                o.*,
                u.email,
                p.name as product_name,
                c.card_number
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN products p ON o.product_id = p.id
            LEFT JOIN cards c ON o.card_id = c.id
            ORDER BY o.created_at DESC
        `);

        res.json(orders);
    } catch (error) {
        console.error('查询订单错误:', error);
        res.status(500).json({ error: '查询订单失败' });
    }
});

// ============================================
// 统计数据
// ============================================
router.get('/stats', async (req, res) => {
    try {
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
