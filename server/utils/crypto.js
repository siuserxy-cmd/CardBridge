const crypto = require('crypto');

function getEncryptionKey() {
    const secret = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('缺少 APP_ENCRYPTION_KEY 或 JWT_SECRET');
    }

    return crypto.createHash('sha256').update(secret).digest();
}

function encryptText(plainText) {
    if (!plainText) return null;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(String(plainText), 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return [
        'enc',
        iv.toString('base64url'),
        authTag.toString('base64url'),
        encrypted.toString('base64url')
    ].join('.');
}

function decryptText(cipherText) {
    if (!cipherText) return '';
    if (!String(cipherText).startsWith('enc.')) return String(cipherText);

    const [, ivB64, authTagB64, encryptedB64] = String(cipherText).split('.');
    if (!ivB64 || !authTagB64 || !encryptedB64) {
        throw new Error('加密文本格式无效');
    }

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getEncryptionKey(),
        Buffer.from(ivB64, 'base64url')
    );

    decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedB64, 'base64url')),
        decipher.final()
    ]).toString('utf8');
}

function generateSecureToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function tokenMatchesHash(token, storedHash) {
    if (!token || !storedHash) return false;

    const candidate = Buffer.from(hashToken(token));
    const source = Buffer.from(String(storedHash));

    if (candidate.length !== source.length) return false;
    return crypto.timingSafeEqual(candidate, source);
}

module.exports = {
    decryptText,
    encryptText,
    generateSecureToken,
    hashToken,
    tokenMatchesHash
};
