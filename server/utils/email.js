const nodemailer = require('nodemailer');

function maskEmail(email) {
    if (!email) return '***';
    const [user, domain] = email.split('@');
    if (!domain) return '***';
    return user.slice(0, 2) + '***@' + domain;
}

// ============================================
// 创建邮件发送器
// 支持 QQ邮箱 / 163邮箱 / Gmail / SMTP 自定义
// ============================================
function createTransporter() {
    const service = process.env.EMAIL_SERVICE; // 'QQ' | '163' | 'Gmail' | 留空用自定义SMTP

    if (service) {
        // 使用预设服务（QQ邮箱、163邮箱等）
        return nodemailer.createTransport({
            service,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS, // QQ邮箱填授权码，不是登录密码
            },
        });
    }

    // 自定义 SMTP
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT) || 465,
        secure: process.env.EMAIL_SECURE !== 'false', // 默认 true (SSL)
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
}

// ============================================
// 发送卡密邮件（核心功能）
// ============================================
async function sendCardEmail({ toEmail, productName, cards, orderNo, amount }) {
    // 未配置邮箱则跳过，不影响主流程
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('⚠️  未配置邮箱，跳过发送邮件（订单号：' + orderNo + '）');
        return { skipped: true };
    }

    const transporter = createTransporter();
    const shopName = process.env.SHOP_NAME || '数字商店';
    const fromName = process.env.EMAIL_FROM_NAME || shopName;

    // 生成卡密内容的 HTML
    const cardsHtml = cards.map((card, i) => `
        <div style="background:#1a1a2e;border:1px solid #7c3aed;border-radius:8px;padding:16px;margin:8px 0;">
            <div style="color:#a78bfa;font-size:12px;margin-bottom:6px;">第 ${i + 1} 张</div>
            ${card.card_number ? `<div style="color:#e2e8f0;margin-bottom:4px;">卡号：<span style="font-family:monospace;color:#34d399;font-size:15px;">${card.card_number}</span></div>` : ''}
            ${card.card_password ? `<div style="color:#e2e8f0;">密码：<span style="font-family:monospace;color:#34d399;font-size:15px;">${card.card_password}</span></div>` : ''}
            ${(!card.card_number && !card.card_password && card.content) ? `<div style="color:#34d399;font-family:monospace;font-size:15px;word-break:break-all;">${card.content}</div>` : ''}
        </div>
    `).join('');

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0a1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">

        <!-- 头部 -->
        <div style="text-align:center;margin-bottom:32px;">
            <h1 style="margin:0;font-size:28px;background:linear-gradient(135deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                ${shopName}
            </h1>
            <div style="margin-top:8px;width:60px;height:3px;background:linear-gradient(90deg,#a855f7,#ec4899);border-radius:2px;display:inline-block;"></div>
        </div>

        <!-- 成功提示 -->
        <div style="background:linear-gradient(135deg,#0d1b2a,#1a0a2e);border:1px solid rgba(168,85,247,0.3);border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">✅</div>
            <h2 style="margin:0 0 8px;color:#e2e8f0;font-size:22px;">付款成功，卡密已发出</h2>
            <p style="margin:0;color:#94a3b8;font-size:14px;">感谢您购买 <strong style="color:#a78bfa;">${productName}</strong></p>
        </div>

        <!-- 订单信息 -->
        <div style="background:#1e1b2e;border-radius:12px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">订单号</td>
                    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;text-align:right;font-family:monospace;">${orderNo}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">商品名称</td>
                    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;text-align:right;">${productName}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">购买数量</td>
                    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;text-align:right;">${cards.length} 件</td>
                </tr>
                <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px 0 0;color:#64748b;font-size:13px;">支付金额</td>
                    <td style="padding:12px 0 0;color:#34d399;font-size:18px;font-weight:700;text-align:right;">¥${parseFloat(amount).toFixed(2)}</td>
                </tr>
            </table>
        </div>

        <!-- 卡密区域 -->
        <div style="margin-bottom:24px;">
            <h3 style="margin:0 0 16px;color:#a78bfa;font-size:16px;display:flex;align-items:center;gap:8px;">
                🎁 您的卡密内容
            </h3>
            ${cardsHtml}
        </div>

        <!-- 温馨提示 -->
        <div style="background:#1a1a2e;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px;margin-bottom:32px;">
            <p style="margin:0 0 8px;color:#fbbf24;font-size:13px;font-weight:600;">温馨提示</p>
            <ul style="margin:0;padding-left:16px;color:#94a3b8;font-size:13px;line-height:2;">
                <li>请妥善保存卡密，勿泄露给他人</li>
                <li>如有使用问题，请保留此邮件作为凭证</li>
            </ul>
        </div>

        <!-- 底部 -->
        <div style="text-align:center;color:#475569;font-size:12px;">
            <p style="margin:0;">此邮件由 ${shopName} 系统自动发送，请勿直接回复</p>
            ${process.env.CONTACT_INFO ? `<p style="margin:6px 0 0;color:#64748b;">${process.env.CONTACT_INFO}</p>` : ''}
        </div>
    </div>
</body>
</html>`;

    const info = await transporter.sendMail({
        from: `"${fromName}" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `【${shopName}】购买成功 - ${productName} 卡密已发送`,
        html,
    });

    console.log(`✉️  卡密邮件已发送至 ${maskEmail(toEmail)}，消息ID: ${info.messageId}`);
    return info;
}

// ============================================
// 发送充值结果邮件（ifaka 自动充值模式）
// ============================================
async function sendRechargeEmail({ toEmail, productName, orderNo, amount, status, error }) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('⚠️  未配置邮箱，跳过发送充值邮件（订单号：' + orderNo + '）');
        return { skipped: true };
    }

    const transporter = createTransporter();
    const shopName = process.env.SHOP_NAME || '数字商店';
    const fromName = process.env.EMAIL_FROM_NAME || shopName;

    const isSuccess = status === 'success';
    const icon = isSuccess ? '✅' : '❌';
    const title = isSuccess ? '充值成功！' : '充值失败';
    const subtitle = isSuccess
        ? `您的 <strong style="color:#a78bfa;">${productName}</strong> 已成功充值到您的 ChatGPT 账号。`
        : `很抱歉，<strong style="color:#a78bfa;">${productName}</strong> 充值未成功。`;

    const statusColor = isSuccess ? '#34d399' : '#ff857f';

    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f0a1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">

        <!-- 头部 -->
        <div style="text-align:center;margin-bottom:32px;">
            <h1 style="margin:0;font-size:28px;background:linear-gradient(135deg,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                ${shopName}
            </h1>
            <div style="margin-top:8px;width:60px;height:3px;background:linear-gradient(90deg,#a855f7,#ec4899);border-radius:2px;display:inline-block;"></div>
        </div>

        <!-- 状态提示 -->
        <div style="background:linear-gradient(135deg,#0d1b2a,#1a0a2e);border:1px solid rgba(168,85,247,0.3);border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">${icon}</div>
            <h2 style="margin:0 0 8px;color:${statusColor};font-size:22px;">${title}</h2>
            <p style="margin:0;color:#94a3b8;font-size:14px;">${subtitle}</p>
        </div>

        <!-- 订单信息 -->
        <div style="background:#1e1b2e;border-radius:12px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">订单号</td>
                    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;text-align:right;font-family:monospace;">${orderNo}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">商品名称</td>
                    <td style="padding:8px 0;color:#e2e8f0;font-size:13px;text-align:right;">${productName}</td>
                </tr>
                <tr>
                    <td style="padding:8px 0;color:#64748b;font-size:13px;">充值状态</td>
                    <td style="padding:8px 0;color:${statusColor};font-size:13px;text-align:right;font-weight:600;">${isSuccess ? '已成功' : '失败'}</td>
                </tr>
                <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:12px 0 0;color:#64748b;font-size:13px;">支付金额</td>
                    <td style="padding:12px 0 0;color:#34d399;font-size:18px;font-weight:700;text-align:right;">¥${parseFloat(amount).toFixed(2)}</td>
                </tr>
            </table>
        </div>

        ${!isSuccess ? `
        <!-- 失败原因 -->
        <div style="background:#1a1a2e;border-left:3px solid #ff857f;border-radius:0 8px 8px 0;padding:16px;margin-bottom:24px;">
            <p style="margin:0 0 8px;color:#ff857f;font-size:13px;font-weight:600;">失败原因</p>
            <p style="margin:0;color:#94a3b8;font-size:13px;">${error || '未知错误，请联系客服处理'}</p>
        </div>
        ` : ''}

        <!-- 提示 -->
        <div style="background:#1a1a2e;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px;margin-bottom:32px;">
            <p style="margin:0 0 8px;color:#fbbf24;font-size:13px;font-weight:600;">温馨提示</p>
            <ul style="margin:0;padding-left:16px;color:#94a3b8;font-size:13px;line-height:2;">
                ${isSuccess
                    ? '<li>请登录 ChatGPT 确认 Plus 订阅已生效</li><li>如有问题，请保留此邮件联系客服</li>'
                    : '<li>充值失败不会扣除您的卡密</li><li>请联系客服协助处理或申请退款</li>'
                }
            </ul>
        </div>

        <!-- 底部 -->
        <div style="text-align:center;color:#475569;font-size:12px;">
            <p style="margin:0;">此邮件由 ${shopName} 系统自动发送，请勿直接回复</p>
            ${process.env.CONTACT_INFO ? `<p style="margin:6px 0 0;color:#64748b;">${process.env.CONTACT_INFO}</p>` : ''}
        </div>
    </div>
</body>
</html>`;

    const subject = isSuccess
        ? `【${shopName}】充值成功 - ${productName}`
        : `【${shopName}】充值失败 - ${productName}，请联系客服`;

    const info = await transporter.sendMail({
        from: `"${fromName}" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject,
        html,
    });

    console.log(`✉️  充值${isSuccess ? '成功' : '失败'}邮件已发送至 ${maskEmail(toEmail)}，消息ID: ${info.messageId}`);
    return info;
}

module.exports = { sendCardEmail, sendRechargeEmail };
