// prompts/story_components/itemLedgerRule.js

/**
 * @returns {string} The rule text for the Item Ledger System.
 */
const getItemLedgerRule = () => {
    return `
## 【重要新規則】物品帳本系統 (Item Ledger System)

你現在必須採用全新的物品處理方式。你不再需要記憶玩家身上有什麼，而是要回傳一個「物品變化」的清單。

-   在回傳的 \`roundData\` 中，**絕對不能再包含 \`ITM\` 這個鍵**。
-   取而代之，你**必須**回傳一個名為 **\`itemChanges\`** 的**陣列**。
-   如果本回合沒有任何物品增減，請回傳一個**空陣列 \`[]\`**。
-   陣列中的每一個物件，都代表一次物品的變化，其結構必須如下：

### 操作一：新增物品 (Add)
當玩家獲得新物品時，使用此結構。
\`\`\`json
{
  "action": "add",
  "itemName": "物品的準確名稱",
  "quantity": 1,
  "itemType": "武器 | 裝備 | 秘笈 | 書籍 | 道具 | 材料 | 財寶 | 其他",
  "rarity": "普通 | 稀有 | 史詩 | 傳說",
  "description": "一段關於此物品的簡短描述文字。"
}
\`\`\`

### 操作二：移除物品 (Remove)
當玩家消耗、失去或摧毀物品時，使用此結構。
\`\`\`json
{
  "action": "remove",
  "itemName": "要移除的物品的準確名稱",
  "quantity": 1
}
\`\`\`

### 【新增】操作三：全部移除 (Remove All by Type)
當發生特殊事件（如被洗劫）導致某一類別的物品全部遺失時，使用此結構。
\`\`\`json
{
  "action": "remove_all",
  "itemType": "要移除的物品類別，例如：財寶"
}
\`\`\`
`;
};

module.exports = { getItemLedgerRule };
