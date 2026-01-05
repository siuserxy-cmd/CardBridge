const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbGet, dbRun } = require('../utils/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================
// 用户注册
// ============================================
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 验证输入
        if (!email || !password) {
            return res.status(400).json({ error: '邮箱和密码不能为空' });
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }

        // 验证密码强度
        if (password.length < 6) {
            return res.status(400).json({ error: '密码长度至少为 6 位' });
        }

        // 检查邮箱是否已存在
        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: '该邮箱已被注册' });
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 创建用户
        const result = await dbRun(
            'INSERT INTO users (email, password, is_admin) VALUES (?, ?, 0)',
            [email, hashedPassword]
        );

        // 生成 JWT
        const token = jwt.sign(
            { userId: result.id, email, isAdmin: false },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: '注册成功',
            token,
            user: {
                id: result.id,
                email,
                isAdmin: false
            }
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// ============================================
// 用户登录
// ============================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 验证输入
        if (!email || !password) {
            return res.status(400).json({ error: '邮箱和密码不能为空' });
        }

        // 查询用户
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: '邮箱或密码错误' });
        }

        // 验证密码
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: '邮箱或密码错误' });
        }

        // 生成 JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email, isAdmin: user.is_admin === 1 },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: '登录成功',
            token,
            user: {
                id: user.id,
                email: user.email,
                isAdmin: user.is_admin === 1
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// ============================================
// 获取当前用户信息
// ============================================
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, email, is_admin, created_at FROM users WHERE id = ?', [req.user.userId]);

        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({
            id: user.id,
            email: user.email,
            isAdmin: user.is_admin === 1,
            createdAt: user.created_at
        });
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

module.exports = router;
