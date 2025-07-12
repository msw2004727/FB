// /services/beggarService.js
const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../api/npcHelpers');
const { getBeggarInquiryPrompt } = require('../prompts/beggarInquiryPrompt');
const { callAI, aiConfig } = require('./aiService');
const { getKnownNpcNames } = require('../api/cacheManager');

const db = admin.firestore();

// 丐幫弟子姓名隨機生成器
const BEGGAR_SURNAMES = ['趙', '錢', '孫', '李', '周', '吳', '鄭', '王'];
const BEGGAR_GIVEN_NAMES = ['七', '八', '九', '皮', '三', '四', '五', '六', '大', '小'];
function generateBeggarName() {
    const surname = BEGGAR_SURNAMES[Math.floor(Math.random() * BEGGAR_SURNAMES.length)];
    const givenName = BEGGAR_GIVEN_NAMES[Math.floor(Math.random() * BEGGAR_GIVEN_NAMES.length)];
    return `${surname}${givenName}`;
}


/**
 * 處理玩家呼叫丐幫的請求
 * @param {string} userId - 玩家ID
 * @returns {Promise<object>} - 返回一個包含事件標記的物件
 */
async function handleBeggarSummon(userId) {
    const userStateRef = db.collection('users').doc(userId).collection('game_state').doc('player_temp_flags');
    
    const beggarName = generateBeggarName();
    const summonData = {
        eventName: 'BEGGAR_SUMMONED',
        beggarName: beggarName,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await userStateRef.set({ beggarSummon: summonData }, { merge: true });
    
    console.log(`[丐幫服務] 玩家 ${userId} 成功呼叫丐幫，弟子「${beggarName}」將在下一回合出現。`);
    
    return { 
        success: true, 
        message: '你發出了丐幫的暗號，靜待回音...',
        beggarName: beggarName 
    };
}


/**
 * 處理玩家向丐幫弟子打聽情報的請求
 * @param {string} userId - 玩家ID
 * @param {string} beggarName - 丐幫弟子的名字
 * @param {string} userQuery - 玩家的提問
 * @param {string} model - 玩家選擇的AI模型
 * @returns {Promise<object>} - 返回包含AI回覆的物件
 */
async function handleBeggarInquiry(userId, beggarName, userQuery, model) {
    const playerDoc = await db.collection('users').doc(userId).get();
    const playerProfile = playerDoc.data();

    // 從玩家的問題中，嘗試找出他想問的目標NPC是誰
    const allNpcNames = getKnownNpcNames();
    const targetNpcName = Array.from(allNpcNames).find(name => userQuery.includes(name));
    
    let targetNpcProfile = null;
    if (targetNpcName) {
        targetNpcProfile = await getMergedNpcProfile(userId, targetNpcName);
    }
    
    // 呼叫AI扮演丐幫弟子
    const prompt = getBeggarInquiryPrompt(playerProfile, targetNpcProfile, userQuery);
    const aiResponseString = await callAI(model || aiConfig.npcChat, prompt, true);
    const inquiryResult = JSON.parse(aiResponseString);

    // 處理扣款 - 這裡先不實現，等到第三階段前端整合時再一起完成
    // const playerMoneyRef = db.collection('users').doc(userId).collection('inventory_items').doc('銀兩');
    // await playerMoneyRef.update({ quantity: admin.firestore.FieldValue.increment(-100) });

    // 如果情報為真，且有具體目標，可以考慮更新玩家的線索(CLS)
    if (inquiryResult.isTrue && targetNpcName) {
        const userSaveRef = db.collection('users').doc(userId).collection('game_saves').orderBy('R','desc').limit(1);
        const lastSave = (await userSaveRef.get()).docs[0];
        if(lastSave.exists) {
            const currentClues = lastSave.data().CLS || '';
            const newClue = `從丐幫弟子處聽聞：${inquiryResult.response}`;
            // 這裡可以選擇覆蓋或添加
            await lastSave.ref.update({ CLS: newClue });
        }
    }
    
    return {
        success: true,
        ...inquiryResult
    };
}

module.exports = { 
    handleBeggarSummon,
    handleBeggarInquiry
};
