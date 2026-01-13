// /api/imageRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { getAIGeneratedImage } = require('../services/aiService');
const { getMergedNpcProfile } = require('./npcHelpers');
const authMiddleware = require('../middleware/auth');
const { setTemplateInCache } = require('./cacheManager');
const gaxios = require('gaxios'); 

const db = admin.firestore();
const storage = admin.storage(); 

router.post('/generate/npc/:npcName', authMiddleware, async (req, res) => {
    if (process.env.ENABLE_IMAGE_GENERATION !== 'true') {
        return res.status(503).json({ success: false, message: 'AI 畫師目前正在休息，暫不提供服務。' });
    }
    
    const userId = req.user?.id;
    const username = req.user?.username;
    const { npcName } = req.params;

    if (!userId || !npcName || typeof npcName !== 'string' || npcName.trim() === '') {
        return res.status(400).json({ success: false, message: '無效的使用者或NPC名稱。' });
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
            console.log(`[圖片系統] NPC「${npcProfile.name}」的肖像已存在，無需重複生成。`);
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

        // --- 【核心修改】畫風統一邏輯 ---
        
        // 1. 定義一個「絕對統一」的基礎風格模板
        // 使用 "Official Character Design Sheet" 和 "Flat Cel Shading" 來強制統一
        const UNIFIED_STYLE_BASE = `
            Type: Official Anime Character Design Sheet (官方動畫角色設定圖).
            Art Style: High-quality 2D Anime Illustration (高品質2D動畫插畫).
            Technique: Flat Cel Shading (賽璐珞平塗), Clean Vector Lines (乾淨的向量線條), No messy sketch lines.
            Lighting: Uniform Soft Studio Lighting (統一柔和棚光), No dramatic shadows, No lens flare.
            Background: Pure White Background (純白背景), isolated character.
            Vibe: Professional Game Asset (專業遊戲素材).
        `;

        const gender = npcProfile.gender ? npcProfile.gender.toLowerCase() : 'unknown';
        let styleSpecifics = "";
        
        // 2. 根據性別微調，但保持在上述框架內
        if (gender.includes('female') || gender.includes('女')) {
            // 女性：強調曲線與魅力，但畫風要乾淨
            styleSpecifics = "Subject: Female character. Outfit: Bold and revealing Eastern fantasy robes, showing skin aesthetically. Features: Beautiful face, alluring expression, intricate hair ornaments.";
        } else if (gender.includes('male') || gender.includes('男')) {
            // 男性：強調挺拔與英氣，線條可稍硬朗
            styleSpecifics = "Subject: Male character. Outfit: Stylish Eastern martial artist attire. Features: Handsome, cool, sharp facial definition, confident stance.";
        } else {
            styleSpecifics = "Subject: Character with distinct features. Outfit: Eastern fantasy clothing.";
        }

        const characterDetails = `Age: ${npcProfile.age || 'Unknown'}, Appearance Details: ${npcProfile.appearance}, Personality: ${npcProfile.personality || 'Distinct'}`;
        
        // 3. 組合 Prompt：基礎風格 + 角色特徵 + 再次強調乾淨
        const imagePrompt = `
            ${UNIFIED_STYLE_BASE}
            ${styleSpecifics}
            Character Details: ${characterDetails}
            (Masterpiece, best quality, ultra-detailed face, 8k resolution).
            Ensure the image is a solo portrait with no background objects.
        `.replace(/\s+/g, ' ').trim(); // 移除多餘空白
        // --- 修改結束 ---
        
        console.log(`[圖片系統 v10.0] 步驟 1: 為「${canonicalNpcName}」請求臨時圖片 URL...`);
        // 使用 services/aiService.js 發送請求
        const tempImageUrl = await getAIGeneratedImage(imagePrompt);
        if (!tempImageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        console.log(`[圖片系統 v10.0] 步驟 2: 從臨時 URL 下載圖片...`);
        const response = await gaxios.request({
            url: tempImageUrl,
            responseType: 'arraybuffer'
        });
        const imageBuffer = Buffer.from(response.data);

        console.log(`[圖片系統 v10.0] 步驟 3: 將圖片上傳至 Firebase Storage...`);
        const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);
        const fileName = `npc-avatars/${canonicalNpcName}_${Date.now()}.png`;
        const file = bucket.file(fileName);

        await file.save(imageBuffer, {
            metadata: {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000',
            },
        });
        
        await file.makePublic();
        const permanentUrl = file.publicUrl();
        console.log(`[圖片系統 v10.0] 步驟 4: 獲取永久 URL 並存入資料庫: ${permanentUrl}`);

        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: permanentUrl
        }, { merge: true });

        const updatedNpcTemplate = (await npcTemplateRef.get()).data();
        if (updatedNpcTemplate) {
            setTemplateInCache('npc', canonicalNpcName, updatedNpcTemplate);
            console.log(`[圖片系統 v10.0] 已將「${canonicalNpcName}」的最新資料（包含永久頭像）同步至伺服器快取。`);
        }
        
        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: permanentUrl
        });

    } catch (error) {
        console.error(`[圖片系統 v10.0] /generate/npc/${npcName} 處理過程中發生嚴重錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
