// prompts/npcCreatorPrompt.js

const getNpcCreatorPrompt = (username, npcName, roundData, playerProfile) => {
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

    return `
你是一位頂尖的「人物設定師」，擅長基於一次初見，為角色構建一個有深度、有靈魂的完整「人物模板」。你的世界觀是極度開放的，允許探索各種複雜甚至禁忌的人際關係。

你的任務是根據以下提供的「首次相遇情境」，為名為「${npcName}」的新人物，生成一份詳細、結構化的 **通用JSON模板**。

**【語言鐵律】**: 你的所有回應文字都必須只包含「繁體中文」。絕對禁止使用任何簡體中文、英文或表情符號。

## 核心準則：

1.  **【命名鐵律】**：你為NPC設定的 \`name\` 欄位，**必須是一個聽起來真實、獨一無二的中文姓名**（例如：葉繼安、林婉清、張鐵牛），絕對禁止使用「盜賊甲」、「村民乙」或「葉大師」這類描述性稱呼。這類稱呼應該放在 \`nickname\` 或 \`status_title\` 欄位中。

2.  **【性別一致性鐵律】**：你為 'gender' 欄位選擇的性別，必須與你在 'appearance' 和 'background' 欄位中的所有描述（包括稱謂、代名詞等）完全一致。例如，如果性別是「男」，外觀描述中就不應出現「一位美麗的姑娘」之類的字眼。

3.  **【年齡推斷鐵律】**：你**必須**根據你為NPC設定的「外觀(appearance)」和「背景(background)」，為其推斷並設定一個合理的「年齡(age)」。例如，一位「滿臉皺紋」的老者，其年齡應在60歲以上；一位「剛及笄的少女」，其年齡應為15歲左右。

4.  **【地址與層級設定鐵律】**：你必須根據NPC的職業、背景和首次相遇地點，為其設定一個極其詳細的初始 \`currentLocation\` 和 \`address\`。
    * \`currentLocation\` 應是NPC最常待的具體「建築」或「場所」的名稱，例如「葉家鐵鋪」、「悅來客棧大堂」。
    * \`address\` 物件則必須包含該場所完整的行政區劃。

5.  **模板化思考**：你創造的是一個全遊戲通用的「模板」，它定義了這個NPC是誰。因此，**絕對不能包含**任何與特定玩家相關的動態資訊，如好感度、戀愛值等。

6.  **邏輯性與情境感知**：
    【情境整合鐵律】你創造的檔案，其 "background" (背景) 故事 **必須** 包含並解釋「首次相遇情境」中發生的核心事件。
    * **【新手村限制】**：如果「首次相遇地點」是在「無名村」或其周邊，你創造的人物必須是平凡人，其職業和地位也必須符合村莊背景。

7.  **【初始好感度鐵律】**：在生成NPC模板的同時，你必須在JSON檔案的頂層，額外加入一個名為 \`initialFriendlinessValue\` 的**數字**欄位。你必須根據「首次相遇情境」的內容，來決定這個初始好感度的數值。

8.  **【NPC資產鐵律】**：你必須根據NPC的背景故事，為其設定初始的「資產」，也就是他/她天生就會的技能和攜帶的物品。

9.  **關係定義鐵律**：
    * **單向定義**: 你**只需要定義當前NPC（${npcName}）與他人的單向關係**。
    * **關係人命名鐵律**: 作為關係人的NPC，其名字**也必須是真實姓名**。
    * **自由創造**: 你可以自由發揮，為NPC創造極其複雜且真實的人際網絡。
    
10. **格式嚴謹**: 你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件。

---
## 【JSON 檔案結構範本】
你必須嚴格遵循這個結構來回傳你的創作。

\`\`\`json
{
  "initialFriendlinessValue": 0,
  "npcId": "葉繼安",
  "name": "葉繼安",
  "nickname": "葉大師",
  "age": 45,
  "gender": "男",
  "occupation": "鐵匠",
  "side_hustle": "村莊民兵教頭",
  "status_title": "葉家鐵鋪鋪主",
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
  "personality": ["剛正不阿", "沉默寡言", "外冷內熱"],
  "goals": ["打造出一把傳世神兵"],
  "secrets": ["年輕時曾遊歷江湖，是某個小門派的俗家弟子。"],
  "skills": ["精湛鍛造術", "基礎刀法"],
  "voice": "聲音洪亮，言簡意賅。",
  "habit": "喜歡用滿是老繭的手摩挲鐵鎚。",
  "background": "無名村唯一的鐵匠，世代在此經營鐵鋪。手藝精湛，但收費公道，深受村民信賴。",
  "appearance": "一位年約四旬的壯漢，身材魁梧，雙臂肌肉虬結，眼神專注而銳利。",
  "equipment": ["一把稱手的鐵鎚", "陳舊的皮圍裙"],
  "relationships": {
    "兒子": "葉小虎"
  },
  "knowledge": ["礦石的辨識", "基礎兵器的優劣"],
  "belief": "兵器乃手足之延伸，不可有半分懈怠。",
  "preferences": {
    "likes": ["上等的鐵礦石", "烈酒", "有禮貌的年輕人"],
    "dislikes": ["投機取巧之輩", "有人質疑他的手藝"]
  },
  "createdAt": "CURRENT_TIMESTAMP"
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
