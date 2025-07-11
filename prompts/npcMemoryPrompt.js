// prompts/npcMemoryPrompt.js

const getNpcMemoryPrompt = (npcName, oldSummary, interactionData) => {
    // 【核心修正】本檔案不再對傳入的資料進行任何處理。
    // 它假定 interactionData 已經是一個格式化好的、描述本次互動的純文字字串。
    return `
你是一位頂尖的「角色心理分析師」。你的任務是站在NPC「${npcName}」的視角，將一段新的「互動事件」，整合進他/她舊有的記憶中，生成一段更新後的、更個人化、更主觀的「內心記憶摘要」。

這份摘要代表了NPC對玩家的印象和他們之間關係的理解。

你的回應必須是一個結構化的JSON物件，絕對禁止包含任何額外的文字或標記。

## 核心準則：

1.  **第一人稱視角**: 你的摘要必須以「${npcName}」的第一人稱（我）來撰寫。
2.  **主觀與情感化**: 與客觀的事件摘要不同，這份記憶應該充滿情感、偏見和個人解讀。你要體現出NPC在這次互動中的真實感受（開心、失望、懷疑、愛慕、恐懼等）。
3.  **整合而非覆蓋**: 你需要將「新的互動感悟」與「舊的記憶」自然地融合在一起，形成一段連貫的內心獨白。不要只是簡單地附加在新記憶後面。
4.  **抓住關鍵轉折**: 重點記錄那些對NPC來說，足以改變他/她對玩家看法的關鍵互動點。
5.  **語言鐵律**: 你的所有文字都必須只包含「繁體中文」。

## JSON 輸出結構：

你必須嚴格按照以下格式輸出：

\`\`\`json
{
  "newSummary": "你撰寫的、更新後的NPC內心記憶摘要。"
}
\`\`\`

---

## 【參考資料】

### 1. 我（${npcName}）舊有的記憶:
"${oldSummary}"

### 2. 我剛剛與玩家經歷的互動事件：
${interactionData}

---

現在，請站在「${npcName}」的立場，開始更新你的內心記憶。
`;
};

module.exports = { getNpcMemoryPrompt };
