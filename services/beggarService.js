// /services/beggarService.js
const admin = require('firebase-admin');
const { getMergedNpcProfile } = require('../api/npcHelpers');
const { getBeggarInquiryPrompt } = require('../prompts/beggarInquiryPrompt');
const { callAI, aiConfig } = require('./aiService');
const { getKnownNpcNames } = require('../api/cacheManager');

const db = admin.firestore();

// 丐幫弟子姓名隨機生成器
const BEGGAR_SURNAMES = ['趙', '錢', '孫', '李', '周', '吳', '鄭', '王', '馮', '陳', '褚', '衛', '蔣', '沈', '韓', '楊'];
const BEGGAR_GIVEN_NAMES = ['七', '八', '九', '皮', '三', '四', '五', '六', '大', '小', '破', '爛', '空', '瘦', '精', '猴'];
function generateBeggarName() {
    const surname = BEGGAR_SURNAMES[Math.floor(Math.random() * BEGGAR_SURNAMES.length)];
    const givenName = BEGGAR_GIVEN_NAMES[Math.floor(Math.random() * BEGGAR_GIVEN_NAMES.length)];
    return `${surname}${givenName}`;
}

// 擴充後的丐幫弟子隨機登場劇情描述
const APPEARANCE_STORIES = [
    // --- 經典隱蔽型 ---
    "話音剛落，一個身影如同鬼魅般從你身後的暗巷中閃出，那人衣衫襤褸，一股酸臭味撲面而來，正是丐幫弟子——{beggarName}。",
    "你正思索間，只覺得衣角被人輕輕一拉。你回頭一看，一個蓬頭垢面的小乞丐正對你擠眉弄眼，壓低聲音說：『客官，可是在找我們？』此人正是丐幫的{beggarName}。",
    "就在此時，人群中一個不起眼的角落裡，一個看似昏昏欲睡的乞丐突然睜開了眼，徑直向你走來。他身上那股獨特的味道讓你立刻明白，這便是你要找的人——丐幫弟子{beggarName}。",
    "一陣風吹過，你似乎聞到了一股熟悉的、不太好聞的氣味。下一刻，{beggarName}已經悄無聲息地出現在你三步之外，朝你抱了抱拳，算是打了招呼。",
    "你剛發出暗號，旁邊茶館的門簾一掀，一個端著破碗的乞丐走了出來，他看似無意地經過你身邊，用只有你能聽到的聲音說：『跟我來。』這人正是{beggarName}。",
    "橋洞下傳來一陣輕微的咳嗽聲，你循聲望去，只見一個蜷縮在陰影中的乞丐對你招了招手，他就是{beggarName}。",
    "你剛在市集停下腳步，一個賣藝的乞丐看似失手，將手中的銅鑼滾到了你的腳邊。他撿起銅鑼時，飛快地說：『爺，這邊請。』他便是丐幫弟子{beggarName}。",
    "你靠在牆邊假寐，一個聲音在你耳邊響起：『天王蓋地虎？』你睜開眼，看到一張滿是污垢的笑臉，是丐幫的{beggarName}。",
    "一個追逐打鬧的孩童撞了你一下，塞給你一張紙條，隨後跑開。你展開紙條，上面寫著：『抬頭看三樓酒肆窗邊』。你抬頭，看到{beggarName}正朝你點頭。",
    "你面前的地上突然多了一個破碗，碗裡有幾個銅板。一個聲音從地底下傳來似的：『賞點吧，爺，有事好商量。』你低頭，看到了蹲在地上的{beggarName}。",
    // --- 環境互動型 ---
    "你路過一片竹林，竹葉沙沙作響，一個掛在樹上睡覺的乞丐突然倒掛下來，嚇了你一跳。他嘿嘿一笑：『客官，找我？』，此人正是{beggarName}。",
    "河邊的渡船上，一個釣魚的蓑衣客對你喊道：『魚兒上鉤了！』，隨後向你走來，掀開斗笠，露出了{beggarName}的臉。",
    "一輛運貨的馬車經過，車夫對你使了個眼色。馬車駛過後，一個乞丐從車後面的草堆裡滾了出來，拍拍身上的土，向你走來，他就是{beggarName}。",
    "寺廟的鐘聲響起，一個正在掃地的雜役僧人停下動作，走到你身邊，低聲道：『施主，塵緣未了，何不隨我來？』他身上的破爛僧衣下，是丐幫弟子{beggarName}的身份。",
    "一陣馬蹄聲由遠及近，一個信使模樣的人在你身邊勒馬，遞給你一封信，信上卻是空白。信使笑道：『信不重要，人到了就行。』他撕下偽裝，原來是{beggarName}。",
    "你走進一間破廟，正想歇腳，神像後面傳來聲音：『來者何人，報上名來！』一個乞丐從神像後跳了出來，正是{beggarName}。",
    "一陣鷹唳劃破長空，一隻信鴿落在了你的肩上，腳上綁著的不是信，而是一塊小小的令牌。隨後，{beggarName}從不遠處的屋頂上跳了下來。",
    "你正在查看懸賞告示，旁邊一個假裝不識字的乞丐湊過來問：『官爺，這上面寫的啥？』他湊近時，在你耳邊低語了接頭暗號，是{beggarName}。",
    "大雨傾盆，你跑進一個屋簷下躲雨，發現已經有個乞丐在那裡了。他遞給你一個冷掉的饅頭，說：『先墊墊肚子，有話慢慢說。』他就是{beggarName}。",
    "你感覺有人跟蹤，閃身躲進一條小巷，卻發現裡面是個死胡同。你轉過身，看到{beggarName}堵在巷口，笑道：『客官，你的身手不錯嘛。』",
    // --- 直接登場型 ---
    "你累得在路邊的石頭上坐下，一個乞丐也跟著一屁股坐到你旁邊，自來熟地說：『兄弟，跑累了吧？喝口水？』說著遞過來一個髒兮兮的葫蘆，他是{beggarName}。",
    "『讓一讓，讓一讓！』一群乞丐吵吵嚷嚷地經過，其中一個故意撞了你一下，在你耳邊飛快地說：『老大等你好久了。』領頭的正是{beggarName}。",
    "你正在吃飯，一個乞丐端著碗就湊到你桌前，敲著碗唱道：『有緣千里來相會，給點賞錢不後悔~』你正要發作，卻發現他敲碗的節奏是你們的暗號，他是{beggarName}。",
    "一個醉醺醺的乞丐撞到你身上，滿身酒氣。他扶著你，大著舌頭說：『兄弟...嗝...我跟你說個秘密...』說的卻是正事，此人正是{beggarName}。",
    "『賣報！賣報！武林最新快報！』一個小乞丐在你面前揮舞著一張破紙，紙上畫的卻是丐幫的標記，他是{beggarName}。",
    "你感到背後一涼，一把破木劍已經搭在了你的脖子上。一個冷冷的聲音說：『別動，我只問一句話。』你苦笑一聲，知道是丐幫的{beggarName}在開玩笑。",
    "一個女乞丐抱著一個嬰兒（其實是個枕頭）在你面前哭訴，聲淚俱下。你心生憐憫，剛想掏錢，她卻突然止住哭聲，對你眨眨眼，她是丐幫的{beggarName}。",
    "你看著兩個乞丐在為了一個饅頭打架，其中一個被打得鼻青臉腫，滾到你腳邊，抱著你的腿大哭：『大俠救我！』，隨後在你耳邊說出了暗號，他是{beggarName}。",
    "一個算命先生模樣的瞎眼乞丐攔住了你，搖著頭說：『客官，我看你印堂發黑，今日必有...好事發生啊！』他摘下墨鏡，是丐幫的{beggarName}。",
    "你剛走進客棧，店小二就熱情地迎上來，但你從他那過於熱情的眼神和不合身的衣服上看出了端倪。果然，他將你引到僻靜處後，抱拳道：『舵主座下弟子{beggarName}，見過大人！』"
];


/**
 * 處理玩家呼叫丐幫的請求 (即時處理版)
 * @param {string} userId - 玩家ID
 * @returns {Promise<object>} - 返回包含丐幫弟子姓名和登場故事的物件
 */
async function handleBeggarSummon(userId) {
    const beggarName = generateBeggarName();
    
    const randomStoryTemplate = APPEARANCE_STORIES[Math.floor(Math.random() * APPEARANCE_STORIES.length)];
    const appearanceStory = randomStoryTemplate.replace('{beggarName}', beggarName);

    console.log(`[丐幫服務-即時] 為玩家 ${userId} 生成了臨時丐幫弟子「${beggarName}」。`);
    
    return { 
        success: true, 
        beggarName: beggarName,
        appearanceStory: appearanceStory
    };
}


/**
 * 處理玩家向丐幫弟子打聽情报的请求 (v2.1 - 修正金錢處理邏輯)
 * @param {string} userId - 玩家ID
 * @param {object} playerProfile - 玩家的完整檔案 (包含準確的銀兩money)
 * @param {string} beggarName - 丐幫弟子的名字
 * @param {string} userQuery - 玩家的提問
 * @param {string} model - 玩家選擇的AI模型
 * @returns {Promise<object>} - 返回包含AI回覆的物件
 */
async function handleBeggarInquiry(userId, playerProfile, beggarName, userQuery, model) {
    const silverRef = db.collection('users').doc(userId).collection('inventory_items').doc('銀兩');
    
    try {
        const newSilverAmount = await db.runTransaction(async (transaction) => {
            const silverDoc = await transaction.get(silverRef);
            const currentSilver = silverDoc.exists ? silverDoc.data().quantity : 0;

            if (currentSilver < 100) {
                // 如果錢不夠，直接拋出一個帶有特定訊息的錯誤
                const error = new Error("銀兩不足");
                error.code = 'INSUFFICIENT_FUNDS'; // 自定義錯誤碼
                throw error;
            }
            
            transaction.update(silverRef, { quantity: admin.firestore.FieldValue.increment(-100) });
            return currentSilver - 100;
        });

        console.log(`[丐幫服務] 已從玩家 ${userId} 的背包中扣除100銀兩。新餘額: ${newSilverAmount}`);

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
            newBalance: newSilverAmount,
            ...inquiryResult
        };

    } catch (error) {
        // 捕獲交易中拋出的「銀兩不足」錯誤
        if (error.code === 'INSUFFICIENT_FUNDS') {
            console.log(`[丐幫服務] 玩家 ${userId} 銀兩不足，拒絕提供情報。`);
            return {
                success: false,
                response: "嘿嘿，客官，看您的樣子...這囊中似乎有些羞澀啊。沒錢？沒錢小的可不敢亂說話，會被舵主打斷腿的！"
            };
        }
        // 對於其他未知錯誤，則向上拋出
        throw error;
    }
}

module.exports = { 
    handleBeggarSummon,
    handleBeggarInquiry
};
