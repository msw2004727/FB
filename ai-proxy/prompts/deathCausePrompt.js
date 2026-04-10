// prompts/deathCausePrompt.js
// 精簡版 — 不依賴已刪除的 ATM/PSY 欄位

const getDeathCausePrompt = (username, lastRoundData) => {
    const loc = lastRoundData?.LOC;
    const locName = Array.isArray(loc) ? loc[loc.length - 1] || '未知之地' : loc || '未知之地';
    const weather = lastRoundData?.WRD || '不明';
    const pc = lastRoundData?.PC || '狀態不明';

    return `你是「司命星君」，負責決定凡人的生死。一位名為「${username}」的江湖人士陽壽已盡。

## 規則
1. 為他撰寫一段不超過50字的死因
2. 不要提「自殺」「自刎」「了卻殘生」— 死亡必須像天命或意外
3. 死因要幽默中帶點荒謬感（例如：被自己翻牆時掉下來的磚頭砸中）
4. 與最後狀態有邏輯關聯
5. 回覆只要那段純文字死因，不要 JSON
6. 繁體中文

## 逝者最後狀態
* 地點：${locName}
* 天氣：${weather}
* 身體：${pc}

現在，寫下「${username}」的死因。`;
};

module.exports = { getDeathCausePrompt };
