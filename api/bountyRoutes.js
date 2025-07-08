// api/bountyRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getRewardGeneratorPrompt } = require('../prompts/rewardGeneratorPrompt.js');
// 【核心修改】從 aiService 引入 aiConfig
const { callAI, aiConfig } = require('../services/aiService');
const { updateInventory, updateSkills, getInventoryState, invalidateNovelCache, updateLibraryNovel } = require('./gameHelpers');

const db = admin.firestore();

// 所有此路由下的請求都需要先經過身份驗證
router.use(authMiddleware);

/**
 * @route   GET /api/bounties
 * @desc    獲取當前玩家所有活躍的懸賞任務
 * @access  Private
 */
router.get('/', async (req, res) => {
    const userId = req.user.id;
    try {
        const now = admin.firestore.Timestamp.now();
        const bountiesRef = db.collection('users').doc(userId).collection('bounties');
        
        const snapshot = await bountiesRef
            .where('status', '==', 'active')
            .where('expireAt', '>', now)
            .orderBy('expireAt', 'asc')
            .get();

        if (snapshot.empty) {
            return res.json([]);
        }

        const bountiesList = [];
        const batch = db.batch();
        
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            bountiesList.push({
                id: doc.id,
                title: data.title,
                content: data.content,
                issuer: data.issuer,
                difficulty: data.difficulty,
                expireAt: data.expireAt.toDate() 
            });

            if (data.isRead === false) {
                batch.update(doc.ref, { isRead: true });
            }
        });

        await batch.commit();
        console.log(`[懸賞系統] 已將玩家 ${userId} 的 ${snapshot.docs.length} 條懸賞標記為已讀。`);

        res.json(bountiesList);

    } catch (error) {
        console.error(`[懸賞系統] 獲取玩家 ${userId} 的懸賞列表時發生錯誤:`, error);
        res.status(500).json({ message: '讀取懸賞告示時發生內部錯誤。' });
    }
});


/**
 * @route   POST /api/bounties/claim
 * @desc    玩家嘗試領取懸賞獎勵
 * @access  Private
 */
router.post('/claim', async (req, res) => {
    const userId = req.user.id;
    // 【核心修改】從請求中移除 bountyTitle，因為我們已經不再使用它了
    // const { bountyTitle } = req.body;

    // 由於我們上一個步驟已經將驗證邏輯移交給主 AI，這裡的獨立驗證可以簡化或移除
    // 我們假設能進入此路由的請求，都已經由 gameplayRoutes 中的 interactRouteHandler 驗證過
    // 為了安全，我們還是保留一個基本的檢查
    const { bountyTitle } = req.body;
     if (!bountyTitle) {
        return res.status(400).json({ message: '未指定要領取的懸賞。' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const bountiesRef = userDocRef.collection('bounties');

        // 1. 查找對應的懸賞
        const bountyQuery = await bountiesRef.where('title', '==', bountyTitle).where('status', '==', 'active').limit(1).get();
        if (bountyQuery.empty) {
            return res.status(404).json({ message: `找不到名為「${bountyTitle}」的活躍懸賞或任務已被完成。` });
        }
        const bountyDoc = bountyQuery.docs[0];
        const bountyData = bountyDoc.data();

        // 2. 獲取玩家檔案以供AI判斷
        const userDoc = await userDocRef.get();
        const playerProfile = userDoc.data();

        // 3. 呼叫獎勵生成AI
        const rewardPrompt = getRewardGeneratorPrompt(bountyData, playerProfile);
        // 【核心修改】將寫死的 'gemini' 改為從 aiConfig 讀取
        const rewardJsonString = await callAI(aiConfig.reward, rewardPrompt, true);
        const rewards = JSON.parse(rewardJsonString);

        // 4. 分發獎勵
        const { powerChange, moralityChange, itemChanges } = rewards;

        const updatePromises = [];
        if (itemChanges && itemChanges.length > 0) {
            updatePromises.push(updateInventory(userId, itemChanges));
        }
        
        const updates = {};
        if (powerChange) {
            updates.internalPower = admin.firestore.FieldValue.increment(powerChange.internal || 0);
            updates.externalPower = admin.firestore.FieldValue.increment(powerChange.external || 0);
            updates.lightness = admin.firestore.FieldValue.increment(powerChange.lightness || 0);
        }
        if (moralityChange) {
            updates.morality = admin.firestore.FieldValue.increment(moralityChange || 0);
        }
        if (Object.keys(updates).length > 0) {
            updatePromises.push(userDocRef.update(updates));
        }
        
        await Promise.all(updatePromises);
        
        // 5. 更新懸賞狀態
        await bountyDoc.ref.update({ status: 'completed' });

        console.log(`[懸賞系統] 玩家 ${req.user.username} 成功領取懸賞: ${bountyTitle}`);

        // 6. 構造一個新的回合數據返回給前端
        const newStory = `你成功領取了「${bountyTitle}」的懸賞，發布者對你的義舉表示感謝，並給予了你應得的報酬。`;
        
        let rewardSummary = '你獲得了：';
        if (itemChanges) {
            rewardSummary += itemChanges.map(item => `${item.itemName} x${item.quantity}`).join('、');
        } else {
            rewardSummary = "江湖聲望就是最好的獎勵。";
        }
        
        const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRoundData = lastSaveSnapshot.docs[0].data();
        
        const updatedUserDoc = await userDocRef.get();
        const updatedUserProfile = updatedUserDoc.data();
        const inventoryState = await getInventoryState(userId);

        const finalRoundData = {
            ...lastRoundData,
            R: lastRoundData.R + 1,
            story: newStory,
            PC: rewardSummary,
            EVT: `完成懸賞：${bountyTitle}`,
            QST: '暫無要事',
            internalPower: updatedUserProfile.internalPower,
            externalPower: updatedUserProfile.externalPower,
            lightness: updatedUserProfile.lightness,
            morality: updatedUserProfile.morality,
            ITM: inventoryState.itemsString,
            money: inventoryState.money,
        };
        
        await userDocRef.collection('game_saves').doc(`R${finalRoundData.R}`).set(finalRoundData);
        await invalidateNovelCache(userId);
        updateLibraryNovel(userId, req.user.username).catch(err => console.error("背景更新圖書館失敗(懸賞):", err));
        
        res.json({
            message: '懸賞領取成功！',
            newRound: {
                story: finalRoundData.story,
                roundData: finalRoundData,
                suggestion: "江湖之大，何處不可去得？"
            }
        });

    } catch (error) {
        console.error(`[懸賞系統] 玩家 ${req.user.username} 領取懸賞 ${bountyTitle} 時發生錯誤:`, error);
        res.status(500).json({ message: '領取懸賞時發生內部錯誤。' });
    }
});


module.exports = router;
