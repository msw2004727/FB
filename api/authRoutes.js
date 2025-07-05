const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../middleware/auth');

// 【引入】從您檔案中既有的引入
const { loadPrompts } = require('../services/worldviewManager');
const { getAIStory } = require('../services/aiService');

const db = admin.firestore();

// API 路由: /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { username, gender, password, worldview } = req.body;
        if (!username || !gender || !password || !worldview) {
            return res.status(400).json({ message: '所有欄位皆為必填。' });
        }

        const userSnapshot = await db.collection('users').where('username', '==', username).get();
        if (!userSnapshot.empty) {
            return res.status(400).json({ message: '此名號已被註冊。' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUserRef = db.collection('users').doc();
        await newUserRef.set({
            username,
            gender,
            passwordHash,
            worldview: worldview,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // --- 【新增】註冊成功後，立即簽發 Token ---
        const token = jwt.sign(
            { id: newUserRef.id, username: username }, // 使用新建立的使用者 ID 和名稱
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // --- 【修改】回傳的內容，現在包含 token ---
        res.status(201).json({
            message: '註冊成功！',
            token: token, // 將 token 回傳給前端
            username: username
        });

    } catch (error) {
        console.error("註冊失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，註冊失敗。' });
    }
});

// API 路由: /api/auth/login (保留您檔案中的原樣)
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
            { id: userDoc.id, username: userData.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ message: '登入成功！', token, username: userData.username });
    } catch (error) {
        console.error("登入失敗:", error);
        res.status(500).json({ message: '伺服器內部錯誤，登入失敗。' });
    }
});

// 開始新遊戲的邏輯 (保留您檔案中的原樣)
router.post('/start-new-game', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;

    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到使用者資料。' });
        }
        const userProfile = userDoc.data();
        const worldview = userProfile.worldview || 'wuxia';
        const prompts = loadPrompts(worldview);
        const initialPower = worldview === 'gundam' ? { machineSync: 5, pilotSkill: 5 } : { internal: 5, external: 5 };
        const initialPlayerAction = "我這是...在哪裡？";

        const aiResponse = await getAIStory(
            'gemini',
            "遊戲剛剛開始，一切都是未知。",
            "沒有歷史紀錄。",
            initialPlayerAction,
            userProfile,
            username,
            '清晨',
            initialPower,
            prompts.getStoryPrompt
        );

        if (!aiResponse) {
            throw new Error("AI未能生成開場故事。");
        }

        const newRoundNumber = 1;
        aiResponse.roundData.R = newRoundNumber;

        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(aiResponse.roundData);
        await userDocRef.collection('game_state').doc('summary').set({ text: "遊戲初始，一切皆有可能。", lastUpdated: 1 });
        await userDocRef.update({
            timeOfDay: aiResponse.roundData.timeOfDay,
            internalPower: aiResponse.roundData.internalPower || 5,
            externalPower: aiResponse.roundData.externalPower || 5
        });

        res.status(201).json(aiResponse);

    } catch (error) {
        console.error(`[UserID: ${userId}] /start-new-game 錯誤:`, error);
        res.status(500).json({ message: '建立新遊戲時發生內部伺服器錯誤。' });
    }
});

module.exports = router;
