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
    // 檢查是否開啟繪圖功能
    if (process.env.ENABLE_IMAGE_GENERATION !== 'true') {
        return res.status(503).json({ success: false, message: 'AI 畫師目前正在休息，暫不提供服務。' });
    }
    
    const userId = req.user?.id;
    const username = req.user?.username;
    const { npcName } = req.params;

    // 基本驗證
    if (!userId || !npcName || typeof npcName !== 'string' || npcName.trim() === '') {
        return res.status(400).json({ success: false, message: '無效的使用者或NPC名稱。' });
    }

    try {
        // 1. 獲取使用者與存檔資料
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
        
        // 2. 獲取 NPC 完整設定 (融合動態資料)
        const npcProfile = await getMergedNpcProfile(userId, npcName, roundData, playerProfile);
        if (!npcProfile) {
            throw new Error(`系統無法找到或創建名為「${npcName}」的人物檔案。`);
        }
        
        // 3. 檢查是否已有頭像
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

        // ==========================================
        //       【核心修改】 Prompt 建構邏輯 (防護升級)
        // ==========================================

        console.log(`[圖片系統] 正在處理 NPC: ${canonicalNpcName}, 原始個性資料:`, npcProfile.personality);

        // A. 畫風鎖定 (Style Anchor)
        const STYLE_ANCHOR = `
            [Art Style]: Japanese 2D Anime Style (日式動畫風格), High-Quality Hand-drawn Illustration.
            [Technique]: Flat Cel Shading (賽璐珞平塗), Clean Vector Lines (G-pen ink style), Hard-edge shadows.
            [Format]: Character Tachie (單人立繪), Solo Portrait, Upper-body to Knees.
            [Background]: PURE WHITE BACKGROUND (#FFFFFF), Empty, No Environment, No Text, No Watermarks.
        `;

        // B. 資料解析 (Data Parsing) - 全面加上 String() 強制轉型
        // 使用 try-catch 確保變數解析絕對不會導致 Server Crash
        let personality = "";
        let roleLower = "";
        let gender = "";
        let age = "";
        let appearanceBase = "";
        let role = "";

        try {
            // 強制轉型為 String，即使是 undefined, null, Array, Object 都不會報錯
            gender = String(npcProfile.gender || 'Unknown');
            age = String(npcProfile.age || 'Unknown');
            role = String(npcProfile.occupation || npcProfile.identity || 'Wanderer');
            appearanceBase = String(npcProfile.appearance || 'Distinct eastern features');
            
            // 這是最常出錯的地方，我們用 String() 包起來，並確保轉小寫
            personality = String(npcProfile.personality || '').toLowerCase(); 
            roleLower = String(role).toLowerCase();
        } catch (parseError) {
            console.error(`[圖片系統] 資料解析異常 (已自動修復):`, parseError);
            personality = "neutral"; // 發生錯誤時的預設值
            roleLower = "wanderer";
        }

        // C. 動態特徵映射 - 根據個性決定表情 (Expression Mapping)
        let facialExpression = "Calm and neutral expression";
        let poseVibe = "Standing naturally";

        if (personality.includes('evil') || personality.includes('cruel') || personality.includes('陰險') || personality.includes('惡')) {
            facialExpression = "Slightly sinister smirk, sharp narrowed eyes, arrogant look";
            poseVibe = "Threatening posture, confident stance";
        } else if (personality.includes('kind') || personality.includes('gentle') || personality.includes('溫柔') || personality.includes('善')) {
            facialExpression = "Gentle warm smile, soft eyes, welcoming look";
            poseVibe = "Elegant and relaxed posture";
        } else if (personality.includes('crazy') || personality.includes('mad') || personality.includes('狂')) {
            facialExpression = "Manic expression, wide eyes, gritting teeth, intense look";
            poseVibe = "Unstable, dynamic, wild posture";
        } else if (personality.includes('stoic') || personality.includes('cold') || personality.includes('冷')) {
            facialExpression = "Expressionless, icy cold stare, closed mouth";
            poseVibe = "Rigid, upright posture, arms crossed or hands at side";
        }

        // D. 動態特徵映射 - 根據身分決定服裝材質 (Outfit Mapping)
        let outfitTexture = "Standard Eastern Fantasy fabric";

        if (roleLower.includes('beggar') || roleLower.includes('丐')) {
            outfitTexture = "Tattered, patched rough linen, dirty texture, worn-out edges";
        } else if (roleLower.includes('noble') || roleLower.includes('royal') || roleLower.includes('皇') || roleLower.includes('官')) {
            outfitTexture = "Luxurious silk with intricate golden embroidery, pristine condition, jade accessories";
        } else if (roleLower.includes('warrior') || roleLower.includes('guard') || roleLower.includes('俠') || roleLower.includes('兵')) {
            outfitTexture = "Practical martial arts attire, leather armor accents, durable fabric, fitted for combat";
        } else if (roleLower.includes('scholar') || roleLower.includes('儒')) {
            outfitTexture = "Clean scholar robes, loose flowing sleeves, cotton or silk, orderly appearance";
        }

        // E. 最終 Prompt 組合
        const imagePrompt = `
            ${STYLE_ANCHOR}
            
            [Character Definition]
            Name: ${canonicalNpcName}
            Role: ${role}
            Gender: ${gender}
            Age: ${age}
            
            [Visual Details]
            1. Appearance: ${appearanceBase}
            2. Outfit Style: ${outfitTexture}. (Must reflect the character's social status: ${role}).
            3. Facial Expression: ${facialExpression}. (Reflecting personality: ${personality}).
            4. Pose: ${poseVibe}.
            
            [Strict Constraints]
            - DRAW ONLY ONE CHARACTER.
            - NO background objects, NO trees, NO buildings, NO magic effects floating around.
            - NO text, NO speech bubbles, NO signature, NO character sheet layout grid.
            - The image must look like a professional Visual Novel game asset (Sprite).
        `.replace(/\s+/g, ' ').trim();

        console.log(`[圖片系統 v10.1] Prompt 已生成 (長度: ${imagePrompt.length})`);
        
        // 4. 調用 AI 服務
        const tempImageUrl = await getAIGeneratedImage(imagePrompt);
        if (!tempImageUrl) {
            throw new Error('AI 畫師創作失敗，請稍後再試。');
        }

        console.log(`[圖片系統 v10.1] 步驟 2: 下載圖片...`);
        const response = await gaxios.request({
            url: tempImageUrl,
            responseType: 'arraybuffer'
        });
        const imageBuffer = Buffer.from(response.data);

        console.log(`[圖片系統 v10.1] 步驟 3: 上傳至 Firebase Storage...`);
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
        console.log(`[圖片系統 v10.1] 步驟 4: 獲取永久 URL: ${permanentUrl}`);

        // 5. 更新資料庫與快取
        const npcTemplateRef = db.collection('npcs').doc(canonicalNpcName);
        await npcTemplateRef.set({
            avatarUrl: permanentUrl
        }, { merge: true });

        const updatedNpcTemplate = (await npcTemplateRef.get()).data();
        if (updatedNpcTemplate) {
            setTemplateInCache('npc', canonicalNpcName, updatedNpcTemplate);
        }
        
        res.json({
            success: true,
            message: `已成功為 ${canonicalNpcName} 繪製新的肖像。`,
            avatarUrl: permanentUrl
        });

    } catch (error) {
        console.error(`[圖片系統 v10.1] 嚴重錯誤:`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
