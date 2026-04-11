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

function getInitialRound(username) {
    return {
        R: 0,
        EVT: '莫名其妙的穿越',
        story: `你睜開眼睛。\n\n頭頂是一片刺眼的藍天，身下是一堆扎人的乾草。空氣裡飄著一股你完全無法辨認的味道——像是有人把中藥房和燒烤攤強行混在一起。\n\n你猛地坐起來，四周是一條塵土飛揚的泥巴路，兩旁是低矮的土牆和掛著褪色布簾的店鋪。遠處傳來雞鳴狗吠，還有一個大嬸扯著嗓子罵誰家的孩子偷了她晾的蘿蔔乾。\n\n這絕對不是你的房間。\n\n你低頭一看——身上穿著一件灰撲撲的粗布衣裳，腳上是一雙草鞋，左邊那隻還破了個洞。你完全不記得自己是怎麼到這裡的，腦子裡一片空白，像是被人用橡皮擦狠狠擦過一遍。\n\n然後你發現右手緊緊攥著一張皺巴巴的紙條。你展開一看，上面用歪歪扭扭的毛筆字寫著：\n\n「任務：尋找回家的方法。」\n\n紙條背面還有一行小字：「附註：別死了，死了就真回不去了。」\n\n你盯著這張紙條看了三秒鐘，然後抬頭環顧四周。一個挑著扁擔的老大爺正好路過，用一種看傻子的眼神瞟了你一眼。\n\n好吧。看來你得先搞清楚這是哪裡，然後——想辦法活著回家。`,
        WRD: '大晴天，熱得要命',
        LOC: ['梁國', '東境', '臨川', '無名村'],
        PC: `${username}剛穿越，一臉懵，手握紙條。`,
        NPC: [],
        timeOfDay: '上午',
        morality: 0,
        yearName: '元祐', year: 1, month: 1, day: 1,
        playerState: 'alive',
        moralityChange: 0,
        suggestion: '你站在一條陌生的村莊小路上，手裡捏著一張寫著「尋找回家方法」的紙條。四周的一切都很古代，你需要先搞清楚狀況。'
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

    // NPC 稱呼範例
    npcAddressExamples: '「少俠」「兄台」「姑娘」「這位公子」「閣下」',

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
