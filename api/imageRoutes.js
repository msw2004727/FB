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
    const { userId } = req.user;
    const { npcName } = req.params;

    try {
        const npcProfile = await getMergedNpcProfile(userId, npcName);
        if (!npcProfile) {
            return res.status(404).json({ message: '找不到該人物的檔案。' });
        }

        // 根據NPC的外觀描述生成圖片提示
        const imagePrompt = `A digital painting portrait of a character from ancient China. ${npcProfile.appearance}. Martial arts style, wuxia.`;

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        // 將圖片 URL 存回 NPC 的通用模板中
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
