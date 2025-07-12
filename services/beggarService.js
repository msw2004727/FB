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

// 【核心修改】提供多種隨機登場的劇情描述
const APPEARANCE_STORIES = [
    "話音剛落，一個身影如同鬼魅般從你身後的暗巷中閃出，那人衣衫襤褸，一股酸臭味撲面而來，正是丐幫弟子——{beggarName}。",
    "你正思索間，只覺得衣角被人輕輕一拉。你回頭一看，一個蓬頭垢面的小乞丐正對你擠眉弄眼，壓低聲音說：『客官，可是在找我們？』此人正是丐幫的{beggarName}。",
    "就在此時，人群中一個不起眼的角落裡，一個看似昏昏欲睡的乞丐突然睜開了眼，徑直向你走來。他身上那股獨特的味道讓你立刻明白，這便是你要找的人——丐幫弟子{beggarName}。",
    "一陣風吹過，你似乎聞到了一股熟悉的、不太好聞的氣味。下一刻，{beggarName}已經悄無聲息地出現在你三步之外，朝你抱了抱拳，算是打了招呼。"
];


/**
 * 【核心修改】處理玩家呼叫丐幫的請求 (即時處理版)
 * @param {string} userId - 玩家ID
 * @returns {Promise<object>} - 返回包含丐幫弟子姓名和登場故事的物件
 */
async function handleBeggarSummon(userId) {
    const beggarName = generateBeggarName();
    
    // 從預設的登場故事中隨機選擇一個
    const randomStoryTemplate = APPEARANCE_STORIES[Math.floor(Math.random() * APPEARANCE_STORIES.length)];
    const appearanceStory = randomStoryTemplate.replace('{beggarName}', beggarName);

    console.log(`[丐幫服務-即時] 為玩家 ${userId} 生成了臨時丐幫弟子「${beggarName}」。`);
    
    // 不再操作資料庫，只回傳生成的資訊
    return { 
        success: true, 
        beggarName: beggarName,
        appearanceStory: appearanceStory
    };
}


/**
 * 處理玩家向丐幫弟子打聽情報的請求
 * @param {string} userId - 玩家ID
 * @param {object} playerProfile - 玩家的完整檔案
 * @param {string} beggarName - 丐幫弟子的名字
 * @param {string} userQuery - 玩家的提問
 * @param {string} model - 玩家選擇的AI模型
 * @returns {Promise<object>} - 返回包含AI回覆的物件
 */
async function handleBeggarInquiry(userId, playerProfile, beggarName, userQuery, model) {
    const userDocRef = db.collection('users').doc(userId);

    const currentMoney = playerProfile.money || 0;
    if (currentMoney < 100) {
        return {
            success: false,
            response: "嘿嘿，客官，看您的樣子...這囊中似乎有些羞澀啊。沒錢？沒錢小的可不敢亂說話，會被舵主打斷腿的！"
        };
    }
    await userDocRef.update({ money: admin.firestore.FieldValue.increment(-100) });
    console.log(`[丐幫服務] 已從玩家 ${userId} 帳戶扣除100文錢情報費。`);

    const allNpcNames = getKnownNpcNames();
    const targetNpcName = Array.from(allNpcNames).find(name => userQuery.includes(name) && name !== beggarName);
    
    let targetNpcProfile = null;
    if (targetNpcName) {
        targetNpcProfile = await getMergedNpcProfile(userId, targetNpcName);
    }
    
    const prompt = getBeggarInquiryPrompt(playerProfile, targetNpcProfile, userQuery);
    const aiResponseString = await callAI(model || aiConfig.npcChat, prompt, true);
    const inquiryResult = JSON.parse(aiResponseString);

    if (inquiryResult.isTrue && targetNpcName) {
        const userSaveRef = db.collection('users').doc(userId).collection('game_saves').orderBy('R','desc').limit(1);
        const lastSave = (await userSaveRef.get()).docs[0];
        if(lastSave.exists) {
            const newClue = `從丐幫弟子處聽聞：${inquiryResult.response}`;
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
