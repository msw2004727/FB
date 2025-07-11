// /api/contextBuilder.js
const admin = require('firebase-admin');
const {
    getMergedNpcProfile,
    getMergedLocationData,
    getInventoryState,
    getPlayerSkills,
    getRawInventory
} = require('./gameHelpers');

const db = admin.firestore();

/**
 * 遊戲狀態產生器 (Context Builder)
 * @param {string} userId - The user's ID.
 * @param {string} username - The user's name.
 * @returns {Promise<object>} A comprehensive context object for the current game state.
 */
async function buildContext(userId, username) {
    try {
        console.log(`[Context Builder] Starting context build for user: ${username} (${userId})`);

        const userDocRef = db.collection('users').doc(userId);
        const summaryDocRef = userDocRef.collection('game_state').doc('summary');

        // --- 1. 並行獲取所有基礎資料 ---
        const [
            userDoc,
            summaryDoc,
            savesSnapshot,
            skills,
            rawInventory
        ] = await Promise.all([
            userDocRef.get(),
            summaryDocRef.get(),
            userDocRef.collection('game_saves').orderBy('R', 'desc').limit(3).get(),
            getPlayerSkills(userId),
            getRawInventory(userId)
        ]);

        if (savesSnapshot.empty) {
            // 處理全新玩家，還沒有任何存檔的情況
            console.log(`[Context Builder] New player detected. Building initial context.`);
            const initialUserData = userDoc.exists ? userDoc.data() : {};
            return {
                player: { ...initialUserData, username, skills, ...rawInventory },
                longTermSummary: "遊戲剛剛開始...",
                recentHistory: [],
                locationContext: null,
                npcContext: {},
                bulkScore: 0,
                isNewGame: true
            };
        }

        // --- 2. 組裝玩家核心資料 ---
        const userProfile = userDoc.exists ? userDoc.data() : {};
        const lastSave = savesSnapshot.docs[0].data();

        // 計算負重分數
        let totalBulkScore = 0;
        if (rawInventory) {
            Object.values(rawInventory).forEach(item => {
                const quantity = item.quantity || 1;
                switch (item.bulk) {
                    case '中': totalBulkScore += 1 * quantity; break;
                    case '重': totalBulkScore += 3 * quantity; break;
                    case '極重': totalBulkScore += 10 * quantity; break;
                    default: break;
                }
            });
        }
        
        const playerContext = {
            ...userProfile,
            username,
            skills,
            ...rawInventory, // 將物品詳情合併進來
            currentLocation: lastSave.LOC,
            stamina: userProfile.stamina === undefined ? 100 : userProfile.stamina,
            morality: userProfile.morality === undefined ? 0 : userProfile.morality,
            power: {
                internal: userProfile.internalPower || 5,
                external: userProfile.externalPower || 5,
                lightness: userProfile.lightness || 5
            },
            currentDate: {
                yearName: userProfile.yearName || lastSave.yearName || '元祐',
                year: userProfile.year || lastSave.year || 1,
                month: userProfile.month || lastSave.month || 1,
                day: userProfile.day || lastSave.day || 1,
            },
            currentTimeOfDay: userProfile.timeOfDay || '上午'
        };


        // --- 3. 並行獲取依賴性資料 (地點 & NPC) ---
        const [locationContext, npcContext] = await Promise.all([
            getMergedLocationData(userId, lastSave.LOC),
            (async () => {
                const context = {};
                if (lastSave.NPC && lastSave.NPC.length > 0) {
                    const npcPromises = lastSave.NPC.map(npcInScene => getMergedNpcProfile(userId, npcInScene.name));
                    const npcProfiles = await Promise.all(npcPromises);
                    npcProfiles.forEach(profile => {
                        if (profile) {
                            context[profile.name] = profile;
                        }
                    });
                }
                return context;
            })()
        ]);
        
        // --- 4. 整理最終回傳的物件 ---
        const finalContext = {
            player: playerContext,
            longTermSummary: summaryDoc.exists ? summaryDoc.data().text : "遊戲剛剛開始...",
            recentHistory: savesSnapshot.docs.map(doc => doc.data()).sort((a, b) => a.R - b.R),
            locationContext: locationContext,
            npcContext: npcContext,
            bulkScore: totalBulkScore,
            isNewGame: false
        };

        console.log(`[Context Builder] Context build completed successfully for ${username}.`);
        return finalContext;

    } catch (error) {
        console.error(`[Context Builder] Error building context for user ${userId}:`, error);
        // 在錯誤情況下回傳一個安全的空物件或null，防止上游崩潰
        return null;
    }
}

module.exports = { buildContext };
