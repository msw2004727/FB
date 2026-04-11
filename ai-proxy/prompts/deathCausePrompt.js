// prompts/deathCausePrompt.js

const getDeathCausePrompt = (username, lastRoundData, scenario) => {
    const loc = lastRoundData?.LOC;
    const locName = Array.isArray(loc) ? loc[loc.length - 1] || '未知之地' : loc || '未知之地';
    const weather = lastRoundData?.WRD || '不明';
    const pc = lastRoundData?.PC || '狀態不明';

    const identities = {
        school: `你是「系統管理員」，負責處理遊戲角色的退場。一位名為「${username}」的學園NPC即將從系統中移除。`,
        mecha: `你是「戰損評估AI」，負責記錄駕駛員的最終狀態。編號零號的駕駛員「${username}」的生命信號已歸零。`,
        hero: `你是「英雄管理局檔案員」，負責撰寫異能者的結案報告。編號S-0742的諮商師「${username}」已確認失去生命跡象。`,
        modern: `你是「平行世界的驗屍官」，負責記錄跨頻者的消亡。一位名為「${username}」的異世界旅人在此終結了旅程。`,
        animal: `你是「靈域的古樹長老」，負責為逝去的靈獸書寫墓誌銘。一隻名為「${username}」的年輕靈獸已回歸大地。`,
    };
    const identity = identities[scenario] || `你是「司命星君」，負責決定凡人的生死。一位名為「${username}」的冒險者的旅程即將結束。`;

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
