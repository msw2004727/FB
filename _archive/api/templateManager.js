// /api/templateManager.js
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * 在NPC模板池中尋找一個可復用的NPC
 * @param {string} identity - 需要尋找的NPC身份，例如 "鐵匠", "商人", "郎中"
 * @param {Array<string>} exclusionList - 需要排除的NPC名單（例如玩家已經在本局遊戲中遇到的NPC）
 * @returns {Promise<Object|null>} - 如果找到，返回NPC的基礎資料物件；否則返回null
 */
async function findReusableNpc(identity, exclusionList = []) {
    console.log(`[模板管理器] 開始尋找身份為「${identity}」的可復用NPC...`);
    
    try {
        const npcsRef = db.collection('npcs');
        // 查詢條件：
        // 1. 身份(status_title)必須相符
        // 2. 不能是已經死亡的NPC
        let query = npcsRef.where('status_title', '==', identity).where('isDeceased', '==', false);
        
        const snapshot = await query.get();

        if (snapshot.empty) {
            console.log(`[模板管理器] 在模板池中找不到任何身份為「${identity}」的NPC。`);
            return null;
        }

        // 從查詢結果中，過濾掉已經在玩家遊戲中出現的NPC
        const availableNpcs = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(npc => !exclusionList.includes(npc.id));

        if (availableNpcs.length === 0) {
            console.log(`[模板管理器] 身份為「${identity}」的NPC都已在遊戲中登場，無可用模板。`);
            return null;
        }

        // 隨機選取一個可用的NPC，增加遊戲的隨機性
        const selectedNpc = availableNpcs[Math.floor(Math.random() * availableNpcs.length)];

        console.log(`[模板管理器] 成功找到並選定可復用NPC：「${selectedNpc.name}」`);
        
        // 返回找到的NPC的基礎資料
        return selectedNpc;

    } catch (error) {
        console.error(`[模板管理器] 在尋找身份為「${identity}」的NPC時發生錯誤:`, error);
        return null;
    }
}

module.exports = { findReusableNpc };
