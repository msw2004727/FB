// ai-proxy/scenarios/wuxia.js
// 武俠劇本配置 — 從現有硬編碼提取

const MILESTONES = [
    { id: 'M1_WORLD_AWARENESS', name: '異世界認知', description: '主角確認自己穿越到了另一個世界', trigger: '故事中主角明確意識到自己不屬於這個世界，或有人指出他的言行舉止與常人不同' },
    { id: 'M2_FIRST_CLUE', name: '第一條線索', description: '發現與穿越現象相關的第一個具體線索', trigger: '故事中出現古怪符文、神秘遺跡、異常天象、或有人提到類似的穿越傳說' },
    { id: 'M3_KEY_NPC', name: '關鍵人物', description: '遇到一個知道穿越秘密的重要角色', trigger: '故事中出現一個NPC明確表示知道主角的來歷、或擁有與穿越相關的知識' },
    { id: 'M4_ANCIENT_KNOWLEDGE', name: '古老知識', description: '獲得關於穿越機制的古老文獻或口述知識', trigger: '故事中主角獲得了古書、卷軸、壁畫、或聽到了關於「時空裂縫」「陣法」「回歸之路」的具體描述' },
    { id: 'M5_OBSTACLE', name: '重大阻礙', description: '發現回家的條件極其苛刻', trigger: '故事明確描述了回家需要的具體條件（某個物品、某個地點、某個時機），但目前無法達成' },
    { id: 'M6_BREAKTHROUGH', name: '關鍵突破', description: '克服了重大障礙或找到繞過的方法', trigger: '故事中主角成功獲得了回家所需的關鍵要素之一，或發現了新的可行路徑' },
    { id: 'M7_FINAL_PREPARATION', name: '最終準備', description: '萬事俱備，只差最後一步', trigger: '故事中主角已集齊所有條件，正在進行回家前的最後準備或做出最終抉擇' },
    { id: 'M8_HOMECOMING', name: '歸途', description: '啟動回家的儀式/方法', trigger: '故事中主角正在實際執行回家的行動（啟動陣法、穿越裂縫等）' },
];

const MILESTONE_NAMES = MILESTONES.map(m => m.name);

function getInitialRound(username, gender) {
    const isFemale = gender === 'female';
    const stories = [
        // (A) 泥巴路上醒來
        {
            EVT: '莫名其妙的穿越',
            story: `${username}睜開眼睛。\n\n頭頂是一片刺眼的藍天，身下是一堆扎人的乾草。空氣裡飄著一股像是中藥房和燒烤攤強行混在一起的味道。\n\n${isFemale ? '她' : '他'}猛地坐起來——四周是一條塵土飛揚的泥巴路，兩旁低矮土牆掛著褪色布簾。遠處傳來雞鳴狗吠，還有大嬸扯著嗓子罵誰家孩子偷了蘿蔔乾。\n\n身上穿著灰撲撲的粗布衣裳，腳上草鞋左邊那隻還破了個洞。${isFemale ? '她' : '他'}完全不記得自己怎麼到這裡的。\n\n右手緊攥著一張皺巴巴的紙條，歪歪扭扭的毛筆字寫著：「任務：尋找回家的方法。」背面小字：「附註：別死了，死了就真回不去了。」\n\n一個挑著扁擔的老大爺路過，用看傻子的眼神瞟了${isFemale ? '她' : '他'}一眼。`,
            WRD: '大晴天，熱得要命',
            LOC: ['梁國', '東境', '臨川', '無名村'],
            PC: `${username}剛穿越，一臉懵，手握紙條。`,
            suggestion: '你站在一條陌生的村莊小路上，手裡捏著一張寫著「尋找回家方法」的紙條。四周的一切都很古代，你需要先搞清楚狀況。'
        },
        // (B) 酒館裡被指控吃霸王餐
        {
            EVT: '霸王餐風波',
            story: `「你這${isFemale ? '丫頭' : '臭小子'}！吃了三碗牛肉麵、兩盤滷味、一壺黃酒，現在跟老娘說沒帶銀子？！」\n\n${username}被一個膀大腰圓的老闆娘揪著衣領從椅子上提起來的時候，腦子裡只有一個念頭：我是誰、我在哪、我什麼時候吃的牛肉麵？\n\n${isFemale ? '她' : '他'}瘋狂環顧四周——油膩的木桌、牆上掛的褪色酒旗、角落裡幾個看熱鬧不嫌事大的酒客。空氣中瀰漫著劣質酒和滷肉的混合氣味，聞起來像公司樓下自助餐放了三天。\n\n桌上確實擺著三個空碗，而且舔得很乾淨。\n\n「我、我真的不記得——」\n\n「不記得？行！」老闆娘一把將${isFemale ? '她' : '他'}摜回椅子上，「那你就在這兒洗碗，洗到我滿意為止！」\n\n${isFemale ? '她' : '他'}低頭，發現衣襟裡塞著一張紙條：「尋找回家的方法。附註：先活過今天。」`,
            WRD: '陰天，悶熱潮濕',
            LOC: ['梁國', '東境', '臨川', '無名村', '張記麵館'],
            PC: `${username}剛穿越，被酒館老闆娘揪著要賠飯錢，身無分文。`,
            suggestion: '你坐在一間破舊酒館裡，面前三個空碗，膀大腰圓的老闆娘堵在門口。你身上沒有任何錢，得想辦法脫身。'
        },
        // (C) 掛在樹枝上醒來
        {
            EVT: '從天而降的倒楣蛋',
            story: `${username}意識回籠的第一個感覺是：血液全部衝到了頭頂。\n\n${isFemale ? '她' : '他'}睜開眼——整個世界是顛倒的。地面在上方，天空在腳底。一片樹葉打著旋飄過${isFemale ? '她' : '他'}的鼻尖。\n\n然後${isFemale ? '她' : '他'}意識到自己正倒掛在一棵巨大的老榕樹上。一條腿被樹杈卡住，粗布褲腿繃得快裂開。風一吹，整個人像個破風鈴一樣晃來晃去。\n\n「……這什麼情況？」\n\n樹下蹲著一個約莫七八歲的小孩，嘴裡叼著根草，仰著頭用一種觀察珍稀動物的眼神盯著${isFemale ? '她' : '他'}。\n\n「欸，你是妖怪嗎？」小孩問。\n\n「我不是妖怪！你能幫我——嗚啊！」話沒說完，褲腿傳來一聲撕裂的脆響。\n\n口袋裡飄出一張紙條，落在小孩面前。小孩撿起來念：「尋找……回家的方法？」\n\n然後用更困惑的眼神看向${isFemale ? '她' : '他'}：「你家在天上？」`,
            WRD: '清晨微涼，樹林裡有霧氣',
            LOC: ['梁國', '東境', '臨川', '無名村外', '老榕樹'],
            PC: `${username}剛穿越，倒掛在村外的樹上，處境狼狽至極。`,
            suggestion: '你倒掛在一棵大樹上，褲子快裂了，一個小孩在下面看你。得先想辦法下來再說。'
        }
    ];
    const pick = stories[Math.floor(Math.random() * stories.length)];
    return {
        R: 0,
        EVT: pick.EVT,
        story: pick.story,
        WRD: pick.WRD,
        LOC: pick.LOC,
        PC: pick.PC,
        NPC: [],
        timeOfDay: '上午',
        morality: 0,
        yearName: '元祐', year: 1, month: 1, day: 1,
        playerState: 'alive',
        moralityChange: 0,
        suggestion: pick.suggestion
    };
}

const config = {
    id: 'wuxia',
    name: '武俠',
    themeClass: '', // 預設主題，不加額外 class

    // 時間系統
    timeSequence: ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'],

    // 對齊軸線
    moralityLabels: { positive: '正', negative: '邪', axis: '立場傾向' },

    // Profile 預設值
    defaultProfile: { yearName: '元祐', year: 1, month: 1, day: 1, timeOfDay: '上午' },

    // 主角描述（給 AI 用）
    protagonistDescription: (gender) => gender === 'female'
        ? '她附身在一個不知名、約20歲的少女身上。'
        : '他附身在一個不知名、約20歲的少年身上。',

    // 敘事風格
    narrativeStyle: `
## 【敘事風格與核心規則】
你的文筆風格是「情感濃烈的沉浸式武俠」。你寫的不是流水帳，而是一段讓人身歷其境的小說。你要做到以下幾點：
1.  **機智幽默**: 主角是一個穿越者。他的內心獨白應該充滿現代人對古代世界的吐槽和不解。
2.  **細節描寫**: 不要只說「你走進了村莊」。要描寫空氣中的味道、腳下泥土的觸感、遠處傳來的聲音。
3.  **NPC有靈魂**: 每個NPC的對話都應該符合他的個性。粗獷的山賊不會文謅謅，害羞的少女不會大大咧咧。用「語氣」和「用詞」來塑造角色。
4.  **主角的內心戲**: 用括號或獨立段落來展現主角的內心想法。這是穿越者視角的核心魅力。
5.  **禁止流水帳**: 嚴禁「你做了A，然後做了B，接著做了C」這種毫無情感的敘述。每一段都要有情緒、有衝突、有畫面感。
6.  **NPC稱呼**: NPC稱呼主角時，應使用「少俠」「兄台」「姑娘」「這位公子」「閣下」等符合身份的稱呼，絕對禁止叫「玩家」或使用任何遊戲術語。`,

    // 世界觀
    worldview: (protagonistDesc, currentRound) => `
## 【世界觀與故事設定】
故事發生在一個類似宋朝的架空時代，名為「元祐」年間。主角是一名${protagonistDesc}
主角是穿越到這個時代的年輕人，從「無名村」這個偏僻小村莊開始冒險。主角的終極目標是「尋找回家的方法」。
${currentRound <= 10 ? '【初期】故事初期（R0~R10），世界範圍侷限在起始村莊及周邊。主角正在適應環境、結識第一批NPC。' : ''}
${currentRound > 10 && currentRound <= 30 ? '【中期】主角已開始探索更大的世界，可能涉及不同城鎮、門派或勢力。' : ''}
${currentRound > 30 ? '【後期】世界已充分展開，主角面對更複雜的局勢與挑戰。' : ''}`,

    // EVT 範例
    evtExamples: '如「初探無名村」「偶遇黑衣人」「酒館密談」「夜襲危機」',

    // NPC 稱呼範例（男女不同）
    npcAddressExamples: '「少俠」「兄台」「姑娘」「這位公子」「閣下」',
    npcAddressMale: '「少俠」「兄台」「這位公子」「閣下」「小哥」',
    npcAddressFemale: '「姑娘」「小姐」「女俠」「這位姑娘」「閣下」',

    // 里程碑顯示
    milestoneDisplay: { title: '歸途印記', description: '集齊八枚即可回家' },

    // 死亡相關
    deathFallbackStory: '江湖傳奇在此刻落幕。',
    restartSuggestion: '重新開始一段新的江湖人生。',

    // 黑影人事件（武俠特有）
    hasBlackShadow: true,

    getInitialRound,
    MILESTONES,
    MILESTONE_NAMES,
};

module.exports = config;
