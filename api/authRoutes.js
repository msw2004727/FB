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

        // 建立使用者文件
        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            username,
            gender,
            passwordHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            // 初始玩家數值
            internalPower: 5,
            externalPower: 5,
            lightness: 5,
            morality: 0,
            timeOfDay: '上午',
            yearName: '元祐',
            year: 1,
            month: 1,
            day: 1
        });

        // *** 【核心新增功能】 ***
        // 為新玩家建立固定的開局「第0回」存檔
        const roundZeroData = {
            R: 0,
            playerState: 'alive',
            timeOfDay: '上午',
            powerChange: { internal: 0, external: 0, lightness: 0 },
            moralityChange: 0,
            ATM: ['幽暗', '陳舊', '一絲血腥味'],
            EVT: '醒來發現身處陌生茅屋',
            LOC: ['破舊的茅屋', { description: '四壁空空，只有一張硬板床和一張破桌子。' }],
            PSY: '頭痛欲裂...這裡是哪裡？我不是應該在...？這身體不是我的！',
            PC: '你在一陣劇痛中醒來，感覺全身筋骨欲裂，內息紊亂不堪，似乎受了極重的內傷。',
            NPC: [],
            ITM: '身無長物',
            QST: '探查自身與周遭的處境。',
            WRD: '天色陰沉，細雨濛濛。',
            LOR: '',
            CLS: '身上有多處不明的傷口，似乎經歷過一場惡鬥。',
            IMP: '你的靈魂穿越到這個陌生的武俠世界，一段新的江湖路就此展開。',
            internalPower: 5,
            externalPower: 5,
            lightness: 5,
            morality: 0,
            yearName: '元祐',
            year: 1,
            month: 1,
            day: 1
        };
        await db.collection('users').doc(newUserRef.id).collection('game_saves').doc('R0').set(roundZeroData);
        // *** 【核心新增功能結束】 ***

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
