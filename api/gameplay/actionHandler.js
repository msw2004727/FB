// /api/gameplay/actionHandler.js
const { buildContext } = require('../contextBuilder');
const { getAIStory, getAISuggestion } = require('../../services/aiService');
const { updateGameState } = require('./stateUpdaters');
const { getMergedLocationData } = require('../worldStateHelpers');
// 【核心新增】引入新建的閉關管理器
const { handleCultivation } = require('./cultivationManager');

// 【核心修改】簡化解析邏輯，只專注於意圖和天數
function parseCultivationCommand(action) {
    const keywords = ['閉關', '靜修', '修行', '修練'];
    const timeUnits = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '月': 30, '年': 365 };
    const dayKeyword = '日';

    if (!keywords.some(kw => action.includes(kw))) {
        return null;
    }

    let days = 0;
    const dayMatch = action.match(new RegExp(`([一二三四五六七八九十]+)${dayKeyword}`));
    if (dayMatch && dayMatch[1] && timeUnits[dayMatch[1]]) {
        days = timeUnits[dayMatch[1]];
    } else {
        // 如果有閉關關鍵字但沒有天數，預設為1天
        days = 1;
    }

    // 嘗試解析武學名稱，但不強求。如果沒有，則回傳 null
    let skillName = null;
    const practiceMatch = action.match(/(?:修練|練習|鑽研)\s*「?([^」]+?)」?(?:心法|劍法|拳法|掌法|刀法|身法)?/);
    if (practiceMatch && practiceMatch[1]) {
        skillName = practiceMatch[1].trim();
    }

    return { isCultivation: true, days, skillName };
}


const preprocessPlayerAction = (playerAction, locationContext) => {
    const facilityKeywords = {
        '鐵匠鋪': '鐵匠鋪', '打鐵鋪': '鐵匠鋪',
        '藥鋪': '藥鋪', '藥房': '藥鋪', '醫館': '藥鋪',
        '客棧': '客棧', '酒館': '客棧', '酒樓': '客棧',
        '雜貨鋪': '雜貨鋪',
        '村長家': '村長家',
    };

    for (const [keyword, type] of Object.entries(facilityKeywords)) {
        if (playerAction.includes(keyword)) {
            const facilities = locationContext?.facilities || [];
            const targetFacility = facilities.find(f => f.type === type);

            if (targetFacility) {
                const newAction = `前往${targetFacility.name}`;
                console.log(`[指令預處理] 偵測到本地設施，已將 "${playerAction}" 修正為 "${newAction}"`);
                return newAction;
            } else {
                const currentLocationName = locationContext?.locationName || '此地';
                const newAction = `我環顧四周，發現${currentLocationName}似乎沒有${type}。我心想，這或許是個機會，決定四處看看，尋找一個合適的地點來開設一間${type}。`;
                console.log(`[指令預處理] 地點「${currentLocationName}」無「${type}」，已將玩家行動修正為觸發建築邏輯。`);
                return newAction;
            }
        }
    }
    
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
            // 【核心修改】將 skillName 傳遞給管理器，即使它是 null
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
