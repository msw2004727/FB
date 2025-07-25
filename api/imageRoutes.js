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
        // --- 獲取生成圖片所需的所有上下文 ---
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
        
        // 呼叫 getMergedNpcProfile，它可能會在背景創建新的NPC
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);

        if (!npcProfile) {
            // 如果創建失敗或找不到，npcProfile 會是 null
            return res.status(404).json({ message: `找不到或無法創建名為「${npcName}」的人物檔案。` });
        }

        // 【核心修正】從回傳的 npcProfile 中獲取最權威的名稱
        const canonicalNpcName = npcProfile.name;
        if (!canonicalNpcName) {
            throw new Error(`為 ${npcName} 獲取的資料中缺少有效的姓名。`);
        }
        
        console.log(`[圖片系統] 正在為「${canonicalNpcName}」 (原始請求: ${npcName}) 生成頭像...`);

        const imagePrompt = `A beautiful manga-style portrait of a character from the Northern Song Dynasty of ancient China. ${npcProfile.appearance}. Wuxia (martial arts hero) theme, elegant and aesthetic.`;

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        // 【核心修正】使用最權威的 canonicalNpcName 來儲存頭像
        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: imageUrl
        }, { merge: true });

        console.log(`[圖片系統] 已成功為 NPC「${canonicalNpcName}」生成並儲存頭像。`);

        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: imageUrl
        });

    } catch (error) {
        console.error(`[圖片系統] /generate/npc/${npcName} 錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
