// /api/imageRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIGeneratedImage } = require('../services/aiService');
const { getMergedNpcProfile } = require('./npcHelpers');
const authMiddleware = require('../middleware/auth');

const db = admin.firestore();

router.post('/generate/npc/:npcName', authMiddleware, async (req, res) => {
    if (process.env.ENABLE_IMAGE_GENERATION !== 'true') {
        return res.status(503).json({ success: false, message: 'AI 畫師目前正在休息，暫不提供服務。' });
    }
    
    const userId = req.user?.id;
    const username = req.user?.username;
    const { npcName } = req.params;

    if (!userId) {
        console.error('[圖片系統 v3.0] 嚴重錯誤：經過驗證中介軟體後，userId 依然為空！');
        return res.status(500).json({ success: false, message: '伺服器內部錯誤：無法識別您的使用者身份。' });
    }
    if (!npcName || typeof npcName !== 'string' || npcName.trim() === '') {
        return res.status(400).json({ success: false, message: '無效的NPC名稱。' });
    }

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: '找不到玩家檔案。' });
        }
        const playerProfile = { ...userDoc.data(), username: username };

        const lastSaveSnapshot = await db.collection('users').doc(userId).collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (lastSaveSnapshot.empty) {
            return res.status(404).json({ message: '找不到玩家存檔。' });
        }
        const roundData = lastSaveSnapshot.docs[0].data();
        
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);

        if (!npcProfile) {
            throw new Error(`系統無法找到或創建名為「${npcName}」的人物檔案。`);
        }

        const canonicalNpcName = npcProfile.name;
        if (!canonicalNpcName || typeof canonicalNpcName !== 'string' || canonicalNpcName.trim() === '') {
             throw new Error(`為 ${npcName} 獲取的資料中缺少有效的姓名。`);
        }

        // --- 【核心修正】採用您指定的全新水彩動漫藝術風格指令 ---
        const imagePrompt = `A soft watercolor-inspired anime portrait in an ancient East Asian martial arts style. Focus on a single character only (no other people), showing an upper-body or close-up bust shot. The character wears traditional hanfu-style clothing with flowing sleeves and a tied sash. The artwork features clean, thin linework, pastel and muted tones, and a watercolor-like wash for a light, elegant mood. No background or scenery, only the character on a clean background (plain color or white). The style combines Japanese animation aesthetics with subtle traditional Chinese brush textures. Character description: ${npcProfile.appearance}`;
        
        console.log(`[圖片系統 v6.0] 正在為「${canonicalNpcName}」使用全新水彩動漫風格生成頭像...`);

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: imageUrl
        }, { merge: true });

        console.log(`[圖片系統 v6.0] 成功為 NPC「${canonicalNpcName}」生成並儲存頭像。`);
        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: imageUrl
        });

    } catch (error) {
        console.error(`[圖片系統 v6.0] /generate/npc/${npcName} 處理過程中發生嚴重錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
