// prompts/chatSummaryPrompt.js

const getChatSummaryPrompt = (username, npcName, fullChatHistory, longTermSummary) => {
    // 將完整的對話紀錄格式化
    const formattedHistory = fullChatHistory.map(line => {
        return `${line.speaker}: "${line.message}"`;
    }).join('\n');

    return `
你是一位功力深厚的「首席劇作家」。你的任務是將一段完整的對話紀錄，結合當前的「江湖時事」，改寫成一段精彩的「故事劇本」，並為其提煉一句畫龍點睛的「章回標題」。

你的回應必須是一個結構化的JSON物件，絕對禁止包含任何額外的文字或標記。

## 核心準則：

1.  **故事劇本 (story)**:
    * 你必須以第三人稱、小說的筆法，將整段對話的來龍去脈、核心內容、以及雙方的情緒轉折，生動地描寫出來。
    * 【重要】你的故事必須巧妙地融入我提供的「江湖時事」作為背景，讓對話發生在一個更宏大的世界觀下，而不僅僅是孤立的事件。
    * 故事內容需要包含對話中的關鍵資訊，例如獲得了什麼秘密、達成了什麼約定、或是感情發生了什麼變化。
    * 字數嚴格控制在500字以內。

2.  **章回標題 (evt)**:
    * 根據你寫好的故事劇本，提煉一句15-25個字的、富有江湖氣息和意境的章回標題。
    * 風格需像武俠小說的章回標題，意簡言賅，但充滿韻味。

3.  **語言鐵律**: 你的所有文字都必須只包含「繁體中文」。

## JSON 輸出結構：

你必須嚴格按照以下格式輸出：

\`\`\`json
{
  "story": "你改寫後的、500字以內的小說化故事劇本。",
  "evt": "你為這段故事提煉出的章回標題。"
}
\`\`\`

---

## 【參考資料】

### 1. 當前的江湖時事 (長期故事摘要):
${longTermSummary}

### 2. 需要改編的對話紀錄：
(玩家「${username}」與NPC「${npcName}」的對話)

${formattedHistory}

---

現在，請開始你的劇本創作工作。
`;
};

module.exports = { getChatSummaryPrompt };
