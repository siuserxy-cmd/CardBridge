const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { resolveDatabasePath, ensureDatabaseDirectory } = require('./utils/db-path');

// 数据库路径
const dbPath = resolveDatabasePath();
const dbDir = ensureDatabaseDirectory(dbPath);

if (dbDir) {
    console.log(`📁 数据库路径: ${dbPath}`);
}

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
        process.exit(1);
    }
    console.log('✅ 连接到 SQLite 数据库');
});

// 初始化数据库表
async function initDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. 用户表
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    is_admin INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ 创建用户表失败:', err.message);
                } else {
                    console.log('✅ 用户表创建成功');
                }
            });

            // 2. 商品表
            db.run(`
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    price REAL NOT NULL,
                    stock INTEGER DEFAULT 0,
                    sold_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'in_stock',
                    delivery_type TEXT DEFAULT 'email',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ 创建商品表失败:', err.message);
                } else {
                    console.log('✅ 商品表创建成功');
                }
            });

            // 3. 卡密表
            db.run(`
                CREATE TABLE IF NOT EXISTS cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER NOT NULL,
                    card_number TEXT NOT NULL,
                    card_password TEXT,
                    status TEXT DEFAULT 'available',
                    order_id INTEGER,
                    sold_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ 创建卡密表失败:', err.message);
                } else {
                    console.log('✅ 卡密表创建成功');
                }
            });

            // 4. 订单表
            db.run(`
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 0,
                    buyer_email TEXT,
                    product_id INTEGER NOT NULL,
                    quantity INTEGER DEFAULT 1,
                    amount REAL NOT NULL,
                    payment_method TEXT NOT NULL,
                    payment_status TEXT DEFAULT 'pending',
                    transaction_id TEXT,
                    order_access_token_hash TEXT,
                    reservation_expires_at DATETIME,
                    payment_payload TEXT,
                    card_id INTEGER,
                    chatgpt_token TEXT,
                    recharge_task_id TEXT,
                    recharge_status TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    paid_at DATETIME,
                    FOREIGN KEY (product_id) REFERENCES products(id),
                    FOREIGN KEY (card_id) REFERENCES cards(id)
                )
            `, async (err) => {
                if (err) {
                    console.error('❌ 创建订单表失败:', err.message);
                    reject(err);
                } else {
                    console.log('✅ 订单表创建成功');
                    // 5. 阶梯定价表
                    db.run(`
                        CREATE TABLE IF NOT EXISTS price_tiers (
                            id          INTEGER PRIMARY KEY AUTOINCREMENT,
                            product_id  INTEGER NOT NULL,
                            min_qty     INTEGER NOT NULL,
                            max_qty     INTEGER,
                            price       REAL NOT NULL,
                            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                        )
                    `, async (err2) => {
                        if (err2) console.error('❌ 创建阶梯定价表失败:', err2.message);
                        else console.log('✅ 阶梯定价表创建成功');
                        await insertDefaultData();
                        resolve();
                    });
                }
            });
        });
    });
}

// 插入默认数据
async function insertDefaultData() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

    // 创建管理员账号
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await new Promise((resolve) => {
        db.run(
            'INSERT OR IGNORE INTO users (email, password, is_admin) VALUES (?, ?, 1)',
            [adminEmail, hashedPassword],
            function(err) {
                if (err) {
                    console.error('❌ 创建管理员账号失败:', err.message);
                } else if (this.changes > 0) {
                    console.log('✅ 管理员账号创建成功');
                    console.log(`   邮箱: ${adminEmail}`);
                    console.log(`   密码: ${adminPassword}`);
                    console.log('   ⚠️  请立即修改默认密码！');
                } else {
                    console.log('ℹ️  管理员账号已存在');
                }
                resolve();
            }
        );
    });

    // 插入示例商品
    const sampleProducts = [
        {
            name: 'ChatGPT Plus 全功能独享账号',
            description: '全功能 GPT-4 访问权限，独享账号无需共享，支持官方所有功能，稳定可靠，即买即用。',
            price: 40.00,
            stock: 0,
            delivery_type: 'auto_recharge'
        },
        {
            name: '[普号] Claude > 长效微软邮箱',
            description: '长期有效的微软邮箱账号，可直接注册 Claude 等服务，稳定性高，性价比之选。',
            price: 10.00,
            stock: 0,
            delivery_type: 'email'
        },
        {
            name: '谷歌长效手机接码 - 美区号',
            description: '美国区域手机号码，支持接收验证码，适用于谷歌、Twitter 等平台注册验证。',
            price: 5.00,
            stock: 0,
            delivery_type: 'email'
        }
    ];

    const row = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM products', (err, row) => {
            if (err) {
                console.error('❌ 查询商品失败:', err.message);
                resolve({ count: -1 });
            } else {
                resolve(row);
            }
        });
    });

    if (row.count === 0) {
        const stmt = db.prepare('INSERT INTO products (name, description, price, stock, status, delivery_type) VALUES (?, ?, ?, ?, ?, ?)');
        for (const product of sampleProducts) {
            await new Promise((resolve) => {
                stmt.run(
                    product.name,
                    product.description,
                    product.price,
                    product.stock,
                    product.stock > 0 ? 'in_stock' : 'out_of_stock',
                    product.delivery_type || 'email',
                    resolve
                );
            });
        }
        await new Promise((resolve) => stmt.finalize(resolve));
        console.log('✅ 示例商品数据插入成功');
    } else {
        console.log('ℹ️  商品数据已存在，跳过插入');
    }
}

// 执行初始化
initDatabase()
    .then(() => {
        console.log('\n🎉 数据库初始化完成！');
        console.log('\n下一步：');
        console.log('1. 复制 .env.example 为 .env');
        console.log('2. 配置 .env 中的支付参数');
        console.log('3. 运行 npm start 启动服务器\n');
        db.close();
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ 数据库初始化失败:', err);
        db.close();
        process.exit(1);
    });
