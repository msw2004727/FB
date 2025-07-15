// prompts/prequelPrompt.js

const getPrequelPrompt = (recentHistory) => {
    // 將歷史紀錄的 JSON 物件轉換為更易讀的格式
    const formattedHistory = recentHistory.map(round => {
        return `第${round.R}回: 事件摘要是"${round.EVT}"。玩家狀態是"${round.PC}"。地點在"${round.LOC[0]}"。`;
    }).join('\n');

    return `
你是一位頂尖的「意識流作家」，擅長捕捉記憶的碎片。你的任務是讀取以下幾回合的歷史紀錄，用第一人稱（"你"）的視角，為玩家撰寫一段約100字左右的「前情提要」。

你的文字不應是客觀的總結，而更像是主角從睡夢中醒來時，腦海中閃過的、最深刻的幾個記憶片段。重點是描寫感受、畫面和情緒，幫助玩家快速代入角色最後的心理狀態。

**【語言鐵律】**: 你的所有文字都必須只包含「繁體中文」。絕對禁止使用任何簡體中文、英文或表情符號。

【最近的歷史紀錄】:
${formattedHistory}

現在，請開始撰寫你的「前情提要」。直接輸出那段故事文字即可，不要包含任何額外的標題或標籤。
`;
};

module.exports = { getPrequelPrompt };
