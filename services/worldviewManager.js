// services/worldviewManager.js

// --- 世界觀 Prompt 路徑註冊表 ---
// 在這裡定義所有可用的世界觀及其對應的 Prompt 檔案路徑。
// 這是未來擴充新世界觀時，唯一需要修改的地方。
const promptPaths = {
    wuxia: { // 金庸武俠 (預設)
        story: '../prompts/storyPrompt',
        summary: '../prompts/summaryPrompt',
        prequel: '../prompts/prequelPrompt',
        narrative: '../prompts/narrativePrompt',
        suggestion: '../prompts/suggestionPrompt',
    },
    gundam: { // 創世紀鋼彈 (機甲科幻)
        // 注意：這些檔案目前還不存在，我們下一步會創建它們
        story: '../prompts/storyPrompt_gundam',
        summary: '../prompts/summaryPrompt_gundam',
        prequel: '../prompts/prequelPrompt_gundam',
        narrative: '../prompts/narrativePrompt_gundam',
        suggestion: '../prompts/suggestionPrompt_gundam',
    }
    // --- 未來擴充範例 ---
    // cyberpunk: {
    //     story: '../prompts/storyPrompt_cyberpunk',
    //     summary: '../prompts/summaryPrompt_cyberpunk',
    //     ...etc
    // },
};

/**
 * 根據指定的世界觀名稱，載入對應的一整套 Prompt 生成函式。
 * @param {string} worldview - 世界觀的名稱 (例如 'wuxia', 'gundam')。
 * @returns {object} 包含所有 Prompt 生成函式的物件。
 */
const loadPrompts = (worldview = 'wuxia') => {
    // 如果傳入的 worldview 不存在於註冊表中，則安全退回(fallback)到預設的 'wuxia'
    const paths = promptPaths[worldview] || promptPaths.wuxia;

    try {
        // 動態載入指定路徑的模組
        const prompts = {
            getStoryPrompt: require(paths.story).getStoryPrompt,
            getSummaryPrompt: require(paths.summary).getSummaryPrompt,
            getPrequelPrompt: require(paths.prequel).getPrequelPrompt,
            getNarrativePrompt: require(paths.narrative).getNarrativePrompt,
            getSuggestionPrompt: require(paths.suggestion).getSuggestionPrompt,
        };
        // 為了方便除錯，顯示當前載入的世界觀
        console.log(`[WorldviewManager] 已成功載入 '${worldview}' 世界觀的 Prompt。`);
        return prompts;
    } catch (error) {
        // 如果在 require 過程中發生錯誤 (例如檔案不存在)，則輸出錯誤日誌並退回預設世界觀
        console.error(`[WorldviewManager] 載入世界觀 '${worldview}' 的 Prompts 時發生錯誤。將使用預設的 'wuxia'。錯誤訊息: ${error.message}`);
        
        const defaultPaths = promptPaths.wuxia;
        return {
            getStoryPrompt: require(defaultPaths.story).getStoryPrompt,
            getSummaryPrompt: require(defaultPaths.summary).getSummaryPrompt,
            getPrequelPrompt: require(defaultPaths.prequel).getPrequelPrompt,
            getNarrativePrompt: require(defaultPaths.narrative).getNarrativePrompt,
            getSuggestionPrompt: require(defaultPaths.suggestion).getSuggestionPrompt,
        };
    }
};

// 對外只導出這個總管理函式
module.exports = {
    loadPrompts
};
