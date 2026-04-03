const fs = require('fs');
const path = require('path');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', '..', 'database', 'shop.db');

function resolveDatabasePath(databasePath = process.env.DATABASE_PATH) {
    if (!databasePath) {
        return DEFAULT_DATABASE_PATH;
    }

    if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
        return databasePath;
    }

    if (path.isAbsolute(databasePath)) {
        return databasePath;
    }

    return path.resolve(process.cwd(), databasePath);
}

function ensureDatabaseDirectory(databasePath) {
    if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file:')) {
        return null;
    }

    const dbDir = path.dirname(databasePath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    return dbDir;
}

module.exports = {
    DEFAULT_DATABASE_PATH,
    resolveDatabasePath,
    ensureDatabaseDirectory
};
