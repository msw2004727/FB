// /api/imageRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIGeneratedImage } = require('../services/aiService');
const { getMergedNpcProfile } = require('./npcHelpers');
const authMiddleware = require('../middleware/auth');

const db = admin.firestore();

/**
 * @route   POST /api/image/generate/npc/:npcName
 * @desc    為指定NPC生成並儲存頭像
 * @access  Private
 */
router.post('/generate/npc/:npcName', authMiddleware, async (req, res) => {
    if (process.env.ENABLE_IMAGE_GENERATION !== 'true') {
        console.log('[圖片系統] 收到圖片生成請求，但該功能已被環境變數關閉。');
        return res.status(503).json({ success: false, message: 'AI 畫師目前正在休息，暫不提供服務。' });
    }

    const { userId, username } = req.user;
    const { npcName } = req.params;

    try {
        // --- 【核心修正】在呼叫 getMergedNpcProfile 之前，先獲取必要的上下文 ---
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
        // --- 修正結束 ---

        // 將完整的上下文資訊傳遞給 getMergedNpcProfile
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);
        if (!npcProfile) {
            // 這個錯誤現在只會在資料庫確實沒有該 NPC 模板時觸發
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }

        const imagePrompt = `A beautiful manga-style portrait of a character from the Northern Song Dynasty of ancient China. ${npcProfile.appearance}. Wuxia (martial arts hero) theme, elegant and aesthetic.`;

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        const npcTemplateRef = db.collection('npcs').doc(npcName);
        await npcTemplateRef.set({
            avatarUrl: imageUrl
        }, { merge: true });

        console.log(`[圖片系統] 已成功為 NPC「${npcName}」生成並儲存頭像。`);

        res.json({
            success: true,
            message: `已成功為 ${npcName} 繪製新的肖像。`,
            avatarUrl: imageUrl
        });

    } catch (error) {
        console.error(`[圖片系統] /generate/npc/:npcName 錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
