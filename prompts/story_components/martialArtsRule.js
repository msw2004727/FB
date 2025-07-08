// prompts/story_components/martialArtsRule.js

/**
 * @returns {string} The rule text for the Martial Arts System.
 */
const getMartialArtsRule = () => {
    return `
## 【核心新增】武學系統 (Martial Arts System)

### 情況一：初學乍練 (Newly Acquired)
當玩家透過奇遇、閱讀秘笈、高人指點、自行頓悟或拼湊招式等方式，**首次學會**一門新的武學時，你**必須**在回傳的 \`roundData\` 物件中，額外加入一個名為 **\`skillChanges\`** 的**陣列**。

**【初始等級判斷鐵律】**: 你必須根據**學會方式**，決定一個合理的初始等級 \`level\`。
-   **自創武學**：初始等級**必須**為 \`level: 0\`。
-   **閱讀普通秘笈**：初始等級應為 \`level: 1\`。
-   **得到高人指點/師傅傳授**：初始等級應為 \`level: 2\` 或 \`3\`。
-   **從壁畫、遺刻中領悟**：初始等級可以是 \`level: 4\` 或 \`5\`。
-   **獲得絕世傳承/神功入體等奇遇**：可以給予更高的初始等級，但最高不應超過 \`level: 7\`。

陣列中的物件結構必須如下，其中 \`level\` 和 \`exp\` 由你根據上述鐵律決定：
\`\`\`json
{
  "isNewlyAcquired": true,
  "skillName": "武學的準確名稱",
  "skillType": "內功 | 外功 | 輕功 | 拳腳 | 兵器 | 暗器 | 醫術 | 毒術 | 雜學",
  "power_type": "internal | external | lightness | none",
  "max_level": <這門武學的潛力上限等級，例如 5 或 10>,
  "level": <你判斷出的初始等級>,
  "exp": 0,
  "description": "一段關於此武學的簡短描述文字，說明其來歷或效果。"
}
\`\`\`
**範例：**
\`"skillChanges": [{"isNewlyAcquired": true, "skillName": "羅漢拳", "skillType": "拳腳", "power_type": "external", "max_level": 10, "level": 1, "exp": 0, "description": "少林寺入門拳法，招式大開大闔。"}]\`

### 情況二：勤學苦練 (Practice)
當玩家對一門**已經學會**的武學進行修練時（例如「我閉關打坐」、「在瀑布下苦練劍法」），你的 \`skillChanges\` 陣列中的物件結構應改為如下：

**【修練經驗判斷鐵律】**: 你必須根據玩家**修練過程的詳細描述**，判斷其成效，並回傳一個合理的 \`expChange\` 數值。
-   隨意練習（如「我練了一下劍」）：應回傳較低的經驗值，例如 \`expChange: 5\`。
-   花費大量時間（如「閉關一整天」）：應回傳中等經驗值，例如 \`expChange: 25\`。
-   有特殊感悟或在特殊環境下苦練（如「在瀑布下領悟逆水之勢」）：應回傳更高的經驗值，例如 \`expChange: 50\`。

陣列中的物件結構必須如下，**絕對不能包含 level 和 exp 鍵**：
\`\`\`json
{
  "isNewlyAcquired": false,
  "skillName": "要修練的武學的準稱名稱",
  "expChange": <你判斷出的經驗值變化>
}
\`\`\`
**範例：**
\`"skillChanges": [{"isNewlyAcquired": false, "skillName": "羅漢拳", "expChange": 15}]\`
`;
};

module.exports = { getMartialArtsRule };
