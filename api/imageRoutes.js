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
        console.log('[圖片系統] 收到圖片生成請求，但該功能已被環境變數關閉。');
        return res.status(503).json({ success: false, message: 'AI 畫師目前正在休息，暫不提供服務。' });
    }

    const { userId, username } = req.user;
    const { npcName } = req.params;

    console.log(`[圖片系統 v2.0] 收到為「${npcName}」生成頭像的請求...`);

    if (!npcName || typeof npcName !== 'string' || npcName.trim() === '') {
        return res.status(400).json({ success: false, message: '無效的NPC名稱。' });
    }

    try {
        console.log(`[圖片系統 v2.0] 步驟 1: 獲取玩家與存檔上下文... (UserID: ${userId})`);
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
        
        console.log(`[圖片系統 v2.0] 步驟 2: 獲取或創建NPC「${npcName}」的合併檔案...`);
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);

        if (!npcProfile) {
            throw new Error(`系統無法找到或創建名為「${npcName}」的人物檔案，請檢查AI設定或資料庫。`);
        }

        const canonicalNpcName = npcProfile.name;
        if (!canonicalNpcName || typeof canonicalNpcName !== 'string' || canonicalNpcName.trim() === '') {
             throw new Error(`為 ${npcName} 獲取的資料中缺少有效的姓名 (canonicalNpcName is invalid)。`);
        }

        console.log(`[圖片系統 v2.0] 步驟 3: 為「${canonicalNpcName}」準備圖片生成提示...`);
        const imagePrompt = `A beautiful manga-style portrait of a character from the Northern Song Dynasty of ancient China. ${npcProfile.appearance}. Wuxia (martial arts hero) theme, elegant and aesthetic.`;

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        console.log(`[圖片系統 v2.0] 步驟 4: 將圖片URL「${imageUrl}」儲存至NPC「${canonicalNpcName}」的檔案中...`);
        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: imageUrl
        }, { merge: true });

        console.log(`[圖片系統 v2.0] 成功為 NPC「${canonicalNpcName}」生成並儲存頭像。`);
        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: imageUrl
        });

    } catch (error) {
        console.error(`[圖片系統 v2.0] /generate/npc/${npcName} 處理過程中發生嚴重錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
