// /api/gameplay/actionHandler.js
const { buildContext } = require('../contextBuilder');
const { getAIStory, getAISuggestion } = require('../../services/aiService');
const { updateGameState } = require('./stateUpdaters');
const { getMergedLocationData } = require('../worldStateHelpers');
// 【核心修改】移除閉關管理器的引用
// const { handleCultivation } = require('./cultivationManager'); 

// 【核心修改】移除舊的閉關指令判斷函式
/*
function isCultivationAttempt(action) {
    const keywords = ['閉關', '靜修', '修行', '修練', '練習'];
    return keywords.some(kw => action.includes(kw));
}
*/

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

async function handleAction(req, res, player, newRoundNumber) {
    const { id: userId, username } = req.user;
    let { action: playerAction, model: playerModelChoice } = req.body;

    try {
        const context = await buildContext(userId, username);
        if (!context) {
            throw new Error("無法建立當前的遊戲狀態，請稍後再試。");
        }
        
        // --- 【核心修改】舊的閉關指令攔截邏輯已完全移除 ---
        
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
