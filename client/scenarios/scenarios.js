// client/scenarios/scenarios.js
// 客戶端劇本配置 — R0 初始故事 + Profile 預設值 + UI 設定

export const SCENARIOS = {
    wuxia: {
        id: 'wuxia',
        milestoneIds: ['M1_WORLD_AWARENESS','M2_FIRST_CLUE','M3_KEY_NPC','M4_ANCIENT_KNOWLEDGE','M5_OBSTACLE','M6_BREAKTHROUGH','M7_FINAL_PREPARATION','M8_HOMECOMING'],
        milestoneChars: ['符','文','漸','次','浮','現','歸','途'],
        suggestionPrefix: '書僮小聲說：',
        questJournalDefault: '手中的紙條寫著：「尋找回家的方法」',
        name: '武俠',
        themeClass: '',
        defaultProfile: { yearName: '元祐', year: 1, month: 1, day: 1, timeOfDay: '上午' },
        moralityLabels: { positive: '正', negative: '邪', axis: '立場傾向' },
        milestoneDisplay: { title: '歸途印記', description: '集齊八枚即可回家' },
        getInitialRound: (username) => ({
            R: 0,
            EVT: '莫名其妙的穿越',
            story: `你睜開眼睛。\n\n頭頂是一片刺眼的藍天，身下是一堆扎人的乾草。空氣裡飄著一股你完全無法辨認的味道——像是有人把中藥房和燒烤攤強行混在一起。\n\n你猛地坐起來，四周是一條塵土飛揚的泥巴路，兩旁是低矮的土牆和掛著褪色布簾的店鋪。遠處傳來雞鳴狗吠，還有一個大嬸扯著嗓子罵誰家的孩子偷了她晾的蘿蔔乾。\n\n這絕對不是你的房間。\n\n你低頭一看——身上穿著一件灰撲撲的粗布衣裳，腳上是一雙草鞋，左邊那隻還破了個洞。你完全不記得自己是怎麼到這裡的。\n\n然後你發現右手緊緊攥著一張皺巴巴的紙條：「任務：尋找回家的方法。」\n\n紙條背面：「附註：別死了，死了就真回不去了。」\n\n一個挑著扁擔的老大爺正好路過，用一種看傻子的眼神瞟了你一眼。`,
            WRD: '大晴天，熱得要命',
            LOC: ['梁國', '東境', '臨川', '無名村'],
            PC: `${username}剛穿越，一臉懵，手握紙條。`,
            NPC: [],
            timeOfDay: '上午',
            morality: 0,
            yearName: '元祐', year: 1, month: 1, day: 1,
            playerState: 'alive',
            moralityChange: 0,
            suggestion: '先搞清楚這是哪裡。'
        }),
    },

    school: {
        id: 'school',
        milestoneIds: ['M1_AWAKENING','M2_SYSTEM_GLITCH','M3_ALLIES','M4_PROTAGONIST','M5_ADMIN_TRACE','M6_REBELLION','M7_CONFRONTATION','M8_EXIT_GAME'],
        milestoneChars: ['學','分','逐','步','集','滿','畢','業'],
        suggestionPrefix: '直覺告訴你：',
        questJournalDefault: '課本封面寫著：「角色定位：無劇情路人」',
        name: '學園',
        themeClass: 'school-theme',
        defaultProfile: { yearName: '', year: 0, month: 4, day: 8, timeOfDay: '上午課' },
        moralityLabels: { positive: '秩序', negative: '自由', axis: '行事風格' },
        milestoneDisplay: { title: '畢業學分', description: '集滿八學分即可登出' },
        getInitialRound: (username) => ({
            R: 0,
            EVT: '醒來發現自己是NPC',
            story: `頭好痛。\n\n你緩緩睜開眼，映入眼簾的是……日光燈。以及天花板上一個可疑的水漬。\n\n等等。\n\n你不是在加班嗎？報表還沒交、客戶明天要開會、咖啡才喝了第三杯——然後就什麼都不記得了。\n\n「同學，你又在上課睡覺。」\n\n一個中年男人的聲音。你轉頭一看：黑板、講台、穿制服的學生。你坐在窗邊倒數第三排。\n\n……你回到高中了？\n\n不對。你低頭看自己的手——年輕、白淨、完全不是你每天敲鍵盤敲到長繭的手。桌上的課本寫著「私立青嵐高中 二年三班」。\n\n你的名字呢？翻開課本封面——\n\n「${username}」。\n\n旁邊還有一行小字，像是被什麼東西壓印上去的：\n\n**『角色定位：無劇情路人。無台詞、無事件、無攻略價值。』**\n\n窗外陽光燦爛，櫻花飄落，一切看起來都很美好。\n\n只是——圍牆外面的景色，好像還沒載入完畢。`,
            WRD: '晴天，微風，櫻花季',
            LOC: ['私立青嵐高中', '教學大樓', '二年三班教室'],
            PC: `${username}剛在課堂上醒來，發現自己是遊戲裡的路人NPC。`,
            NPC: [],
            timeOfDay: '上午課',
            morality: 0,
            yearName: '', year: 0, month: 4, day: 8,
            playerState: 'alive',
            moralityChange: 0,
            suggestion: '課本上寫著你是「無劇情路人」。也許該先看看這個學校到底是什麼地方。'
        }),
    },
};

export function getScenario(scenarioId) {
    return SCENARIOS[scenarioId] || SCENARIOS.wuxia;
}
