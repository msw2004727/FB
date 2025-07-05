const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = admin.firestore();

// API 路由: /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, gender, password } = req.body;
        if (!username || !gender || !password) {
            return res.status(400).json({ message: '所有欄位皆為必填。' });
        }

        const userSnapshot = await db.collection('users').where('username', '==', username).get();
        if (!userSnapshot.empty) {
            return res.status(400).json({ message: '此姓名已被註冊。' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            username,
            gender,
            passwordHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 註冊成功後，直接產生 JWT
        const token = jwt.sign(
            { userId: newUserRef.id, username: username }, // 使用新建立的用戶 ID 和用戶名
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // 回傳 token，讓前端可以直接登入
        res.status(201).json({ 
            message: '註冊成功，正在進入遊戲...', 
            token, 
            username 
        });

    } catch (error) {
        console.error("註冊失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，註冊失敗。' });
    }
});

// API 路由: /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userSnapshot = await db.collection('users').where('username', '==', username).get();

        if (userSnapshot.empty) {
            return res.status(401).json({ message: '姓名或密碼錯誤。' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();

        const isPasswordMatch = await bcrypt.compare(password, userData.passwordHash);
        if (!isPasswordMatch) {
            return res.status(401).json({ message: '姓名或密碼錯誤。' });
        }

        const token = jwt.sign(
            { userId: userDoc.id, username: userData.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ message: '登入成功！', token, username: userData.username });
    } catch (error) {
        console.error("登入失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，登入失敗。' });
    }
});

module.exports = router;
