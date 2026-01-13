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

        // --- 【核心修改】Prompt 風格優化區塊 ---
        const gender = npcProfile.gender ? npcProfile.gender.toLowerCase() : 'unknown';
        let styleSpecifics = "";
        
        // 根據性別決定描述
        if (gender.includes('female') || gender.includes('女')) {
            // 女性：穿著偏裸露、性感、迷人
            styleSpecifics = "Female character, wearing a bold and somewhat revealing Eastern fantasy outfit (穿著大膽且略為裸露的東方服飾), showing skin elegantly. Alluring pose, sensual vibe, beautiful face, expressive eyes.";
        } else if (gender.includes('male') || gender.includes('男')) {
            // 男性：帥氣、酷、英俊
            styleSpecifics = "Male character, extremely handsome and cool (英俊帥氣), sharp facial features, heroic and dashing appearance. Wearing stylish Eastern martial arts clothing.";
        } else {
            // 其他
            styleSpecifics = "Character with distinct personality features, wearing Eastern fantasy clothing.";
        }

        const characterDetails = `Age: ${npcProfile.age || 'Unknown'}, Gender: ${npcProfile.gender || 'Unknown'}, Title: ${npcProfile.status_title || 'Commoner'}, Appearance: ${npcProfile.appearance}, Personality: ${npcProfile.personality || 'Distinct'}`;
        
        // 組合最終 Prompt
        // 強調：日式手繪 (Hand-drawn)、白底 (White Background)、個性鮮明
        const imagePrompt = `(Masterpiece, best quality). 
        Japanese Hand-drawn Anime Style (日式手繪插畫風格), mixed with watercolor texture and distinct ink lines (水彩與墨線質感).
        Solo character portrait, clear white background (純白背景), no background elements.
        ${styleSpecifics}
        The character design should strongly reflect their personality. 
        Detailed hair and eyes, distinct facial expression.
        Character details: ${characterDetails}`;
        // --- 修改結束 ---
        
        console.log(`[圖片系統 v10.0] 步驟 1: 為「${canonicalNpcName}」請求臨時圖片 URL...`);
        // 注意：這裡依賴 services/aiService.js 中的設定 (建議確認那邊有開啟 HD + Vivid 以獲得最佳手繪效果)
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
