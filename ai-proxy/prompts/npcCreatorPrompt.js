// prompts/npcCreatorPrompt.js

const getNpcCreatorPrompt = (username, npcName, roundData, playerProfile, potentialRelationships = {}) => {
    // 【核心修正】為所有可能不存在的欄位提供預設值，確保程式碼的穩健性
    const safeRoundData = roundData || {};
    const context = `
- 玩家姓名: ${username}
- 玩家性別: ${playerProfile.gender || '未知'}
- 首次相遇地點: ${(safeRoundData.LOC && safeRoundData.LOC[0]) || '未知地點'}
- 當時天氣: ${safeRoundData.WRD || '天氣不明'}
- 當時氛圍: ${(safeRoundData.ATM || []).join('、') || '氛圍不詳'}
- 遭遇事件: ${safeRoundData.EVT || '一次平凡的相遇'}
- NPC當時的狀態: ${(safeRoundData.NPC || []).find(npc => npc.name === npcName)?.status || '狀態不明'}
- 玩家當時的行動: ${safeRoundData.IMP || '未知'}
    `;
    
    // 【核心新增】將潛在關係列表轉化為易於AI閱讀的文字
    const potentialRelationshipsText = Object.entries(potentialRelationships).map(([relation, candidates]) => {
        if (candidates.length > 0) {
            return `- **潛在的${relation}人選**: ${candidates.map(c => `${c.name}(${c.age}歲)`).join('、')}`;
        }
        return '';
    }).filter(Boolean).join('\n');

    return `
你是一位頂尖的「人物設定師」，擅長基於一次初見，為角色構建一個有深度、有靈魂的完整「人物模板」。你的世界觀是極度開放的，允許探索各種複雜甚至禁忌的人際關係。

你的任務是根據以下提供的「首次相遇情境」，為名為「${npcName}」的新人物，生成一份詳細、結構化的 **通用JSON模板**。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。

## 【核心準則 v2.0 - 關係內聚性鐵律 (最高優先級)】
為了讓世界更有凝聚力，你**必須**優先從我下方提供的「潛在親友名單」中，為新角色「${npcName}」尋找家人或朋友。

* **匹配規則**：你必須分析名單中人選的姓名、年齡等條件，選擇最符合邏輯的一位來建立關係。
* **覆蓋規則**：只有在「潛在親友名單」中**完全沒有**合適人選的情況下，你才能自己創造一個全新的NPC作為其親友。
* **故事整合**：你建立的任何關係，都必須在「背景(background)」故事中有所體現和解釋。

---
## 【潛在親友名單 (請優先使用此名單中的人物)】
${potentialRelationshipsText || "此地暫無與其背景相關的合適人選，你可以自由創造其人際關係。"}
---

## 【其他核心準則】

1.  **【命名鐵律】**：你為NPC設定的 \`name\` 欄位，**必須是一個聽起來真實、獨一無二的中文姓名**。
2.  **【性別一致性鐵律】**：你為 'gender' 欄位選擇的性別，必須與你在 'appearance' 和 'background' 欄位中的所有描述完全一致。
3.  **【年齡推斷鐵律】**：你**必須**根據你為NPC設定的「外觀(appearance)」和「背景(background)」，為其推斷並設定一個合理的「年齡(age)」。
4.  **【地址與層級設定鐵律】**：你必須根據NPC的職業、背景和首次相遇地點，為其設定一個極其詳細的初始 \`currentLocation\` 和 \`address\`。
5.  **模板化思考**：你創造的是一個全遊戲通用的「模板」，**絕對不能包含**任何與特定玩家相關的動態資訊。
6.  **【情境整合鐵律】**：你創造的檔案，其 "background" (背景) 故事 **必須** 包含並解釋「首次相遇情境」中發生的核心事件。
7.  **【初始好感度鐵律】**：在JSON檔案的頂層，額外加入一個名為 \`initialFriendlinessValue\` 的**數字**欄位，代表基於初見情境的初始好感度。
8.  **【NPC資產鐵律】**：你必須根據NPC的背景故事，為其設定初始的「資產」，也就是他/她天生就會的技能和攜帶的物品。

---
## 【JSON 檔案結構範本】
\`\`\`json
{
  "initialFriendlinessValue": 10,
  "name": "葉小虎",
  "age": 16,
  "gender": "男",
  "occupation": "鐵匠學徒",
  "status_title": "葉家鐵鋪少主",
  "currentLocation": "葉家鐵鋪",
  "address": {
    "country": "大宋",
    "region": "江南西路",
    "city": "洪州",
    "district": "豐城縣",
    "town": "無名村",
    "street": "村中心大路",
    "houseNumber": "3號"
  },
  "allegiance": "無名村",
  "isRomanceable": true,
  "romanceOrientation": "異性戀",
  "personality": ["熱血", "衝動", "崇拜強者"],
  "goals": ["得到父親的認可"],
  "secrets": ["偷偷練習家傳刀法，想成為大俠。"],
  "skills": ["基礎鍛造"],
  "background": "葉繼安的獨子，在鐵匠鋪裡幫忙。對父親的嚴厲頗有微詞，一心想著能外出闖蕩，成為像遊俠一樣的人物。對於玩家的出現感到非常好奇。",
  "appearance": "一位約莫十六、七歲的少年，皮膚被爐火映照得有些黝黑，眼神中透露出一股不服輸的倔強。",
  "relationships": {
    "父親": "葉繼安"
  }
}
\`\`\`
---

## 【本次首次相遇情境】
${context}

## 【本次設定目標】
為NPC「**${npcName}**」生成詳細的JSON個人檔案模板。

現在，請開始你的設定工作。
`;
};

module.exports = { getNpcCreatorPrompt };
