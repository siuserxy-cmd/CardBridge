const { dbAll, dbGet, dbRun, dbTransaction } = require('./database');

const RESERVATION_MINUTES = Math.max(5, parseInt(process.env.ORDER_RESERVATION_MINUTES || '30', 10));
const MANUAL_CONFIRM_MINUTES = Math.max(
    RESERVATION_MINUTES,
    parseInt(process.env.MANUAL_CONFIRM_MINUTES || '720', 10)
);

function toSqlDatetime(input) {
    return new Date(input).toISOString().slice(0, 19).replace('T', ' ');
}

function minutesFromNow(minutes) {
    return toSqlDatetime(Date.now() + (minutes * 60 * 1000));
}

function parsePaymentPayload(payload) {
    if (!payload) return {};

    try {
        return JSON.parse(payload);
    } catch (error) {
        console.warn('⚠️  payment_payload 解析失败:', error.message);
        return { manualMode: false };
    }
}

function serializePaymentPayload(payload) {
    return JSON.stringify(payload || {});
}

async function syncProductStock(productId, runner = { dbGet, dbRun }) {
    if (!productId) return 0;

    const stockRow = await runner.dbGet(
        "SELECT COUNT(*) AS count FROM cards WHERE product_id = ? AND status = 'available'",
        [productId]
    );

    const count = stockRow?.count || 0;
    await runner.dbRun(
        `UPDATE products
         SET stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [count, count > 0 ? 'in_stock' : 'out_of_stock', productId]
    );

    return count;
}

async function syncProductStocks(productIds, runner = { dbGet, dbRun }) {
    const uniqueIds = [...new Set((productIds || []).filter(Boolean))];

    for (const productId of uniqueIds) {
        await syncProductStock(productId, runner);
    }
}

async function releaseOrderReservation(orderId, nextStatus = 'cancelled', runner = { dbGet, dbRun }) {
    const order = await runner.dbGet(
        'SELECT id, product_id, payment_status FROM orders WHERE id = ?',
        [orderId]
    );

    if (!order || order.payment_status === 'paid') {
        return order;
    }

    await runner.dbRun(
        "UPDATE cards SET status = 'available', order_id = NULL WHERE order_id = ? AND status = 'reserved'",
        [orderId]
    );

    await runner.dbRun(
        `UPDATE orders
         SET payment_status = ?, reservation_expires_at = NULL, chatgpt_token = NULL
         WHERE id = ? AND payment_status != 'paid'`,
        [nextStatus, orderId]
    );

    await syncProductStock(order.product_id, runner);
    return order;
}

async function releaseExpiredReservations() {
    // 整个操作在事务内完成，避免 SELECT 和 UPDATE 之间的竞态
    return dbTransaction(async (runner) => {
        const expiredOrders = await runner.dbAll(`
            SELECT id, product_id
            FROM orders
            WHERE payment_status IN ('pending', 'confirming')
              AND reservation_expires_at IS NOT NULL
              AND reservation_expires_at <= CURRENT_TIMESTAMP
        `);

        if (!expiredOrders.length) {
            return 0;
        }

        const orderIds = expiredOrders.map(order => order.id);
        const placeholders = orderIds.map(() => '?').join(', ');

        await runner.dbRun(
            `UPDATE cards
             SET status = 'available', order_id = NULL
             WHERE order_id IN (${placeholders}) AND status = 'reserved'`,
            orderIds
        );

        await runner.dbRun(
            `UPDATE orders
             SET payment_status = 'expired', reservation_expires_at = NULL, chatgpt_token = NULL
             WHERE id IN (${placeholders})
               AND payment_status IN ('pending', 'confirming')`,
            orderIds
        );

        await syncProductStocks(expiredOrders.map(order => order.product_id), runner);
        return expiredOrders.length;
    });
}

module.exports = {
    MANUAL_CONFIRM_MINUTES,
    RESERVATION_MINUTES,
    minutesFromNow,
    parsePaymentPayload,
    releaseExpiredReservations,
    releaseOrderReservation,
    serializePaymentPayload,
    syncProductStock,
    syncProductStocks,
    toSqlDatetime
};
