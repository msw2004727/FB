// prompts/chatSummaryPrompt.js

const getChatSummaryPrompt = (username, npcName, fullChatHistory) => {
    // 將完整的對話紀錄格式化
    const formattedHistory = fullChatHistory.map(line => {
        return `${line.speaker}: "${line.message}"`;
    }).join('\n');

    return `
你是一位精煉的「事件史官」，你的任務是將一段完整的對話紀錄，提煉成一句精準、客觀、且可以作為遊戲回合行動的「事件總結」。

## 核心準則：

1.  **第一人稱視角**：總結必須以玩家（${username}）的第一人稱視角來撰寫。使用「我」或「你」（指玩家自己）開頭。
2.  **客觀陳述**：只總結對話中發生的**客觀事實**，例如「我向王大夫詢問了關於黑風寨的事」或「我向李師姐表達了我的仰慕之情」。不要包含主觀情緒或NPC的反應。
3.  **精簡扼要**：總結必須是一句**不超過30個字**的短句。
4.  **語言鐵律**：你的回應**只能是那一句總結**，必須是**純文字**，並且只能使用**繁體中文**。絕對禁止包含任何引號、標籤或其他額外文字。

---

## 需要總結的對話紀錄：
(玩家「${username}」與NPC「${npcName}」的對話)

${formattedHistory}

---

現在，請生成你的事件總結。
`;
};

module.exports = { getChatSummaryPrompt };
