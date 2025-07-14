// /api/services/backgroundTaskProcessor.js

const admin = require('firebase-admin');
const { updateGameState } = require('../gameplay/stateUpdaters');
const { getMergedLocationData } = require('../worldStateHelpers');

const db = admin.firestore();

// 使用一個簡單的物件作為任務隊列的內存存儲
const taskQueue = {};

/**
 * 提交一個新的數據更新任務到隊列中
 * @param {string} taskId - 一個唯一標識符，通常是 userId + roundNumber
 * @param {object} jobData - 包含執行任務所需的所有數據
 */
function submitTask(taskId, jobData) {
    console.log(`[後台處理器] 收到新任務，ID: ${taskId}`);
    taskQueue[taskId] = {
        status: 'pending',
        data: null,
        error: null,
        jobData: jobData
    };
    // 立即在背景開始執行任務，但不阻塞主流程
    processTask(taskId);
}

/**
 * 實際執行數據更新的函式
 * @param {string} taskId - 任務ID
 */
async function processTask(taskId) {
    const task = taskQueue[taskId];
    if (!task) return;

    const { userId, username, player, playerAction, aiResponse, newRoundNumber } = task.jobData;

    try {
        console.log(`[後台處理器] 開始執行任務: ${taskId}`);
        // 核心邏輯：呼叫原有的 updateGameState 函式來執行所有資料庫操作
        const finalRoundData = await updateGameState(userId, username, player, playerAction, aiResponse, newRoundNumber);
        
        // 獲取最終的地點數據
        const finalLocationData = await getMergedLocationData(userId, finalRoundData.LOC);

        // 將最終的、完整的、準備好給前端的數據存儲起來
        task.data = {
            roundData: finalRoundData,
            locationData: finalLocationData
        };
        task.status = 'completed';
        console.log(`[後台處理器] 任務 ${taskId} 執行成功並已完成。`);

    } catch (error) {
        console.error(`[後台處理器] 處理任務 ${taskId} 時發生嚴重錯誤:`, error);
        task.status = 'error';
        task.error = error.message || '發生未知的背景處理錯誤。';
    }
}

/**
 * 查詢任務的當前狀態
 * @param {string} taskId - 任務ID
 * @returns {object} 包含任務狀態和結果的物件
 */
function getTaskStatus(taskId) {
    const task = taskQueue[taskId];
    if (!task) {
        return { status: 'not_found' };
    }
    
    // 如果任務已完成，回傳結果並從隊列中刪除，防止內存洩漏
    if (task.status === 'completed' || task.status === 'error') {
        delete taskQueue[taskId];
    }

    return {
        status: task.status,
        data: task.data,
        error: task.error
    };
}

module.exports = {
    submitTask,
    getTaskStatus
};
