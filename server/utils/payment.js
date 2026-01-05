/**
 * 支付工具函数
 * 包含支付宝和微信支付的接口封装
 */

// ============================================
// 支付宝支付
// ============================================

/**
 * 创建支付宝支付订单
 * @param {Object} orderInfo - 订单信息
 * @returns {Promise<Object>} 支付链接或二维码
 */
async function createAlipayOrder(orderInfo) {
    try {
        // 检查是否配置了支付宝
        if (!process.env.ALIPAY_APP_ID || process.env.ALIPAY_APP_ID === 'your_alipay_app_id') {
            console.log('⚠️  支付宝未配置，使用测试模式');
            return {
                isTestMode: true,
                payUrl: `/api/orders/test-pay/${orderInfo.orderId}`,
                message: '测试模式：点击此链接模拟支付成功'
            };
        }

        // 实际支付宝 SDK 调用（需要配置后才能使用）
        const AlipaySdk = require('alipay-sdk').default;
        const AlipayFormData = require('alipay-sdk/lib/form').default;

        const alipaySdk = new AlipaySdk({
            appId: process.env.ALIPAY_APP_ID,
            privateKey: process.env.ALIPAY_PRIVATE_KEY,
            alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
            gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do'
        });

        const formData = new AlipayFormData();
        formData.setMethod('get');
        formData.addField('returnUrl', `${process.env.APP_URL}/order-success`);
        formData.addField('bizContent', {
            outTradeNo: orderInfo.orderId,
            productCode: 'FAST_INSTANT_TRADE_PAY',
            totalAmount: orderInfo.amount,
            subject: orderInfo.subject,
            body: orderInfo.description
        });

        const result = await alipaySdk.exec(
            'alipay.trade.page.pay',
            {},
            { formData }
        );

        return {
            isTestMode: false,
            payUrl: result,
            message: '请在新窗口完成支付'
        };
    } catch (error) {
        console.error('创建支付宝订单失败:', error);
        throw new Error('创建支付失败');
    }
}

/**
 * 验证支付宝支付回调
 * @param {Object} params - 回调参数
 * @returns {Promise<boolean>} 验证结果
 */
async function verifyAlipayCallback(params) {
    try {
        // 测试模式直接返回成功
        if (!process.env.ALIPAY_APP_ID || process.env.ALIPAY_APP_ID === 'your_alipay_app_id') {
            return true;
        }

        const AlipaySdk = require('alipay-sdk').default;
        const alipaySdk = new AlipaySdk({
            appId: process.env.ALIPAY_APP_ID,
            alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY
        });

        return alipaySdk.checkNotifySign(params);
    } catch (error) {
        console.error('验证支付宝回调失败:', error);
        return false;
    }
}

// ============================================
// 微信支付
// ============================================

/**
 * 创建微信支付订单
 * @param {Object} orderInfo - 订单信息
 * @returns {Promise<Object>} 支付二维码链接
 */
async function createWechatOrder(orderInfo) {
    try {
        // 检查是否配置了微信支付
        if (!process.env.WECHAT_MCHID || process.env.WECHAT_MCHID === 'your_merchant_id') {
            console.log('⚠️  微信支付未配置，使用测试模式');
            return {
                isTestMode: true,
                codeUrl: `/api/orders/test-pay/${orderInfo.orderId}`,
                message: '测试模式：点击此链接模拟支付成功'
            };
        }

        // 实际微信支付 SDK 调用（需要配置后才能使用）
        const { Wechatpay } = require('wechatpay-node-v3');

        const pay = new Wechatpay({
            appid: process.env.WECHAT_APPID,
            mchid: process.env.WECHAT_MCHID,
            private_key: process.env.WECHAT_PRIVATE_KEY,
            serial_no: process.env.WECHAT_SERIAL_NO,
            apiv3_private_key: process.env.WECHAT_APIV3_KEY
        });

        const result = await pay.v3.pay.transactions.native({
            appid: process.env.WECHAT_APPID,
            mchid: process.env.WECHAT_MCHID,
            description: orderInfo.subject,
            out_trade_no: orderInfo.orderId,
            notify_url: `${process.env.APP_URL}/api/orders/wechat-callback`,
            amount: {
                total: Math.round(orderInfo.amount * 100), // 转为分
                currency: 'CNY'
            }
        });

        return {
            isTestMode: false,
            codeUrl: result.code_url,
            message: '请使用微信扫码支付'
        };
    } catch (error) {
        console.error('创建微信支付订单失败:', error);
        throw new Error('创建支付失败');
    }
}

/**
 * 验证微信支付回调
 * @param {Object} data - 回调数据
 * @returns {Promise<boolean>} 验证结果
 */
async function verifyWechatCallback(data) {
    try {
        // 测试模式直接返回成功
        if (!process.env.WECHAT_MCHID || process.env.WECHAT_MCHID === 'your_merchant_id') {
            return true;
        }

        const { Wechatpay } = require('wechatpay-node-v3');
        const pay = new Wechatpay({
            appid: process.env.WECHAT_APPID,
            mchid: process.env.WECHAT_MCHID,
            apiv3_private_key: process.env.WECHAT_APIV3_KEY
        });

        return pay.v3.verifySign(data);
    } catch (error) {
        console.error('验证微信支付回调失败:', error);
        return false;
    }
}

module.exports = {
    createAlipayOrder,
    verifyAlipayCallback,
    createWechatOrder,
    verifyWechatCallback
};
