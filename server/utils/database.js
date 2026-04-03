const sqlite3 = require('sqlite3').verbose();
const { resolveDatabasePath, ensureDatabaseDirectory } = require('./db-path');

const dbPath = resolveDatabasePath();
ensureDatabaseDirectory(dbPath);

// 创建数据库连接
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ 数据库连接失败:', err.message);
    }
});

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
});

// Promise 包装器：查询单行
const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

// Promise 包装器：查询多行
const dbAll = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// Promise 包装器：执行 SQL
const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

const dbTransaction = async (handler) => {
    await dbRun('BEGIN IMMEDIATE TRANSACTION');

    try {
        const result = await handler({ dbGet, dbAll, dbRun });
        await dbRun('COMMIT');
        return result;
    } catch (error) {
        try {
            await dbRun('ROLLBACK');
        } catch (rollbackError) {
            console.error('事务回滚失败:', rollbackError.message);
        }
        throw error;
    }
};

module.exports = {
    db,
    dbGet,
    dbAll,
    dbRun,
    dbTransaction
};
