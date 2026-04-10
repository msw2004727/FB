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
當玩家獲得新物品時，使用此結構。你的職責**僅僅是命名**這個物品，後端系統會自動處理它的詳細屬性。
\`\`\`json
{
  "action": "add",
  "itemName": "你為這個新物品取的準確名稱",
  "quantity": 1
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
