// api/aiConfig.js

/**
 * AI模型中控設定檔
 * =================================================================
 * 此檔案為遊戲中所有AI任務的模型指派中心。
 * 預設全部使用 MiniMax（伺服器端內建金鑰）。
 * 玩家可透過前端介面自行填寫其他 AI 服務的 API Key 來切換模型。
 *
 * 可用模型名稱:
 * - 'minimax'  : MiniMax-M2.7（預設，中文理解力強，性價比高）
 * - 'openai'   : GPT-5.4（需用戶自行提供 API Key）
 * - 'deepseek' : DeepSeek-V4（需用戶自行提供 API Key）
 * - 'grok'     : Grok-4.20（需用戶自行提供 API Key）
 * - 'gemini'   : Gemini 3.1 Pro（需用戶自行提供 API Key）
 * - 'gemma'    : Gemma 4 27B（需用戶自行提供 Google API Key）
 * - 'claude'   : Claude Opus 4.6（需用戶自行提供 API Key）
 *
 * 注意：玩家前端選擇的模型會覆蓋此處的設定。
 * =================================================================
 */

const aiConfig = {
    // --- 核心故事與敘事 ---
    story: 'minimax',
    narrative: 'minimax',
    prequel: 'minimax',
    epilogue: 'minimax',
    deathCause: 'minimax',

    // --- 遊戲邏輯與數據處理 ---
    summary: 'minimax',
    actionClassifier: 'minimax',
    suggestion: 'minimax',

    // --- 戰鬥相關 ---
    combat: 'minimax',
    combatSetup: 'minimax',
    surrender: 'minimax',
    postCombat: 'minimax',

    // --- NPC與互動 ---
    npcProfile: 'minimax',
    npcChat: 'minimax',
    npcChatSummary: 'minimax',
    npcMemory: 'minimax',
    giveItem: 'minimax',
    giveNarrative: 'minimax',
    proactiveChat: 'minimax',
    romanceEvent: 'minimax',

    // --- 世界觀與生成 ---
    encyclopedia: 'minimax',
    relationGraph: 'minimax',
    bounty: 'minimax',
    itemTemplate: 'minimax',
    location: 'minimax',
    reward: 'minimax',
};

module.exports = { aiConfig };
