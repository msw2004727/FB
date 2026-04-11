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
        playerMorality,
        scenario
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

## 行事風格系統 (非常重要)：
${scenario && scenario.id === 'school' ? `
1.  **玩家目前的行事風格值是：** ${playerMorality} (範圍從 -100 極自由 到 +100 極秩序，0為中立)。
2.  **你必須將此數值作為核心判斷依據**：
    * **高秩序值 (+50 ~ +100)**：玩家被視為模範生。老師信任你、學生會拉攏你，但叛逆型同學可能不屑你。
    * **略偏秩序 (+1 ~ +49)**：玩家傾向遵守規則，會獲得老師和優等生的好感。
    * **中立 (0)**：玩家見機行事，NPC會根據你的具體行動來判斷你的為人。
    * **略偏自由 (-1 ~ -49)**：玩家傾向挑戰規則，可能被不良少年認可，老師會留意你。
    * **高自由值 (-50 ~ -100)**：玩家是出了名的反骨。不良少年仰慕你、老師警戒你、學生會視你為眼中釘。
3.  **行事風格不是標籤，而是氛圍**：要透過NPC的言行或事件的發展來體現。例如模範生路線：「班導在走廊遇到你，微笑著拍了拍你的肩」；反骨路線：「你一進教室，班長的表情就僵住了」。
` : `
1.  **玩家目前的立場傾向是：** ${playerMorality} (範圍從 -100 極惡 到 +100 極善，0為絕對中立)。
2.  **你必須將此數值作為核心判斷依據**：
    * **高正義值 (+50 ~ +100)**：玩家會被認為是義士。NPC可能會主動尋求幫助，正派人士視你為友。
    * **略偏正義 (+1 ~ +49)**：玩家的行為傾向於行俠仗義，會獲得善良NPC的好感。
    * **中立 (0)**：玩家的行為不偏不倚，NPC會根據你的具體行動來判斷你的為人。
    * **略偏邪惡 (-1 ~ -49)**：玩家為達目的不擇手段，可能會吸引一些亦正亦邪之人。
    * **高邪惡值 (-50 ~ -100)**：正派人士會追殺你，但你可能在暗處建立威望。
3.  **立場不是標籤，而是氛圍**：要透過NPC的言行或事件的發展來體現。
`}
4.  **立場變化判斷**：你的回傳資料中，\`roundData\` 物件**必須**包含一個名為 \`moralityChange\` 的數值欄位，代表本回合玩家的行動對其立場造成的變化。
    * 若行動無關立場，則回傳 \`0\`。
`;
};

module.exports = { getPlayerAttributeRule };
