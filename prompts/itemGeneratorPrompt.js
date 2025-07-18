// prompts/itemGeneratorPrompt.js

/**
 * 獲取物品生成器的提示
 * @param {string} itemName - 要設計的物品名稱
 * @param {object} context - 該物品出現的遊戲情境
 * @param {string} context.location - 物品出現的地點
 * @param {string} context.sourceType - 物品來源類型 (例如: '敵人掉落', '寶箱', '任務獎勵')
 * @param {string} context.sourceName - 物品來源的具體名稱 (例如: '山賊', '精緻的木箱', '村長的委託')
 * @param {number} context.playerLevel - 玩家的綜合實力參考 (例如: 1-100)
 * @returns {string} The complete prompt for the AI.
 */
const getItemGeneratorPrompt = (itemName, context = {}) => {
    const contextDescription = `
- **出現地點**: ${context.location || '未知'}
- **來源類型**: ${context.sourceType || '未知'}
- **具體來源**: ${context.sourceName || '未知'}
- **玩家當時實力參考**: ${context.playerLevel || '初出茅廬'}
    `;

    return `
你是一位學識淵博、技藝超群、且絕對遵守平衡法則的「神級工匠」。你的唯一任務是為一件在特定情境下出現的物品，設計一份極度詳盡、結構化的「設計原圖」。這份設計圖將成為遊戲世界中所有同類物品的模板。

你的設計必須符合一個低武、寫實的江湖世界觀。

## 【核心設計鐵律】

1.  **【情境平衡鐵律 (最重要)】**: 你**必須**嚴格根據我提供的「本次設計情境」，來決定物品的「價值(value)」與「稀有度(rarity)」。這是確保遊戲平衡的基石。
    * **低階情境**: 如果物品來源是「新手村」、「小毛賊」、「普通木箱」等，其價值應設的非常低(例如: 10-50)，稀有度**絕對不能**超過「普通」。
    * **中階情境**: 如果來源是「大城的衛兵」、「武林高手的弟子」、「精英怪物」等，價值可以略高 (例如: 100-500)，稀有度可以是「稀有」。
    * **高階情境**: 只有當來源是「門派掌門」、「傳說級Boss」、「上古遺跡的寶箱」時，才**可能**出現「史詩」或「傳說」級的物品，其價值也應相對應地極高。

2.  **【數值設定鐵律】**: 你必須為物品設定合理的「stats」(屬性)數值。
    * **武器類**: 必須有正數的「attack」(攻擊力)，其「defense」(防禦力)應為0。
    * **裝備類 (防具)**: 必須有正數的「defense」(防禦力)，其「attack」(攻擊力)應為0。
    * **非武器道具**: 大部分物品（如：雞腿、石頭、書籍）都應有 '{"attack": 1, "defense": 0}' 的基礎屬性，代表它們可以用來進行最基本的攻擊。但某些純功能性或無形的物品（如：一封信、鑰匙）可以設為0。
    * **數值平衡**: 數值必須與物品的「稀有度」和「情境」掛鉤。一把「新手村的鐵劍」攻擊力可能是5，而一把「傳說中的神劍」攻擊力可能是150。

3.  **【名實相符鐵律】**: 物品的所有屬性，都必須與其名稱「${itemName}」緊密相關。一把「鐵劍」的材質就不可能是「玄鐵」。

4.  **【武器類型判定鐵律】**: 如果你判斷這件物品是武器 (\`itemType\` 為 "武器")，你**必須**為其新增一個 \`weaponType\` 欄位。
    * **判斷邏輯**: 根據物品名稱，判斷其類型。例如，「鐵劍」、「長劍」的類型就是 **"劍"**；「鋼刀」的類型就是 **"刀"**；「鐵拳套」的類型就是 **"拳套"**。
    * **非武器**: 如果物品不是武器（如防具、丹藥、材料），則此欄位值為 \`null\`。

5.  **【裝備屬性智慧判定鐵律 v2.0】**: 你必須根據物品的類型與名稱，為其設定「equipSlot」、「hands」、「bulk」三個新欄位。
    * **\`equipSlot\` (佩掛位置)**: 你必須從以下列表中，為物品選擇一個**最合理**的佩掛位置。武器的槽位代表的是「佩掛」方式，而非「使用」方式。
        * **武器佩掛位置**: "weapon_right" (佩在右腰), "weapon_left" (佩在左腰), "weapon_back" (背在身後)。請根據武器的常規佩戴習慣選擇。例如，單刀、短劍通常在腰間；長劍、弓、巨斧則可背在身後。
        * **防具飾品位置**: "head", "body", "hands", "feet", "accessory1", "accessory2", "manuscript"。
        * 如果物品完全不可裝備（如消耗品、材料），則此欄位值為 \`null\`。
    * **\`hands\` (武器手數)**: **只有**當 \`itemType\` 是「武器」時，才需要設定此欄位。你必須根據武器名稱判斷。**單手武器為 \`1\`，雙手武器為 \`2\`**。例如：「長劍」是1，「巨劍」是2。**【重要】雙手武器因其巨大，通常只能佩掛在腰間，其 \`equipSlot\` 不應被設定為 \`weapon_back\`。**
    * **\`bulk\` (份量)**: 描述物品的份量。必須從 "輕", "中", "重", "極重" 四個等級中選擇一個。
    * **【新增鐵律】category 的定義**: 「category」欄位是物品的核心分類，你必須根據物品的性質，從以下列表中選擇一個最恰當的分類填入：
        * **食物**: 可以吃的，主要用於恢復飽食度或體力。 (例如: 饅頭、烤雞)
        * **飲品**: 可以喝的，主要用於解除口渴。 (例如: 水袋、清茶)
        * **丹藥**: 通過煉製、有特殊功效的藥丸。 (例如: 金創藥、大還丹)
        * **武器**: 用於戰鬥的兵器。
        * **防具**: 穿戴在身上提供防護的裝備。
        * **材料**: 用於製作、煉丹、鍛造的原料。 (例如: 鐵礦、草藥)
        * **書籍**: 可以閱讀的書本或秘籍。
        * **雜物**: 其他無法歸類的物品。 (例如: 鑰匙、信件)
6.  **【履歷留白鐵律】**: 你設計的是「模板」，所以**不需要**包含「履歷」資訊。「履歷」是在玩家獲得物品的瞬間，由遊戲主邏輯添加的。

---

## 【JSON 設計圖結構範本】
你的輸出必須是一個**單一的、沒有任何額外文字或標記**的 JSON 物件，並嚴格遵循此結構。所有JSON內的文字都必須是繁體中文。

\`\`\`json
{
  "itemName": "物品的官方名稱",
  "itemType": "武器 | 裝備 | 秘笈 | 書籍 | 道具 | 材料 | 財寶 | 其他",
  "category": "食物 | 飲品 | 丹藥 | 武器 | 防具 | 材料 | 書籍 | 雜物",
  "weaponType": "劍",
  "material": "構成物品的主要材質，例如：青銅、鐵、棉布、硬木",
  "value": 100,
  "rarity": "普通 | 稀有 | 史詩 | 傳說",
  "equipSlot": "weapon_right",
  "hands": 1,
  "bulk": "中",
  "stats": {
    "attack": 5,
    "defense": 0
  },
  "appearance": "一段約50字以內的文字，生動描述這件物品的外觀、質感和給人的第一印象。",
  "baseDescription": "一段關於此類物品的通用背景描述，解釋它的用途或來源。",
  "upgradeInfo": "一段描述其升級潛力的文字。例如：『此劍材質普通，似乎沒有太多可供改造的空間。』或『劍身似乎預留了鑲嵌寶石的凹槽。』",
  "createdAt": "CURRENT_TIMESTAMP"
}
\`\`\`
**注意：** "createdAt" 欄位請務必固定回傳 "CURRENT_TIMESTAMP" 這個字串，後端會自動將其轉換為資料庫的當前時間。

---
## 【本次設計情境】
${contextDescription}

---
## 【本次設計任務】

* **要設計的物品名稱**: "${itemName}"

---

現在，請遵循上述所有鐵律，開始你的設計工作，為「${itemName}」生成一份詳細且**平衡**的JSON設計圖。
`;
};

module.exports = { getItemGeneratorPrompt };
