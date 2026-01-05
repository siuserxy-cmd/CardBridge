const { dbAll, dbRun } = require('./utils/database');

// 示例卡密数据
const sampleCardsData = [
    {
        productName: 'ChatGPT Plus 全功能独享账号',
        cards: [
            { number: 'chatgpt-premium-001@example.com', password: 'Pass123456' },
            { number: 'chatgpt-premium-002@example.com', password: 'Pass789012' },
            { number: 'chatgpt-premium-003@example.com', password: 'Pass345678' },
            { number: 'chatgpt-premium-004@example.com', password: 'Pass901234' },
            { number: 'chatgpt-premium-005@example.com', password: 'Pass567890' }
        ]
    },
    {
        productName: '[普号] Claude > 长效微软邮箱',
        cards: [
            { number: 'claude-ms-001@outlook.com', password: 'MS2024Pass001' },
            { number: 'claude-ms-002@outlook.com', password: 'MS2024Pass002' },
            { number: 'claude-ms-003@outlook.com', password: 'MS2024Pass003' },
            { number: 'claude-ms-004@outlook.com', password: 'MS2024Pass004' },
            { number: 'claude-ms-005@outlook.com', password: 'MS2024Pass005' },
            { number: 'claude-ms-006@outlook.com', password: 'MS2024Pass006' },
            { number: 'claude-ms-007@outlook.com', password: 'MS2024Pass007' },
            { number: 'claude-ms-008@outlook.com', password: 'MS2024Pass008' }
        ]
    },
    {
        productName: '谷歌长效手机接码 - 美区号',
        cards: [
            { number: '+1-555-0101', password: '' },
            { number: '+1-555-0102', password: '' },
            { number: '+1-555-0103', password: '' }
        ]
    }
];

async function addSampleCards() {
    try {
        console.log('🎯 开始添加示例卡密...\n');

        // 获取所有商品
        const products = await dbAll('SELECT * FROM products');

        for (const product of products) {
            // 查找对应的示例数据
            const sampleData = sampleCardsData.find(data =>
                product.name.includes(data.productName.substring(0, 10))
            );

            if (!sampleData) {
                console.log(`⚠️  未找到 "${product.name}" 的示例数据，跳过`);
                continue;
            }

            // 检查是否已有卡密
            const existingCards = await dbAll(
                'SELECT COUNT(*) as count FROM cards WHERE product_id = ?',
                [product.id]
            );

            if (existingCards[0].count > 0) {
                console.log(`ℹ️  商品 "${product.name}" 已有 ${existingCards[0].count} 张卡密，跳过添加`);
                continue;
            }

            // 添加卡密
            let addedCount = 0;
            for (const card of sampleData.cards) {
                try {
                    await dbRun(
                        'INSERT INTO cards (product_id, card_number, card_password, status) VALUES (?, ?, ?, ?)',
                        [product.id, card.number, card.password, 'available']
                    );
                    addedCount++;
                } catch (error) {
                    console.error(`   添加卡密失败: ${card.number}`, error.message);
                }
            }

            // 更新商品库存
            await dbRun(
                'UPDATE products SET stock = ?, status = ? WHERE id = ?',
                [addedCount, addedCount > 0 ? 'in_stock' : 'out_of_stock', product.id]
            );

            console.log(`✅ 商品 "${product.name}" 添加了 ${addedCount} 张卡密`);
        }

        console.log('\n🎉 示例卡密添加完成！');
        console.log('\n提示：现在可以测试购买功能了');
        console.log('1. 注册一个普通用户账号');
        console.log('2. 选择商品购买');
        console.log('3. 支付成功后即可获得卡密\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ 添加示例卡密失败:', error);
        process.exit(1);
    }
}

// 运行脚本
addSampleCards();
