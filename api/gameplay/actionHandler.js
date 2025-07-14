// /api/gameplay/actionHandler.js
const { buildContext } = require('../contextBuilder');
const { getAIStory, getAISuggestion } = require('../../services/aiService');
const { updateGameState } = require('./stateUpdaters');
const { getMergedLocationData } = require('../worldStateHelpers');
// 【核心新增】引入新建的閉關管理器
const { handleCultivation } = require('./cultivationManager');

// 【核心新增】用於從玩家指令中解析閉關參數的輔助函式
function parseCultivationCommand(action) {
    const keywords = ['閉關', '靜修', '修練'];
    const timeUnits = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '月': 30, '年': 365 };
    const dayKeyword = '日';

    // 檢查是否包含閉關關鍵字
    if (!keywords.some(kw => action.includes(kw))) {
        return null;
    }

    let days = 0;
    let skillName = null;

    // 解析天數
    const dayMatch = action.match(new RegExp(`([一二三四五六七八九十]+)${dayKeyword}`));
    if (dayMatch) {
        days = timeUnits[dayMatch[1]] || 0;
    } else {
        // 如果沒有明確天數，但有「閉關」關鍵字，預設為一天
        if (action.includes('閉關')) {
            days = 1;
        }
    }
    
    // 如果沒有解析到天數，則不視為閉關指令
    if (days === 0) return null;

    // 解析修練的武學
    // 簡單的邏輯：取「修練」後面的詞
    const practiceMatch = action.match(/(?:修練|練習|鑽研)(.+)/);
    if (practiceMatch && practiceMatch[1]) {
        skillName = practiceMatch[1].trim();
        // 移除可能的結尾詞，如「心法」、「劍法」
        skillName = skillName.replace(/(心法|劍法|拳法|掌法|刀法|身法)$/, '');
    }

    return { isCultivation: true, days, skillName };
}


// 【核心修正】指令預處理函式 v2.0 - 帶有嚴格的本地設施搜尋邏輯
const preprocessPlayerAction = (playerAction, locationContext) => {
    // 通用設施關鍵字與其標準類型的對應表
    const facilityKeywords = {
        '鐵匠鋪': '鐵匠鋪', '打鐵鋪': '鐵匠鋪',
        '藥鋪': '藥鋪', '藥房': '藥鋪', '醫館': '藥鋪',
        '客棧': '客棧', '酒館': '客棧', '酒樓': '客棧',
        '雜貨鋪': '雜貨鋪',
        '村長家': '村長家',
    };

    for (const [keyword, type] of Object.entries(facilityKeywords)) {
        if (playerAction.includes(keyword)) {
            // 從傳入的、已經合併好的當前地點上下文中，搜尋設施列表
            const facilities = locationContext?.facilities || [];
            const targetFacility = facilities.find(f => f.type === type);

            if (targetFacility) {
                // 情況一：本地存在該設施。將指令修正為前往具體地點，AI無法再進行跨地圖的自由發揮。
                const newAction = `前往${targetFacility.name}`;
                console.log(`[指令預處理] 偵測到本地設施，已將 "${playerAction}" 修正為 "${newAction}"`);
                return newAction;
            } else {
                // 情況二：本地不存在該設施。將指令修正為觸發建築或探索邏輯，而不是讓AI去尋找其他城鎮的模板。
                const currentLocationName = locationContext?.locationName || '此地';
                const newAction = `我環顧四周，發現${currentLocationName}似乎沒有${type}。我心想，這或許是個機會，決定四處看看，尋找一個合適的地點來開設一間${type}。`;
                console.log(`[指令預處理] 地點「${currentLocationName}」無「${type}」，已將玩家行動修正為觸發建築邏輯。`);
                return newAction;
            }
        }
    }
    
    // 如果沒有匹配的關鍵字，返回原始指令
    return playerAction;
};

/**
 * 核心互動處理器
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} player - 玩家數據
 * @param {number} newRoundNumber - 新的回合數
 */
async function handleAction(req, res, player, newRoundNumber) {
    const { id: userId, username } = req.user;
    let { action: playerAction, model: playerModelChoice } = req.body;

    try {
        const context = await buildContext(userId, username);
        if (!context) {
            throw new Error("無法建立當前的遊戲狀態，請稍後再試。");
        }
        
        // --- 閉關指令攔截 ---
        const cultivationCommand = parseCultivationCommand(playerAction);
        if (cultivationCommand && cultivationCommand.isCultivation) {
            if (!cultivationCommand.skillName) {
                return res.status(400).json({ message: "指令錯誤：請明確指出要修練的武學名稱。例如：『閉關修練基礎劍法七日』。" });
            }
            const cultivationResult = await handleCultivation(userId, username, context.player, cultivationCommand.days, cultivationCommand.skillName);
            
            if (!cultivationResult.success) {
                // 如果條件不滿足，直接返回失敗訊息，不生成新回合
                return res.status(400).json({ message: cultivationResult.message });
            }
            
            // 條件滿足，使用閉關模組生成的數據來更新遊戲狀態
            const finalRoundData = await updateGameState(userId, username, player, playerAction, { roundData: cultivationResult.data }, newRoundNumber);
            const suggestion = await getAISuggestion(finalRoundData);
            finalRoundData.suggestion = suggestion;
            const finalLocationData = await getMergedLocationData(userId, finalRoundData.LOC);
            
            return res.json({
                story: finalRoundData.story,
                roundData: finalRoundData,
                suggestion: suggestion,
                locationData: finalLocationData
            });
        }
        // --- 閉關邏輯結束 ---
        
        playerAction = preprocessPlayerAction(playerAction, context.locationContext);
        
        const { longTermSummary, recentHistory, locationContext, npcContext, bulkScore, isNewGame } = context;
        
        if (isNewGame) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        if (player.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        let blackShadowEvent = null;
        if (Math.random() < 0.10) { 
            blackShadowEvent = { trigger: true };
            console.log(`[隨機系統] 觸發神秘黑影人事件！`);
        }

        const aiResponse = await getAIStory(
            playerModelChoice, 
            longTermSummary, 
            JSON.stringify(recentHistory), 
            playerAction, 
            player, 
            username, 
            player.timeOfDay, 
            player.power, 
            player.morality, 
            [], 
            null, 
            null, 
            locationContext, 
            npcContext, 
            bulkScore, 
            [],
            blackShadowEvent 
        );

        if (!aiResponse || !aiResponse.roundData) {
            throw new Error("主AI未能生成有效回應。");
        }
        
        const finalRoundData = await updateGameState(userId, username, player, playerAction, aiResponse, newRoundNumber);
        
        const suggestion = await getAISuggestion(finalRoundData);
        finalRoundData.suggestion = suggestion;
        
        const finalLocationData = await getMergedLocationData(userId, finalRoundData.LOC);

        res.json({
            story: finalRoundData.story,
            roundData: finalRoundData,
            suggestion: suggestion,
            locationData: finalLocationData
        });

    } catch (error) {
        console.error(`[核心互動模組] 處理玩家 ${username} 的行動時出錯:`, error);
        res.status(500).json({ message: error.message || "處理您的動作時發生了未知的伺服器錯誤。" });
    }
}

module.exports = { handleAction };
