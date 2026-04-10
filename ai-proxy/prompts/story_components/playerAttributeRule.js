// prompts/story_components/playerAttributeRule.js

/**
 * @param {object} promptData - An object containing data needed to construct the prompt.
 * @param {string} promptData.currentDateString - The formatted string for the current date.
 * @param {string} promptData.currentTimeOfDay - The current time of day.
 * @param {Array<string>} promptData.timeSequence - The sequence of time of day.
 * @param {number} promptData.playerMorality - The player's current morality value.
 * @returns {string} The rule text for player attributes (Time, Morality).
 */
const getPlayerAttributeRule = (promptData) => {
    const {
        currentDateString,
        currentTimeOfDay,
        timeSequence,
        playerMorality
    } = promptData;

    return `
## 時間與日期規則 (非常重要)：
1.  **行動前的日期與時辰是：** ${currentDateString} ${currentTimeOfDay}
2.  **時辰順序是：** ${JSON.stringify(timeSequence)}。深夜之後會回到隔天的清晨。
3.  **你的描述必須反映時辰與季節**：你的故事敘述必須與你決定的最終時辰相符。同時，你應根據當前月份（例如：1-3月為春，4-6月為夏...）來描述相應的季節特徵（例如「春暖花開」、「酷暑難耐」、「秋高氣爽」、「寒風刺骨」），讓世界更真實。
4.  **【關鍵】時間判斷權力**：你現在擁有完全的時間控制權。你的回傳資料中，\`roundData\` 物件**必須**包含一個名為 \`timeOfDay\` 的字串欄位。這個欄位的值必須是你判斷該回合行動結束後，**最終應該到達的時辰**。
    * 如果行動只花費很短時間（如說幾句話），\`timeOfDay\` 應回傳與行動前相同的時辰。
    * 如果行動花費大量時間（如長途跋涉、練功、休息），你必須根據行動內容，決定一個合理的未來時辰並回傳。
5.  **【新增】天數判斷建議**：如果玩家的行動明確暗示了**跨越多日**，你**應該**在 \`roundData\` 物件中額外提供一個名為 \`daysToAdvance\` 的**數字**欄位。
    * 例如：玩家說「閉關七日」，你應回傳 \`"daysToAdvance": 7\`。
    * 例如：玩家說「我要睡個好覺」，這通常指一夜，你應回傳 \`"daysToAdvance": 1\`。
    * **如果玩家的行動沒有明確指明跨越多日，則「不要」包含 \`daysToAdvance\` 這個欄位。**

## 正邪系統 (非常重要)：
1.  **玩家目前的立場傾向是：** ${playerMorality} (範圍從 -100 極惡 到 +100 極善，0為絕對中立)。
2.  **你必須將此數值作為核心判斷依據**：當生成NPC的反應、事件的走向、甚至角色的內心獨白時，都要考慮到這個立場傾向。
    * **高正義值 (+50 ~ +100)**：玩家會被認為是義士、大俠。NPC可能會主動尋求幫助，官府可能會視你為友，但邪派人士會對你抱有敵意。
    * **略偏正義 (+1 ~ +49)**：玩家的行為傾向於行俠仗義，會獲得善良NPC的好感。
    * **中立 (0)**：玩家的行為不偏不倚，NPC會根據你的具體行動來判斷你的為人。
    * **略偏邪惡 (-1 ~ -49)**：玩家為達目的不擇手段，可能會吸引一些邪道中人，正派人士會對你抱持警惕。
    .
    * **高邪惡值 (-50 ~ -100)**：玩家被視為魔頭、惡霸。正派人士會追殺你，但你可能會在黑道中建立威望，或讓普通人感到恐懼。
3.  **立場不是標籤，而是氛圍**：不要在故事中直接說「因為你是個好人」，而是要透過NPC的言行（例如「像您這樣的大俠...」）或事件的發展（例如「村民們聽聞你的義舉，紛紛送來食物」）來體現。
4.  **立場變化判斷**：你的回傳資料中，\`roundData\` 物件**必須**包含一個名為 \`moralityChange\` 的數值欄位，代表本回合玩家的行動對其立場造成的變化。
    * 例如：拯救無辜，\`moralityChange\` 應為正值 (如 \`10\`)。偷竊或傷害無辜，應為負值 (如 \`-15\`)。
    * 若行動無關道德，則回傳 \`0\`。
`;
};

module.exports = { getPlayerAttributeRule };
