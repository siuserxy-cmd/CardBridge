const express = require('express');
const { dbGet, dbAll, dbRun } = require('../utils/database');
const { releaseExpiredReservations } = require('../utils/order-helpers');

const router = express.Router();

// ============================================
// 获取所有商品（前台）
// ============================================
router.get('/', async (req, res) => {
    try {
        await releaseExpiredReservations();

        const products = await dbAll(`
            SELECT
                p.id,
                p.name,
                p.description,
                p.price,
                p.stock,
                p.sold_count,
                p.status,
                p.delivery_type,
                p.is_featured,
                p.icon,
                p.accent_color,
                COUNT(c.id) as available_cards
            FROM products p
            LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
            GROUP BY p.id
            ORDER BY p.is_featured DESC, p.created_at DESC
        `);

        // 更新商品状态
        for (const product of products) {
            const newStatus = product.available_cards > 0 ? 'in_stock' : 'out_of_stock';
            if (product.status !== newStatus) {
                await dbRun('UPDATE products SET status = ?, stock = ? WHERE id = ?', [
                    newStatus,
                    product.available_cards,
                    product.id
                ]);
                product.status = newStatus;
                product.stock = product.available_cards;
            }
        }

        res.setHeader('Cache-Control', 'public, s-maxage=30, max-age=10'); // CDN 缓存 30s，浏览器 10s
        res.json(products);
    } catch (error) {
        console.error('获取商品列表错误:', error);
        res.status(500).json({ error: '获取商品列表失败' });
    }
});

// ============================================
// 获取单个商品详情（含阶梯定价）
// ============================================
router.get('/:id', async (req, res) => {
    try {
        await releaseExpiredReservations();

        const { id } = req.params;

        const product = await dbGet(`
            SELECT
                p.*,
                COUNT(c.id) as available_cards
            FROM products p
            LEFT JOIN cards c ON p.id = c.product_id AND c.status = 'available'
            WHERE p.id = ?
            GROUP BY p.id
        `, [id]);

        if (!product) {
            return res.status(404).json({ error: '商品不存在' });
        }

        // 同步库存状态
        const newStatus = product.available_cards > 0 ? 'in_stock' : 'out_of_stock';
        if (product.status !== newStatus) {
            await dbRun('UPDATE products SET status = ?, stock = ? WHERE id = ?',
                [newStatus, product.available_cards, id]);
            product.status = newStatus;
            product.stock = product.available_cards;
        }

        // 查询阶梯定价
        const tiers = await dbAll(
            'SELECT * FROM price_tiers WHERE product_id = ? ORDER BY min_qty ASC',
            [id]
        );
        product.tiers = tiers;

        res.setHeader('Cache-Control', 'public, s-maxage=30, max-age=10');
        res.json(product);
    } catch (error) {
        console.error('获取商品详情错误:', error);
        res.status(500).json({ error: '获取商品详情失败' });
    }
});

module.exports = router;
