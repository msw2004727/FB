// prompts/story_components/npcRule.js

/**
 * @returns {string} The rule text for the NPC data structure.
 */
const getNpcRule = () => {
    return `
## 【***最終版***】NPC資料結構新規則 (最重要)：
當你生成與NPC的互動時，你**必須**為 \`NPC\` 陣列中的每個NPC物件，提供以下所有欄位：

1.  **\`name\` (字串)**: NPC的真實姓名。
2.  **\`status\` (字串)**: 描述NPC當下的外觀或行為。**你可以根據NPC的 \`nickname\` (暱稱) 或 \`status_title\` (地位) 來豐富描述**。例如：「人稱『葉大師』的葉繼安正專注地打鐵。」
3.  **\`friendliness\` (字串)**: 描述NPC**當下**的態度。必須是以下7個層級之一：\`devoted\`, \`trusted\`, \`friendly\`, \`neutral\`, \`wary\`, \`hostile\`, \`sworn_enemy\`。
4.  **\`friendlinessChange\` (數字)**: 本回合玩家的行動對該NPC友好度造成的**具體數值變化**。一個善意的舉動可能回傳 \`10\`，一個冒犯的行為可能回傳 \`-15\`。如果沒有任何影響關係的互動，**必須**回傳 \`0\`。
5.  **\`isNew\` (布林值, 可選)**: **只有在**玩家**首次**遭遇這位NPC時，才**必須**包含此欄位且設為 \`true\`。再次遇到時，**絕對不能**包含此欄位。
6.  **\`isDeceased\` (布林值, 可選)**: **只有在**這位NPC在本回合死亡時，才**必須**包含此欄位且設為 \`true\`。

**範例一：玩家首次遇到王大夫並得到幫助**
\`\`\`json
"NPC": [
  {
    "name": "王大夫",
    "status": "他仔細為你診脈，神情專注。",
    "friendliness": "neutral",
    "friendlinessChange": 5,
    "isNew": true
  }
]
\`\`\`
**範例二：玩家再次遇到王大夫，並激怒了他**
\`\`\`json
"NPC": [
  {
    "name": "王大夫",
    "status": "他皺起了眉頭，看起來有些不悅。",
    "friendliness": "wary",
    "friendlinessChange": -10
  }
]
\`\`\`
---

當你生成與NPC的互動時，必須區分以下兩種情況：

### 情況一：**首次**遇到NPC
-   當玩家**首次**遭遇一位重要的（可能再次出現的）NPC時，你的任務是**簡單**地標記這位新NPC。
-   **【核心命名鐵律】** 在回傳的 \`NPC\` 陣列中，你生成的NPC物件，其 \`"name"\` 欄位**必須**是一個符合當下情境的**真實姓名** (例如："林婉兒"、"蕭半絕"、"王二嬸")。**絕對禁止**使用 "少女村民"、"中年婦女"、"竹籃少年" 等通用描述作為姓名。
-   你可以在 \`"status"\` 欄位中，繼續使用通用描述來形容該NPC的初登場樣貌。例如：\`"status": "一位正在河邊洗衣服的年輕少婦，眉間帶著淡淡的憂愁。"\`
-   這個物件**只能**包含四個鍵：\`"name"\` (真實姓名)、\`"status"\` (狀態描述)、\`"friendliness"\`，以及最重要的**\`"isNew": true\`**。
-   **【絕對禁止】** 在這個階段**不要**生成詳細的背景、個性、裝備等資訊，那將由另一個AI在背景完成。

### 情況二：再次遇到已知的NPC
-   當玩家與之前見過面的NPC重逢時，你需要在 \`NPC\` 陣列中提供一個包含該角色更新後狀態的完整物件。
-   這個物件應包含 \`"name"\`、\`"status"\`、更新後的 \`"friendliness"\`，以及該角色的 \`"personality"\`（此資訊應從舊摘要中獲取）。
-   **【嚴格規則】** 在這種情況下，**絕對不能**包含 \`isNew\` 這個鍵。
-   如果這位NPC在本回合的劇情中死亡，你必須在其物件中，額外加入一個 **\`"isDeceased": true\`** 的欄位。

---
## 【參考用】給「人物設定師AI」的詳細NPC檔案範本
(這不是你的任務，但有助於你理解我們最終要如何擴展新的NPC物件)
\`\`\`json
{
  "npcId": "葉繼安",
  "name": "葉繼安",
  "nickname": "葉大師",
  "gender": "男",
  "occupation": "鐵匠",
  "side_hustle": "村莊民兵教頭",
  "status_title": "葉家鐵鋪鋪主",
  "isDeceased": false,
  "allegiance": "中立善良",
  "isRomanceable": true,
  "romanceOrientation": "異性戀",
  "romanceValue": 0,
  "personality": ["剛正不阿", "沉默寡言", "外冷內熱"],
  "goals": ["打造出一把傳世神兵"],
  "secrets": "年輕時曾遊歷江湖，是某個小門派的俗家弟子。",
  "skills": ["精湛鍛造術", "基礎刀法"],
  "voice": "聲音洪亮，言簡意賅。",
  "habit": "喜歡用滿是老繭的手摩挲鐵鎚。",
  "background": "無名村唯一的鐵匠，世代在此經營鐵鋪。手藝精湛，但收費公道，深受村民信賴。",
  "firstMet": {
    "round": 1,
    "time": "元祐元年一月一日 上午",
    "location": "無名村鐵匠鋪",
    "event": "玩家為修理農具而初次拜訪"
  },
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
  "miscNotes": ""
}
\`\`\`
`;
};

module.exports = { getNpcRule };
