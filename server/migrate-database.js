/**
 * 数据库迁移脚本
 * 为现有数据库安全添加新字段/表（不破坏已有数据）
 * 运行：npm run migrate-db
 */

const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();
const { resolveDatabasePath, ensureDatabaseDirectory } = require('./utils/db-path');

const dbPath = resolveDatabasePath();
ensureDatabaseDirectory(dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) { console.error('❌ 数据库连接失败:', err.message); process.exit(1); }
    console.log('✅ 连接到数据库');
});

// 安全执行 SQL，失败（如字段已存在）则忽略
function safeRun(sql, desc) {
    return new Promise((resolve) => {
        db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column') && !err.message.includes('already exists')) {
                console.error(`❌ ${desc} 失败:`, err.message);
            } else {
                console.log(`✅ ${desc}`);
            }
            resolve();
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function assertRequiredTables() {
    const requiredTables = ['users', 'products', 'cards', 'orders'];
    const rows = await dbAll(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(', ')})`,
        requiredTables
    );
    const existingNames = new Set(rows.map((row) => row.name));
    const missingTables = requiredTables.filter((tableName) => !existingNames.has(tableName));

    if (missingTables.length > 0) {
        throw new Error(`数据库尚未初始化，缺少数据表: ${missingTables.join(', ')}。请先运行 npm run init-db`);
    }
}

async function migrate() {
    await assertRequiredTables();

    // 1. orders 表：添加 buyer_email（游客购买用）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN buyer_email TEXT`,
        'orders 表添加 buyer_email 字段'
    );

    // 2. orders 表：添加 quantity（购买数量）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN quantity INTEGER DEFAULT 1`,
        'orders 表添加 quantity 字段'
    );

    // 3. products 表：添加 sold_count（已售数量，用于前台展示）
    await safeRun(
        `ALTER TABLE products ADD COLUMN sold_count INTEGER DEFAULT 0`,
        'products 表添加 sold_count 字段'
    );

    // 4. 新建阶梯定价表
    await safeRun(`
        CREATE TABLE IF NOT EXISTS price_tiers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id  INTEGER NOT NULL,
            min_qty     INTEGER NOT NULL,
            max_qty     INTEGER,
            price       REAL NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `, '创建 price_tiers 阶梯定价表');

    // 5. products 表：添加 delivery_type（交付方式）
    await safeRun(
        `ALTER TABLE products ADD COLUMN delivery_type TEXT DEFAULT 'email'`,
        'products 表添加 delivery_type 字段'
    );

    // 6. orders 表：添加 chatgpt_token（自动充值用）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN chatgpt_token TEXT`,
        'orders 表添加 chatgpt_token 字段'
    );

    // 7. orders 表：添加 recharge_task_id（ifaka 充值任务 ID）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN recharge_task_id TEXT`,
        'orders 表添加 recharge_task_id 字段'
    );

    // 8. orders 表：添加 recharge_status（充值状态）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN recharge_status TEXT`,
        'orders 表添加 recharge_status 字段'
    );

    // 9. orders 表：添加 paid_at（支付时间）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN paid_at DATETIME`,
        'orders 表添加 paid_at 字段'
    );

    // 9.1 orders 表：添加 order_access_token_hash（订单访问令牌哈希）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN order_access_token_hash TEXT`,
        'orders 表添加 order_access_token_hash 字段'
    );

    // 9.2 orders 表：添加 reservation_expires_at（库存预占过期时间）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN reservation_expires_at DATETIME`,
        'orders 表添加 reservation_expires_at 字段'
    );

    // 9.3 orders 表：添加 payment_payload（支付页恢复数据）
    await safeRun(
        `ALTER TABLE orders ADD COLUMN payment_payload TEXT`,
        'orders 表添加 payment_payload 字段'
    );

    // 10. cards 表：添加 card_type（CDK 类型：月卡/年卡）
    await safeRun(
        `ALTER TABLE cards ADD COLUMN card_type TEXT DEFAULT 'monthly'`,
        'cards 表添加 card_type 字段'
    );

    // 11. cards 表：添加 error_info（充值失败原因）
    await safeRun(
        `ALTER TABLE cards ADD COLUMN error_info TEXT`,
        'cards 表添加 error_info 字段'
    );

    // 12. cards 表：添加 used_at（使用时间）
    await safeRun(
        `ALTER TABLE cards ADD COLUMN used_at DATETIME`,
        'cards 表添加 used_at 字段'
    );

    // 13. cards 表：card_number 唯一索引（防止重复导入同一张 CDK）
    await safeRun(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_card_number ON cards(card_number)`,
        '创建 cards.card_number 唯一索引'
    );

    // 14. 同步已有订单的 sold_count（从历史订单反算）
    await safeRun(`
        UPDATE products
        SET sold_count = (
            SELECT COUNT(*) FROM orders
            WHERE orders.product_id = products.id
            AND orders.payment_status = 'paid'
        )
    `, '同步历史已售数量');

    // 15. 关键查询索引（提升订单查询、回调处理、过期清理性能）
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders(transaction_id)`,
        '创建 orders.transaction_id 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_orders_buyer_email ON orders(buyer_email)`,
        '创建 orders.buyer_email 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
        '创建 orders.user_id 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status)`,
        '创建 orders.payment_status 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_orders_reservation_expires ON orders(reservation_expires_at)`,
        '创建 orders.reservation_expires_at 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_cards_order_id ON cards(order_id)`,
        '创建 cards.order_id 索引'
    );
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status)`,
        '创建 cards(product_id, status) 复合索引'
    );

    // 16. 买家邮箱黑名单（反滥用 / 手动拉黑问题买家）
    await safeRun(`
        CREATE TABLE IF NOT EXISTS blocked_emails (
            email TEXT PRIMARY KEY,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, '创建 blocked_emails 表');

    // 17. 商品视觉字段：is_featured 徽章、icon (emoji 或文字)、accent_color (HEX 主题色)
    await safeRun(
        `ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`,
        'products 表添加 is_featured 字段'
    );
    await safeRun(
        `ALTER TABLE products ADD COLUMN icon TEXT DEFAULT ''`,
        'products 表添加 icon 字段'
    );
    await safeRun(
        `ALTER TABLE products ADD COLUMN accent_color TEXT DEFAULT ''`,
        'products 表添加 accent_color 字段'
    );

    // 18. 邀请返现系统
    await safeRun(`
        CREATE TABLE IF NOT EXISTS referral_codes (
            code            TEXT PRIMARY KEY,
            referrer_name   TEXT,
            referrer_contact TEXT,
            commission_rate REAL DEFAULT 0.10,
            note            TEXT,
            is_active       INTEGER DEFAULT 1,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, '创建 referral_codes 表');
    await safeRun(`
        CREATE TABLE IF NOT EXISTS referral_records (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            referral_code TEXT NOT NULL,
            order_id      INTEGER NOT NULL,
            buyer_email   TEXT,
            order_amount  REAL,
            commission    REAL,
            status        TEXT DEFAULT 'pending',
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (referral_code) REFERENCES referral_codes(code),
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    `, '创建 referral_records 表');
    await safeRun(
        `CREATE INDEX IF NOT EXISTS idx_referral_records_code ON referral_records(referral_code)`,
        '创建 referral_records.referral_code 索引'
    );
    await safeRun(
        `ALTER TABLE orders ADD COLUMN referral_code TEXT`,
        'orders 表添加 referral_code 字段'
    );

    console.log('\n🎉 数据库迁移完成！');
    db.close();
    process.exit(0);
}

migrate().catch(err => {
    console.error('迁移失败:', err);
    db.close();
    process.exit(1);
});
