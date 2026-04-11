// prompts/progressEvaluatorPrompt.js
// 獨立的主線進度評估 prompt — 不汙染 storyPrompt

/**
 * 8 個核心線索里程碑
 * 每個里程碑有 ID、名稱、描述、觸發條件
 */
const MILESTONES = [
    {
        id: 'M1_WORLD_AWARENESS',
        name: '異世界認知',
        description: '主角確認自己穿越到了另一個世界，開始接受現實',
        trigger: '故事中主角明確意識到自己不屬於這個世界，或有人指出他的言行舉止與常人不同'
    },
    {
        id: 'M2_FIRST_CLUE',
        name: '第一條線索',
        description: '發現與穿越現象相關的第一個具體線索',
        trigger: '故事中出現古怪符文、神秘遺跡、異常天象、或有人提到類似的穿越傳說'
    },
    {
        id: 'M3_KEY_NPC',
        name: '關鍵人物',
        description: '遇到一個知道穿越秘密（或部分秘密）的重要角色',
        trigger: '故事中出現一個NPC明確表示知道主角的來歷、或擁有與穿越相關的知識'
    },
    {
        id: 'M4_ANCIENT_KNOWLEDGE',
        name: '古老知識',
        description: '獲得關於穿越機制的古老文獻或口述知識',
        trigger: '故事中主角獲得了古書、卷軸、壁畫、或聽到了關於「時空裂縫」「陣法」「回歸之路」的具體描述'
    },
    {
        id: 'M5_OBSTACLE',
        name: '重大阻礙',
        description: '發現回家的條件極其苛刻，遇到看似不可能克服的障礙',
        trigger: '故事明確描述了回家需要的具體條件（某個物品、某個地點、某個時機），但目前無法達成'
    },
    {
        id: 'M6_BREAKTHROUGH',
        name: '關鍵突破',
        description: '克服了重大障礙，或找到了繞過障礙的方法',
        trigger: '故事中主角成功獲得了回家所需的關鍵要素之一，或發現了新的可行路徑'
    },
    {
        id: 'M7_FINAL_PREPARATION',
        name: '最終準備',
        description: '萬事俱備，只差最後一步',
        trigger: '故事中主角已集齊所有條件，正在進行回家前的最後準備或做出最終抉擇'
    },
    {
        id: 'M8_HOMECOMING',
        name: '歸途',
        description: '啟動回家的儀式/方法，面對最終挑戰',
        trigger: '故事中主角正在實際執行回家的行動（啟動陣法、穿越裂縫等）'
    }
];

/**
 * 生成進度評估 prompt
 * @param {string} story - 本回合的完整故事
 * @param {Array<string>} achievedMilestones - 已達成的里程碑 ID 列表
 * @param {string} cluesSummary - 之前收集的線索摘要
 * @returns {string} prompt
 */
function getProgressEvaluatorPrompt(story, achievedMilestones = [], cluesSummary = '', scenario = 'wuxia') {
    const { getScenario } = require('../scenarios/index.js');
    const scenarioConfig = getScenario(scenario);
    const milestones = scenarioConfig.MILESTONES;
    const remaining = milestones.filter(m => !achievedMilestones.includes(m.id));
    const nextMilestone = remaining[0];

    if (!nextMilestone) {
        return null; // 所有里程碑已達成
    }

    const remainingList = remaining.map(m => `- ${m.id}: ${m.name} — ${m.trigger}`).join('\n');

    return `你是一位嚴格的進度評估員。請分析以下故事內容，判斷是否觸發了任何里程碑。

## 規則
1. 你只能從「尚未達成的里程碑」中選擇
2. 里程碑必須按順序觸發（必須先觸發前一個才能觸發下一個）
3. 因此你只需要判斷「下一個里程碑」是否被觸發
4. 判斷標準必須嚴格 — 故事中必須有明確的描述符合觸發條件，不能靠推測
5. 回覆必須是純 JSON
6. 【語言鐵律】所有文字欄位（reason、questJournal）必須使用「繁體中文」，嚴禁簡體中文

## 下一個待觸發的里程碑
ID: ${nextMilestone.id}
名稱: ${nextMilestone.name}
觸發條件: ${nextMilestone.trigger}

## 已收集的線索
${cluesSummary || '（尚無）'}

## 本回合故事
${story}

## 回覆格式（純 JSON）
{
  "triggered": true 或 false,
  "reason": "簡短說明為什麼觸發/未觸發（20字以內）",
  "questJournal": "用一句話描述玩家目前的主線感知狀態（30字以內）"
}`;
}

module.exports = { getProgressEvaluatorPrompt, MILESTONES };
