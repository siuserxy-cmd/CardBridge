# 待办

## 飞书通知（deferred）

**场景**：新订单即时推送到飞书群 + 每日销售报告

**设计已完成，待实施**：
- `server/utils/feishu.js` —— `notifyNewOrder` / `notifyDailyReport` / `getTodayStats`
- `server/routes/orders.js` —— `processPaymentSuccess` 成功后 fire-and-forget 调用
- `server/index.js` —— `GET /api/cron/daily-report`，Bearer Token 鉴权

**注意事项**：
- SQL 列名是 `amount`（不是 `total_amount`）
- 低库存查询用 `products.stock`
- 用 Node 原生 `fetch` + `AbortController` 做 8s 超时
- 失败必须静默，不能影响订单主流程

**需要的环境变量**：
- `FEISHU_WEBHOOK_URL` —— 群机器人 webhook URL
- `CRON_TOKEN` —— `openssl rand -hex 32`

**外部 cron**：`0 23 * * * curl -H "Authorization: Bearer $CRON_TOKEN" https://host/api/cron/daily-report`
