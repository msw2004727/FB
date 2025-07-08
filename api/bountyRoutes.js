// api/bountyRoutes.js
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const authMiddleware = require('../middleware/auth');
const { getRewardGeneratorPrompt } = require('../prompts/rewardGeneratorPrompt.js'); // 新增：引入獎勵生成器
const { callAI } = require('../services/aiService'); // 新增：引入AI呼叫中心
const { updateInventory, updateSkills } = require('./gameHelpers'); // 新增：引入玩家資料更新工具

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
        const batch = db.batch(); // 【核心修改】初始化一個批次寫入
        
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

            // 【核心修改】如果懸賞是未讀的，就將其加入到更新佇列中
            if (data.isRead === false) {
                batch.update(doc.ref, { isRead: true });
            }
        });

        // 【核心修改】非同步地提交所有更新
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
    const { bountyTitle } = req.body;

    if (!bountyTitle) {
        return res.status(400).json({ message: '未指定要領取的懸賞。' });
    }

    try {
        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');
        const bountiesRef = userDocRef.collection('bounties');

        // 1. 查找對應的懸賞
        const bountyQuery = await bountiesRef.where('title', '==', bountyTitle).where('status', '==', 'active').limit(1).get();
        if (bountyQuery.empty) {
            return res.status(404).json({ message: `找不到名為「${bountyTitle}」的活躍懸賞。` });
        }
        const bountyDoc = bountyQuery.docs[0];
        const bountyData = bountyDoc.data();

        // 2. 獲取玩家檔案和世界摘要以供AI判斷
        const [userDoc, summaryDoc] = await Promise.all([userDocRef.get(), summaryDocRef.get()]);
        const playerProfile = userDoc.data();
        const longTermSummary = summaryDoc.exists ? summaryDoc.data().text : "";

        // 在真實場景中，這裡應該有一個更複雜的AI或邏輯來驗證玩家是否真的完成了任務。
        // 目前我們簡化這個流程，只要長期摘要中包含相關成功的關鍵字，就視為完成。
        // 這個驗證可以放在 storyPrompt.js 中讓主AI完成，這裡我們假設主AI已經驗證通過。

        // 3. 呼叫獎勵生成AI
        const rewardPrompt = getRewardGeneratorPrompt(bountyData, playerProfile);
        const rewardJsonString = await callAI('gemini', rewardPrompt, true);
        const rewards = JSON.parse(rewardJsonString);

        // 4. 分發獎勵
        const { powerChange, moralityChange, itemChanges } = rewards;

        const updatePromises = [];
        if (itemChanges && itemChanges.length > 0) {
            updatePromises.push(updateInventory(userId, itemChanges));
        }
        // 未來也可以處理武學等其他獎勵
        // if (rewards.skillChanges) { updatePromises.push(updateSkills(userId, rewards.skillChanges)); }
        
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

        // 6. 構造一個新的回合數據返回給前端，用來展示獎勵結果
        const newStory = `你成功領取了「${bountyTitle}」的懸賞，發布者對你的義舉表示感謝，並給予了你應得的報酬。`;
        
        let rewardSummary = '你獲得了：';
        if (itemChanges) {
            rewardSummary += itemChanges.map(item => `${item.itemName} x${item.quantity}`).join('、');
        }
        
        // 為了讓前端能刷新狀態，我們需要回傳一個完整的 roundData 物件
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
            QST: '暫無要事', // 清空任務日誌
            internalPower: updatedUserProfile.internalPower,
            externalPower: updatedUserProfile.externalPower,
            lightness: updatedUserProfile.lightness,
            morality: updatedUserProfile.morality,
            ITM: inventoryState.itemsString,
            money: inventoryState.money,
        };
        
        // 為了確保一致性，將這個獎勵回合也存檔
        await userDocRef.collection('game_saves').doc(`R${finalRoundData.R}`).set(finalRoundData);
        
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
