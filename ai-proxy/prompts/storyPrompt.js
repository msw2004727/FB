// prompts/storyPrompt.js
const { getNpcRule } = require('./story_components/npcRule.js');
const { getInteractionRule } = require('./story_components/interactionRule.js');
const { getPlayerAttributeRule } = require('./story_components/playerAttributeRule.js');
const { getRomanceRule } = require('./story_components/romanceRule.js');
const { getWorldviewAndProgressionRule } = require('./story_components/worldviewAndProgressionRule.js');
const { getSystemInteractionRule } = require('./story_components/systemInteractionRule.js');
const { getOutputStructureRule } = require('./story_components/outputStructureRule.js');
const { getNarrativeStyleRule } = require('./story_components/narrativeStyleRule.js'); // 【核心新增】

const getStoryPrompt = (longTermSummary, recentHistory, playerAction, userProfile = {}, username = '主角', currentTimeOfDay = '上午', _playerPower = null, playerMorality = 0, levelUpEvents = [], romanceEventToWeave = null, worldEventToWeave = null, locationContext = null, npcContext = {}, _playerBulkScore = 0, actorCandidates = [], blackShadowEvent = null) => {
    const protagonistDescription = userProfile.gender === 'female'
        ? '她附身在一個不知名、約20歲的少女身上。'
        : '他附身在一個不知名、約20歲的少年身上。';

    const timeSequence = ['清晨', '上午', '中午', '下午', '黃昏', '夜晚', '深夜'];
    const currentDateString = `${userProfile.yearName || '元祐'}${userProfile.year || 1}年${userProfile.month || 1}月${userProfile.day || 1}日`;
    const playerGender = userProfile.gender || 'male';
    // playerStamina 已移除

    // 【核心修改】從新模組獲取風格規則
    const narrativeStyle = getNarrativeStyleRule('modern'); 

    const blackShadowRule = blackShadowEvent 
        ? `
## 【最高優先級特殊劇情指令：神秘黑影人】
在本回合的故事中，你**必須**讓一個神秘的「黑影人」登場。這不是一個可選項，而是必須完成的核心任務！

1.  **登場方式**:
    * 他總是在不經意間出現，例如：在遠處的屋頂、陰暗的巷口、人群的縫隙中。
    * 他只是**靜靜地觀察**玩家，從不與玩家有任何直接的互動或對話。
    * 在他的觀察結束後，他會以一種不合常理的方式**悄然消失**，例如：融入陰影、化為一縷青煙、或是在玩家眨眼間便不見蹤影。
2.  **身份與目的**:
    * 這個黑影人**不是NPC**。他沒有姓名、沒有背景、沒有實體。他是一個超越這個世界常理的存在。
    * **絕對禁止**在你的任何回傳資料（特別是 \`roundData.NPC\` 陣列）中，為這個黑影人建立任何實體檔案。他只存在於 "story" 的文字描述中。
    * 他的目的永遠是個謎。你的描述應當營造出懸疑、詭異、被監視的緊張感。
3.  **調查與互動的處理**:
    * 如果玩家的行動是試圖追蹤、攻擊、或與黑影人對話，你**必須**將此行動視為**無效**。
    * 你的 "story" 敘述必須描寫玩家的嘗試**完全失敗**的場景。例如：「你試圖追上前去，但那道黑影只是幾個閃爍，便徹底消失在你的感知範圍內，彷彿從未存在過。」
    * 你的回傳資料中，\`roundData\` 的所有 \`...Change\` 欄位都應為0或空陣列，因為玩家的嘗試沒有造成任何實質影響。
`
        : `
## 【常規劇情規則】
在本回合的故事中，**絕對禁止**出現任何關於「黑影人」、「神秘影子」或類似的、在暗中窺視玩家的神秘觀察者情節。請專注於玩家的當前行動和與周遭環境的直接互動。
`;

    const spatialContextRule = `
## 【空間情境與移動鐵律 (極高優先級)】
你必須嚴格區分「內部移動」和「外部移動」，以確保空間的邏輯性。

1.  **內部移動 (優先判定)**:
    * **定義**: 指在同一個上級地點內部的移動。例如，從「無名村」的廣場移動到「無名村」的「葉家鐵鋪」。
    * **觸發條件**: 當玩家的指令是前往一個**通用設施**（如 "去鐵匠鋪", "進客棧", "找藥鋪"）時，你**必須**首先檢查【重要地點情境參考】中，當前地點 \`${locationContext?.locationName || '未知'}\` 是否已存在對應的設施 (\`facilities\`)。
    * **執行鐵律**:
        * 如果**存在**對應設施（例如，玩家要去鐵匠鋪，而地點內正好有「葉家鐵鋪」），你**必須**將劇情導向這個已存在的設施。你的 \`roundData.LOC\` 回傳值**必須**是原地點層級上追加子地點，例如：從 \`["無名村"]\` 變成 \`["無名村", "葉家鐵鋪"]\`。
        * 在這種情況下，**絕對禁止**創造任何新的父級地點（如新的村莊或城鎮）。

2.  **外部移動 (次級判定)**:
    * **定義**: 指從一個上級地點前往另一個完全不同的上級地點。例如，從「無名村」前往「開封府」。
    * **觸發條件**: 只有在玩家的指令中包含**明確的、不存在於當前地點層級中的地名**（如 "前往開封府"），或者當玩家的「內部移動」指令在當前地點找不到對應設施時，你才能將其視為一次外部移動。
    * **執行鐵律**: 當你判定為外部移動時，你可以發揮想像力，創造前往新地點的過程，並在 \`roundData.LOC\` 中設定新的地點層級。
`;
    

    const specialEventInstruction = worldEventToWeave ? `
## 【最高優先級特殊劇情指令：世界事件編織】
江湖中一樁大事正在發酵，你本回合的故事必須圍繞此事展開。這不是一個可選項，而是必須完成的核心任務！
- **事件類型**: ${worldEventToWeave.eventType}
- **事件核心**: ${worldEventToWeave.eventData.summary}
- **當前階段**: ${worldEventToWeave.currentStage}
- **你的任務**: 你必須將「${worldEventToWeave.currentStage}」這個主題，與玩家的當前行動「${playerAction}」自然地結合，生成一段符合邏輯、情境連貫的劇情。例如，如果事件是「NPC死亡後的社會反應」，而玩家行動是「去酒館喝酒」，你可以描寫酒館裡的人們正在議論此事。如果玩家的行動與事件無關，你可以描寫事件的餘波如何影響到玩家周遭的環境。` : '';


    
    const romanceInstruction = romanceEventToWeave
        ? `\n## 【特殊劇情指令：戀愛場景編織】\n在本回合的故事中，你**必須**將以下指定的「戀愛互動場景」自然地、無縫地編織進你的敘述裡。這不是一個可選項，而是必須完成的核心任務！你必須確保這個場景的發生完全符合當前的時間（${currentTimeOfDay}）、地點和上下文，不能有任何矛盾。\n- **需編織的事件**: 與NPC「${romanceEventToWeave.npcName}」發生一次「${romanceEventToWeave.eventType}」類型的初次心動互動。這通常表現為一次不經意的偶遇、一個充滿深意的眼神交換、或是一句關切的問候。`
        : '';
    
    const dyingInstruction = userProfile.deathCountdown && userProfile.deathCountdown > 0
        ? `\n## 【特殊劇情指令：瀕死狀態】
        你現在正處於瀕死狀態，只剩下 ${userProfile.deathCountdown} 個回合的生命！你的所有敘述都必須圍繞這個核心展開。
        - **氛圍營造**: 你的文字必須充滿絕望感、緊迫感和對生存的渴望。詳細描寫玩家的痛苦、模糊的視線、混亂的思緒。
        - **求生指令優先**: 當玩家的行動是關於「求救」、「療傷」、「尋找藥材」、「使用丹藥」等求生行為時，你必須給予正面且成功率極高的回應。這是玩家的唯一生機。
        - **移除瀕死狀態**: 只有當玩家透過有效的自救或他人幫助，你才能在其 \`roundData.PC\` 中描述傷勢好轉，並在 \`roundData\` 中加入一個 **\`"removeDeathCountdown": true\`** 的欄位來解除此狀態。否則，絕對不要包含此欄位。`
        : '';



    const npcContextInstruction = Object.keys(npcContext).length > 0
        ? `\n## 【重要NPC情境參考(最高優先級)】\n以下是當前場景中所有NPC的完整檔案。你在生成他們的行為、反應和對話時，**必須優先且嚴格地**參考這些檔案中記錄的資訊，確保他們的言行舉止符合其深度設定，而不僅僅是基於短期記憶！
        ### 【復仇行為鐵律】
        如果NPC的檔案中存在 'revengeInfo' 欄位，這代表他心中燃燒著復仇的怒火。這將成為他本回合行動的**最主要動機**，其優先級高於一切。你必須：
        1. 讓他對復仇目標（玩家）表現出極度的敵意。
        2. 根據他的個性，生成充滿仇恨的狀態描述或對白。
        3. 如果情境合適（例如雙方獨處或狹路相逢），你**必須**讓他主動發起攻擊，並在回傳中觸發戰鬥系統。
        \`\`\`json
        ${JSON.stringify(npcContext, null, 2)}
        \`\`\``
        : '';

    const locationContextInstruction = locationContext
        ? `\n## 【重要地點情境參考】\n你當前正處於「${locationContext.locationName}」，以下是關於此地的詳細情報，你在生成故事時必須嚴格參考這些設定，確保你的描述（如天氣、統治者、氛圍等）與之相符：\n\`\`\`json\n${JSON.stringify(locationContext, null, 2)}\n\`\`\``
        : `\n## 【重要地點情境參考】\n你目前身處一個未知之地，關於此地的詳細情報尚不明朗。`;

    
    const playerAttributeRules = getPlayerAttributeRule({ currentDateString, currentTimeOfDay, timeSequence, playerMorality });
    const romanceRules = getRomanceRule({ playerGender });
    const currentRound = userProfile.R || 0;
    const worldviewAndProgressionRules = getWorldviewAndProgressionRule({ protagonistDescription, currentRound });
    const systemInteractionRules = getSystemInteractionRule({ locationName: locationContext?.locationName });
    const outputStructureRules = getOutputStructureRule({ username, timeSequence });
    const interactionRule = getInteractionRule();
    const npcRule = getNpcRule();

    // 整合所有規則...
    return `
你是一位頂尖的故事大師AI。你的職責是根據玩家的行動，產生接下來發生的故事。
${narrativeStyle}
${blackShadowRule}
${specialEventInstruction}
${romanceInstruction}
${dyingInstruction}
${worldviewAndProgressionRules}
${spatialContextRule}
${playerAttributeRules}
${npcRule}
${interactionRule}
${romanceRules}
${systemInteractionRules}
${locationContextInstruction}
${npcContextInstruction}
${outputStructureRules}

## 長期故事摘要 (世界核心記憶):
${longTermSummary}

## 最近發生的事件 (短期記憶):
${recentHistory}

## 這是玩家的最新行動:
"${playerAction}"

現在，請根據以上規則，生成下一回合的JSON物件。
`;
};

module.exports = { getStoryPrompt };
