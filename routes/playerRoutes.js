// routes/playerRoutes.js

import express from 'express';
import admin from 'firebase-admin';
import { getAIPrequel, getAISuggestion, getNarrative } from '../services/aiService.js';

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
            return res.json({ gameState: 'deceased' });
        }
        
        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        if (savesSnapshot.empty) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        
        const latestGameData = savesSnapshot.docs[0].data();

        Object.assign(latestGameData, {
            internalPower: userData.internalPower || 5,
            externalPower: userData.externalPower || 5,
            lightness: userData.lightness || 5,
            morality: userData.morality === undefined ? 0 : userData.morality,
        });

        const suggestion = await getAISuggestion('deepseek', latestGameData);

        res.json({
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
        
        const savesCollectionRef = userDocRef.collection('game_saves');
        const npcsCollectionRef = userDocRef.collection('npcs');

        const batch = db.batch();
        
        const savesSnapshot = await savesCollectionRef.get();
        savesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        
        const npcsSnapshot = await npcsCollectionRef.get();
        npcsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        
        await batch.commit();

        await userDocRef.collection('game_state').doc('summary').delete().catch(() => {});
        await userDocRef.collection('game_state').doc('novel_cache').delete().catch(() => {});
        
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
        await userDocRef.update({ isDeceased: true });

        const savesSnapshot = await userDocRef.collection('game_saves').orderBy('R', 'desc').limit(1).get();
        const lastRound = savesSnapshot.empty ? { R: 0 } : savesSnapshot.docs[0].data();
        
        const newRoundNumber = (lastRound.R || 0) + 1;
        
        const finalRoundData = {
            R: newRoundNumber,
            playerState: 'dead',
            PC: `${username}引動內力，逆轉經脈，在一陣刺目的光芒中...化為塵土。`,
            // ... 其他最終回合數據
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

export default router;
