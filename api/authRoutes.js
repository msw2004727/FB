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

        // 【核心修改】為新玩家建立一個更具體的開局「第0回」存檔
        const roundZeroData = {
            R: 0,
            playerState: 'alive',
            timeOfDay: '上午',
            powerChange: { internal: 0, external: 0, lightness: 0 },
            moralityChange: 0,
            ATM: ['幽暗', '濃重藥草味', '一絲血腥味'],
            EVT: '從劇痛中醒來，發現身處陌生藥鋪',
            LOC: ['無名村藥鋪', { description: '一間樸素的藥鋪，空氣中瀰漫著草藥的氣味，光線有些昏暗。' }],
            PSY: '頭痛欲裂...這裡是哪裡？我不是應該在...？這身體不是我的！',
            PC: '你在一陣劇痛中醒來，感覺全身筋骨欲裂，內息紊亂不堪，似乎受了極重的內傷。一位年約五旬的郎中正在為你把脈，神色凝重。',
            // 【核心修改】直接設定開局遇到的第一個NPC為普通人
            NPC: [{
                name: '王大夫',
                status: '憂心忡忡地為你把脈',
                friendliness: 'neutral', // 使用友好度等級
                friendlinessValue: 10,  // 給予一個基礎友好度數值
                isNew: true
            }],
            ITM: { money: 0, items: {} }, // 確保初始ITM結構正確
            QST: '探查自身與周遭的處境。',
            WRD: '天色陰沉，細雨濛濛。',
            LOR: '你似乎被一位郎中所救。',
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
            { userId: newUserRef.id, username: username },
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
