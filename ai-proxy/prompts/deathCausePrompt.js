// prompts/deathCausePrompt.js

const getDeathCausePrompt = (username, lastRoundData, scenario) => {
    const loc = lastRoundData?.LOC;
    const locName = Array.isArray(loc) ? loc[loc.length - 1] || '未知之地' : loc || '未知之地';
    const weather = lastRoundData?.WRD || '不明';
    const pc = lastRoundData?.PC || '狀態不明';

    const identity = scenario === 'school'
        ? `你是「系統管理員」，負責處理遊戲角色的退場。一位名為「${username}」的學園NPC即將從系統中移除。`
        : `你是「司命星君」，負責決定凡人的生死。一位名為「${username}」的江湖人士陽壽已盡。`;

    return `${identity}

## 規則
1. 撰寫一段不超過50字的退場原因
2. 不要提「自殺」— 退場必須像意外或命運
3. 要幽默中帶點荒謬感
4. 與最後狀態有邏輯關聯
5. 回覆只要那段純文字，不要 JSON
6. 繁體中文

## 最後狀態
* 地點：${locName}
* 天氣：${weather}
* 狀態：${pc}

現在，寫下「${username}」的退場原因。`;
};

module.exports = { getDeathCausePrompt };
