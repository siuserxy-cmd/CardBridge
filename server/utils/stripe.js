// Stripe 国际支付通道 —— feature-flag 驱动
// 需要环境变量：
//   STRIPE_SECRET_KEY        - sk_live_... 或 sk_test_...
//   STRIPE_PUBLISHABLE_KEY   - pk_live_... （前台启用判断）
//   STRIPE_WEBHOOK_SECRET    - whsec_...  （webhook 签名校验）
//   STRIPE_CURRENCY          - 默认 usd，可改 cny 等
//
// 无 STRIPE_SECRET_KEY 时 isEnabled() 返回 false，
// createCheckoutSession 抛错，前台按钮不会展示。

const Stripe = require('stripe');

let client = null;

function isEnabled() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getClient() {
    if (!isEnabled()) return null;
    if (!client) {
        client = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
    }
    return client;
}

// 人民币汇率换算 —— 简易实现：读 env.STRIPE_CNY_TO_USD_RATE（默认 7.2）
// 也可以直接设 STRIPE_CURRENCY=cny 如果你的 Stripe 账户支持
function computePriceUnit(amountCNY) {
    const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
    if (currency === 'cny') {
        return { currency: 'cny', unit_amount: Math.round(Number(amountCNY) * 100) };
    }
    const rate = Number(process.env.STRIPE_CNY_TO_USD_RATE) || 7.2;
    const usd = Number(amountCNY) / rate;
    return { currency: 'usd', unit_amount: Math.round(usd * 100) };
}

async function createCheckoutSession({ order, successUrl, cancelUrl }) {
    const stripe = getClient();
    if (!stripe) throw new Error('Stripe not configured');

    const { currency, unit_amount } = computePriceUnit(order.amount);

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
            price_data: {
                currency,
                product_data: {
                    name: order.product_name || '数字商品',
                    description: `订单 ${order.transaction_id}`
                },
                unit_amount
            },
            quantity: 1
        }],
        customer_email: order.buyer_email || undefined,
        client_reference_id: String(order.id),
        metadata: {
            order_id: String(order.id),
            transaction_id: order.transaction_id
        },
        success_url: successUrl,
        cancel_url: cancelUrl
    });

    return {
        sessionId: session.id,
        url: session.url
    };
}

// webhook 签名校验 + 事件解析
function constructEvent(rawBody, signature) {
    const stripe = getClient();
    if (!stripe) throw new Error('Stripe not configured');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET 未配置');
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
    isEnabled,
    createCheckoutSession,
    constructEvent
};
