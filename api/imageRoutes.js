// /api/imageRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIGeneratedImage } = require('../services/aiService');
const { getMergedNpcProfile } = require('./npcHelpers');
const authMiddleware = require('../middleware/auth');
const { setTemplateInCache } = require('./cacheManager');

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
        
        if (npcProfile.avatarUrl) {
            console.log(`[圖片系統 v7.0] NPC「${npcProfile.name}」的肖像已存在，無需重複生成。直接回傳現有URL。`);
            return res.json({
                success: true,
                message: `已從資料庫中找到 ${npcProfile.name} 的肖像。`,
                avatarUrl: npcProfile.avatarUrl
            });
        }

        const canonicalNpcName = npcProfile.name;
        if (!canonicalNpcName || typeof canonicalNpcName !== 'string' || canonicalNpcName.trim() === '') {
             throw new Error(`為 ${npcName} 獲取的資料中缺少有效的姓名。`);
        }

        // --- 【核心修正】採用全新、更強力、更穩定的風格提示詞 ---
        const characterDetails = `Age: ${npcProfile.age || 'Unknown'}, Gender: ${npcProfile.gender || 'Unknown'}, Title: ${npcProfile.status_title || 'Commoner'}, Appearance: ${npcProfile.appearance}`;
        const imagePrompt = `(Masterpiece, best quality, ultra-detailed). Style: Polished Japanese game CG, anime key visual, otome game character art, cel-shaded, vibrant colors, cinematic lighting. NOT a photo, NOT 3D. Content: A 3/4 view close-up portrait of a single character against a minimal, softly blurred background with hints of Chinese ink wash mountains. Character Details to incorporate: ${characterDetails}`;
        
        console.log(`[圖片系統 v9.0] 正在為「${canonicalNpcName}」使用強化的遊戲CG風格生成頭像...`);

        const imageUrl = await getAIGeneratedImage(imagePrompt);
        if (!imageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: imageUrl
        }, { merge: true });

        const updatedNpcTemplate = (await npcTemplateRef.get()).data();
        if (updatedNpcTemplate) {
            setTemplateInCache('npc', canonicalNpcName, updatedNpcTemplate);
            console.log(`[圖片系統 v9.0] 已將「${canonicalNpcName}」的最新資料（包含頭像）同步至伺服器快取。`);
        }

        console.log(`[圖片系統 v9.0] 成功為 NPC「${canonicalNpcName}」生成並儲存頭像。`);
        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: imageUrl
        });

    } catch (error) {
        console.error(`[圖片系統 v9.0] /generate/npc/${npcName} 處理過程中發生嚴重錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
