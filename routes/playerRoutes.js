// routes/playerRoutes.js

const express = require('express');
const admin = require('firebase-admin');
const { getAIPrequel, getAISuggestion } = require('../services/aiService.js');

const router = express.Router();
const db = admin.firestore();

// 讀取最新進度
router.get('/latest-game', async (req, res) => {
    const userId = req.user.id;
    const userDocRef = db.collection('users').doc(userId);
    try {
        const userDoc = await userDocRef.get();
        const userData = userDoc.data() || {};

        if (userData.isDeceased) {
            // 如果玩家已身故，回傳一個特殊狀態和最新的存檔資料供回顧
            const lastSaveSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
            const roundData = lastSaveSnapshot.empty ? null : lastSaveSnapshot.docs[0].data();
            return res.json({ gameState: 'deceased', roundData });
        }
        
        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(7).get();
        if (savesSnapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        const recentHistory = savesSnapshot.docs.map(doc => doc.data());
        const latestGameData = recentHistory[0];

        Object.assign(latestGameData, {
            internalPower: userData.internalPower || 5,
            externalPower: userData.externalPower || 5,
            lightness: userData.lightness || 5,
            morality: userData.morality === undefined ? 0 : userData.morality,
        });

        let prequel = null;
        if (recentHistory.length > 1) {
            const historyForPrequel = [...recentHistory].reverse();
            prequel = await getAIPrequel('deepseek', historyForPrequel);
        }
        
        const suggestion = await getAISuggestion('deepseek', latestGameData);

        res.json({
            prequel: prequel,
            story: `[進度已讀取] 你回到了 ${latestGameData.LOC[0]}，繼續你的冒險...`,
            roundData: latestGameData,
            suggestion: suggestion
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /latest-game 錯誤:`, error);
        res.status(500).json({ message: "讀取最新進度失敗。" });
    }
});

// 重新開始遊戲
router.post('/restart', async (req, res) => {
    const userId = req.user.id;
    try {
        const userDocRef = db.collection('users').doc(userId);
        
        const collectionsToDelete = ['game_saves', 'npcs', 'game_state'];
        
        for (const collectionName of collectionsToDelete) {
            const collectionRef = userDocRef.collection(collectionName);
            const snapshot = await collectionRef.get();
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
        
        const fieldsToDelete = {
            isDeceased: admin.firestore.FieldValue.delete(),
            timeOfDay: admin.firestore.FieldValue.delete(),
            internalPower: admin.firestore.FieldValue.delete(),
            externalPower: admin.firestore.FieldValue.delete(),
            lightness: admin.firestore.FieldValue.delete(),
            morality: admin.firestore.FieldValue.delete(),
            year: admin.firestore.FieldValue.delete(),
            month: admin.firestore.FieldValue.delete(),
            day: admin.firestore.FieldValue.delete(),
            yearName: admin.firestore.FieldValue.delete(),
            turnsSinceEvent: admin.firestore.FieldValue.delete(),
            preferredModel: admin.firestore.FieldValue.delete()
        };
        await userDocRef.update(fieldsToDelete);
        
        res.status(200).json({ message: '新的輪迴已開啟，願你這次走得更遠。' });

    } catch (error) {
        console.error(`[UserID: ${userId}] /restart 錯誤:`, error);
        res.status(500).json({ message: '開啟新的輪迴時發生錯誤。' });
    }
});

// 了卻此生
router.post('/force-suicide', async (req, res) => {
    const userId = req.user.id;
    const username = req.user.username;
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

        await userDocRef.update({ isDeceased: true });

        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? { R: 0 } : savesSnapshot.docs[0].data();
        
        const newRoundNumber = (lastRound.R || 0) + 1;
        
        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            timeOfDay: userProfile.timeOfDay || '上午',
            internalPower: userProfile.internalPower || 5,
            externalPower: userProfile.externalPower || 5,
            lightness: userProfile.lightness || 5,
            morality: userProfile.morality === undefined ? 0 : userProfile.morality,
            yearName: userProfile.yearName || '元祐',
            year: userProfile.year || 1,
            month: userProfile.month || 1,
            day: userProfile.day || 1,
            ATM: ['決絕', '悲壯'],
            EVT: '英雄末路',
            LOC: ['原地', {}],
            PSY: '江湖路遠，就此終焉。',
            PC: `${username}引動內力，逆轉經脈，在一陣刺目的光芒中...化為塵土。`,
            NPC: [],
            ITM: '隨身物品盡數焚毀。',
            QST: '所有恩怨情仇，煙消雲散。',
            WRD: '一聲巨響傳遍數里，驚動了遠方的勢力。',
            LOR: '',
            CLS: '',
            IMP: '你選擇了以最壯烈的方式結束這段江湖行。'
        };
        
        await userDocRef.collection('game_saves').doc(`R${newRoundNumber}`).set(finalRoundData);
        
        res.json({
            story: finalRoundData.PC,
            roundData: finalRoundData,
            suggestion: '你的江湖路已到盡頭...'
        });

    } catch (error) {
        console.error(`[UserID: ${userId}] /force-suicide 錯誤:`, error);
        res.status(500).json({ message: '了此殘生時發生未知錯誤...' });
    }
});

module.exports = router;
