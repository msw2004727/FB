// api/aiConfig.js

/**
 * AI模型中控設定檔
 * =================================================================
 * 此檔案為遊戲中所有AI任務的模型指派中心。
 * 你可以在這裡為每一個具體的AI任務（如生成故事、生成摘要、戰鬥裁決等），
 * 指定要使用的AI模型。
 *
 * 可用模型名稱:
 * - 'openai'   : GPT-4.1-mini，綜合能力最強，穩定，但成本較高。
 * - 'deepseek' : DeepSeek-Chat，創造力和遵循複雜指令的能力很強，文筆奇幻。
 * - 'grok'     : Grok-3-Fast，速度快，反應不按常理出牌，風格獨特。
 * - 'gemini'   : Gemini-1.5-Flash，目前服務不穩，暫不建議使用。
 *
 * 注意：所有來自玩家前端選擇的模型，會覆蓋此處的設定。
 * =================================================================
 */

const aiConfig = {
    // --- 核心故事與敘事 ---
    story: 'openai',          // 主線故事生成器
    narrative: 'openai',      // 將數據轉換為小說旁白
    prequel: 'openai',        // 前情提要生成器
    epilogue: 'deepseek',     // 角色結局（身後事）生成器
    deathCause: 'deepseek',   // 為自殺角色生成一個合理的死因

    // --- 遊戲邏輯與數據處理 ---
    summary: 'openai',        // 將回合數據總結為長期記憶
    actionClassifier: 'openai',// 玩家行動意圖分類器
    suggestion: 'deepseek',   // 書僮的行動建議
    
    // --- 戰鬥相關 ---
    combat: 'deepseek',       // 戰鬥過程裁決
    surrender: 'deepseek',    // 認輸情境裁決

    // --- NPC與互動 ---
    npcProfile: 'deepseek',   // 新NPC的詳細人設生成
    npcChat: 'openai',        // NPC密談時的回應
    npcChatSummary: 'openai', // 總結密談內容
    giveItem: 'openai',       // 贈予NPC物品時的反應
    giveNarrative: 'openai',  // 贈予事件的小說化描述
    proactiveChat: 'deepseek',// NPC主動發起對話的內容

    // --- 世界觀與生成 ---
    encyclopedia: 'deepseek', // 江湖百科生成
    relationGraph: 'deepseek',// 人物關係圖生成
    randomEvent: 'openai',    // 隨機事件生成
    bounty: 'deepseek',       // 懸賞任務生成
    itemTemplate: 'deepseek', // 新物品的設計圖生成
    location: 'deepseek',     // 新地點的檔案生成
    reward: 'openai',         // 領取懸賞時的獎勵生成
};

module.exports = { aiConfig };
