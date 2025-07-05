// prompts/prequelPrompt_gundam.js

const getPrequelPrompt = (recentHistory) => {
    // 將歷史紀錄的 JSON 物件轉換為更易讀的格式
    const formattedHistory = recentHistory.map(round => {
        return `任務時間 ${round.R}: 事件摘要是"${round.EVT}"。駕駛員狀態是"${round.PC}"。作戰位置在"${round.LOC[0]}"。`;
    }).join('\n');

    return `
你是一位專業的「任務簡報官」。你的任務是根據以下提供的數次作戰紀錄，用第二人稱（"你"）的視角，為駕駛員撰寫一段引人入勝、約100字左右的「前情提要」。

你的語氣應該像在任務開始前的簡報，快速幫助駕駛員回憶起最重要的戰況、所在位置和機體狀態，但不要逐字逐句地複述數據。重點是營造出發前的緊張氣氛，讓玩家能立刻沉浸到上次結束任務時的情境中。

【最近的作戰紀錄】:
${formattedHistory}

現在，請開始撰寫你的「前情提要」。直接輸出那段簡報文字即可，不要包含任何額外的標題或標籤。
`;
};

module.exports = { getPrequelPrompt };
