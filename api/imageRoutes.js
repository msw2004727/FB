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

    const { userId } = req.user;
    const { npcName } = req.params;

    try {
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }

        // --- 【核心修改】將您的風格指令融入繪圖提示中 ---
        const imagePrompt = `A beautiful manga-style portrait of a character from the Northern Song Dynasty of ancient China. ${npcProfile.appearance}. Wuxia (martial arts hero) theme, elegant and aesthetic.`;
        // --- 修改結束 ---

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

    } catch (error)
        console.error(`[圖片系統] /generate/npc/:npcName 錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
