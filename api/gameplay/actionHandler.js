// /api/gameplay/actionHandler.js
const { buildContext } = require('../contextBuilder');
const { getAIStory, getAISuggestion, getAIActionClassification, getAIAnachronismResponse } = require('../../services/aiService');
const { updateGameState } = require('./stateUpdaters');
const { getMergedLocationData } = require('../worldStateHelpers');
const { initiateCombat } = require('./combatManager'); 

const FORBIDDEN_ITEMS = [
    '倚天劍', '屠龍刀', '聖火令', '九陽神功', '九陰真經', '乾坤大挪移',
    '降龍十八掌', '六脈神劍', '北冥神功', '凌波微步', '手機', '電腦',
    'AK-47', '手槍', '火箭筒', '汽車', '摩托車'
];

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
        
        const { longTermSummary, recentHistory, locationContext, npcContext, bulkScore, isNewGame, player: playerContext } = context;

        const lastRoundData = recentHistory && recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] : {};

        // --- 「守門員」檢查機制 ---
        const detectedItem = FORBIDDEN_ITEMS.find(item => playerAction.includes(item));
        if (detectedItem) {
            console.log(`[守門員系統] 偵測到違規物品「${detectedItem}」，啟動化解程序...`);
            const story = await getAIAnachronismResponse(playerModelChoice, playerAction, detectedItem);
            
            const anachronismRoundData = {
                story: story,
                roundData: {
                    ...lastRoundData, 
                    R: newRoundNumber,
                    story: story,
                    PC: "你的思緒有些混亂，但很快又恢復了平靜。",
                    EVT: "一閃而過的幻想",
                    powerChange: { internal: 0, external: 0, lightness: 0 },
                    moralityChange: 0,
                    itemChanges: [],
                    skillChanges: [],
                    romanceChanges: [],
                }
            };
            const finalRoundData = await updateGameState(userId, username, player, playerAction, anachronismRoundData, newRoundNumber);
            const suggestion = await getAISuggestion(finalRoundData);

            return res.json({
                story: finalRoundData.story,
                roundData: finalRoundData,
                suggestion: suggestion,
                locationData: await getMergedLocationData(userId, finalRoundData.LOC)
            });
        }
        // --- 守門員機制結束 ---

        const classificationContext = {
            location: locationContext?.locationName,
            npcs: Object.keys(npcContext),
            skills: playerContext.skills.map(s => s.skillName)
        };
        const classification = await getAIActionClassification(playerModelChoice, playerAction, classificationContext);
        console.log(`[AI總導演 v4.0] 玩家行動「${playerAction}」被分類為: ${classification.actionType}`);
        
        switch (classification.actionType) {
            default:
                console.log(`[行動處理器] 行動類型 ${classification.actionType} 交由主故事AI生成。`);
                break;
        }

        playerAction = preprocessPlayerAction(playerAction, locationContext);
        
        if (isNewGame) {
            return res.status(404).json({ message: '找不到存檔紀錄。' });
        }
        if (player.isDeceased) {
            return res.status(403).json({ message: '逝者已矣，無法再有任何動作。' });
        }

        // --- 【核心修改】神秘黑影人事件開關 ---
        let blackShadowEvent = null;
        // 讀取指令牌，如果是 'true' 且滿足隨機條件，才觸發事件
        if (process.env.ENABLE_BLACK_SHADOW_EVENT === 'true' && Math.random() < 0.10) { 
            blackShadowEvent = { trigger: true };
            console.log(`[隨機系統] 神秘黑影人事件已啟用並觸發！`);
        }
        // --- 修改結束 ---

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
