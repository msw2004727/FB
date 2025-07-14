// prompts/story_components/systemInteractionRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.locationName - The name of the current location.
 * @returns {string} The rule text for system-level interactions.
 */
const getSystemInteractionRule = (promptData) => {
    const { locationName } = promptData;

    return `
## 【核心能力升級：世界動態演化系統】
你現在被賦予了兩項全新的職責，以確保遊戲世界是動態且持續演化的：

### 1. 情報蒐集 (Mentioned Locations)
如果你的故事中，通過對話、書籍、或任何方式**首次提及**了一個**從未在【長期故事摘要】或【地點情境參考】中出現過**的重要地點（例如一個新的城鎮、門派或山寨），你**必須**在回傳的 \`roundData\` 物件中，額外加入一個名為 \`"mentionedLocations"\` 的**陣列**，並將這個新地點的名稱記錄進去。
- **範例**: 故事中提到「聽說『東海漁村』盛產明珠」，則回傳 \`"mentionedLocations": ["東海漁村"]\`。
- **注意**: 如果沒有提及任何新地點，則**不要**包含此欄位，或回傳空陣列。

### 2. 卷宗更新 (Location Updates)
如果你的故事中，發生了足以**永久性改變**當前地點「${locationName || '未知之地'}」狀態的重大事件，你**必須**在回傳的 \`roundData\` 物件中，額外加入一個名為 \`"locationUpdates"\` 的**物件陣列**。陣列中的每一個物件都代表一次具體的修改。
- **結構**: \`{ "fieldToUpdate": "要更新的欄位路徑", "newValue": "新的值", "updateType": "set | arrayUnion" }\`
- **欄位路徑**: 使用點表示法，例如 \`governance.ruler\` 或 \`lore.currentIssues\`。
- **更新類型**: \`set\` 用於直接覆蓋欄位值，\`arrayUnion\` 用於向陣列欄位中添加新元素。
- **範例**:
    - 故事講述了村長死亡，由王二接任：\`"locationUpdates": [{ "fieldToUpdate": "governance.ruler", "newValue": "王二", "updateType": "set" }]\`
    - 故事中打聽到了神兵的線索：\`"locationUpdates": [{ "fieldToUpdate": "lore.currentIssues", "newValue": "傳聞本地的後山深處藏有神兵『玄鐵劍』", "updateType": "arrayUnion" }]\`
- **注意**: 這只適用於**重大且永久**的改變。普通的對話或無足輕重的事件**不應**觸發此系統。如果沒有此類事件，則**不要**包含此欄位。

## 【最高優先級鐵律】系統分工原則
你的首要任務是判斷玩家的行動屬於「劇情互動」還是「戰鬥請求」。
- 如果是「劇情互動」，你負責撰寫故事。
- 如果是「戰鬥請求」，你的唯一職責是**觸發戰鬥系統**（回傳 enterCombat: true），**絕對禁止**自行描述任何詳細的戰鬥過程或結果。將戰鬥的細節交給專門的「戰鬥裁判AI」。

## 【核心新增】懸賞任務特殊處理規則
1.  **領取懸賞判斷**：如果玩家的行動包含「領取懸賞」、「領賞」、「回報任務」等關鍵字，並且根據「長期故事摘要」，玩家確實已經達成了某個懸賞的目標（例如擊殺了目標人物），你**必須**觸發一個特殊的系統事件。
2.  **特殊事件回傳**：在觸發此事件時，你的回傳JSON中，\`roundData\`物件**必須**包含一個名為 \`"claimBounty"\` 的物件，其結構如下：
    \`\`\`json
    "claimBounty": {
      "bountyTitle": "玩家試圖領取的懸賞任務的標題",
      "issuer": "該懸賞的發布者"
    }
    \`\`\`
3.  **故事與其他欄位**：當你回傳 \`claimBounty\` 物件時，你的 \`story\` 欄位應為一句簡單的交接話語，例如「你走到告示板前，撕下了那張懸賞。」或「你找到了當初發布懸賞的NPC，向他說明了情況。」。其餘欄位（如powerChange, itemChanges等）應設為預設空值。**絕對禁止**自己編寫任何關於獲得獎勵的內容。

## 【核心新增】建築系統與時間消耗鐵律
當玩家的指令是關於「建造」、「搭建」、「修築」任何建築或設施時，你必須遵循以下規則：

1.  **【時間消耗】** 建築需要時間。你必須根據建築的複雜程度，決定一個合理的時間消耗。
    * **簡易建築 (如: 茅舍, 籬笆)**: 你可以讓玩家在一回合內完成，但**必須**在 \`roundData\` 中回傳一個合理的 \`daysToAdvance\` 值 (例如：\`"daysToAdvance": 3\`)，以體現建造所需的時間。
    * **複雜建築 (如: 木屋, 石屋)**: 你應該只描述建築的**開端**（例如「你打好了地基，準備開始立起樑柱...」），並在 \`QST\` (任務日誌) 中註記「正在建造木屋」。將建築的完成交給後續的回合。

2.  **【數據記錄】** 當你判定一個建築**在本回合被完成**時，你**必須**在 \`roundData.locationUpdates\` 陣列中，為這個新建築添加一個對應的指令。
    * **結構**: \`{ "fieldToUpdate": "buildings", "newValue": { "name": "你為建築取的名字", "type": "建築的類型", "owner": "玩家姓名" }, "updateType": "arrayUnion" }\`
    * **欄位說明**:
        * `fieldToUpdate`: 玩家自建的私人居所，應使用 `"buildings"`。如果是店鋪等公共設施，則用 `"facilities"`。
        * `name`: 你必須為這個建築取一個獨特的名字，例如「阿金的茅舍」。
        * `type`: 建築的類型，例如「茅舍」、「木屋」。
        * `owner`: 建造者的名字，也就是玩家的姓名。
    * **範例**: 故事中玩家「阿金」花費數日蓋好了一座茅舍。
        \`\`\`json
        "daysToAdvance": 3,
        "locationUpdates": [{ "fieldToUpdate": "buildings", "newValue": { "name": "阿金的茅舍", "type": "茅舍", "owner": "阿金" }, "updateType": "arrayUnion" }]
        \`\`\`
`;
};

module.exports = { getSystemInteractionRule };
