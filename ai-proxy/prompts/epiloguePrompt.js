// prompts/epiloguePrompt.js

const getEpiloguePrompt = (playerData) => {
    const username = playerData?.username || playerData?.player?.username || '無名';
    const gender = playerData?.gender || playerData?.player?.gender || playerData?.finalStats?.gender || 'male';
    const genderPronoun = gender === 'female' ? '她' : '他';
    const longTermSummary = playerData?.longTermSummary || playerData?.summary || '這位冒險者度過了短暫卻精彩的一段時光。';
    const morality = playerData?.player?.morality ?? playerData?.finalStats?.morality ?? 0;
    const deathCause = playerData?.deathInfo?.cause || '在冒險中走向了終點';
    const deathRound = playerData?.deathInfo?.round || '?';
    const lastLocation = playerData?.lastRoundData?.LOC || [];
    const locName = Array.isArray(lastLocation) ? lastLocation[lastLocation.length - 1] || '未知之地' : lastLocation || '未知之地';
    const scenario = playerData?.scenario || playerData?.player?.scenario || 'wuxia';

    let moralityDesc, worldTerm;
    if (scenario === 'school') {
        moralityDesc = morality > 30 ? '一位人人敬佩的模範生' : morality < -30 ? '一個令老師頭痛的問題學生' : '一個在校園中特立獨行的人';
        worldTerm = '這所學校';
    } else if (scenario === 'mecha') {
        moralityDesc = morality > 30 ? '一位與始核深度共鳴的駕駛員' : morality < -30 ? '一個冷靜到令人膽寒的戰術機器' : '一個在共感與理性之間搖擺的外來者';
        worldTerm = '這片天裂下的世界';
    } else if (scenario === 'hero') {
        moralityDesc = morality > 30 ? '一位被管理局信賴的正義守護者' : morality < -30 ? '一個讓體制膽寒的真相追尋者' : '一個在正義與真相之間遊走的諮商師';
        worldTerm = '這個英雄與反派共存的世界';
    } else {
        moralityDesc = morality > 30 ? '一位受人敬重的義士' : morality < -30 ? '一個令人忌憚的狠角色' : '一個立場曖昧的奇人';
        worldTerm = '這個世界';
    }

    return `你是一位幽默而富有洞察力的「世界歷史學家」。請為以下角色撰寫一篇500字的結局故事。

## 角色資料
* 姓名：${username}
* 性別：${gender === 'female' ? '女' : '男'}（稱${genderPronoun}）
* 評價：${moralityDesc}
* 死亡原因：${deathCause}
* 死亡地點：${locName}
* 存活回合數：${deathRound}

## 生平摘要
${longTermSummary}

## 寫作要求
1. 用繁體中文，幽默但帶點惋惜的筆調
2. 回顧${genderPronoun}在${worldTerm}的經歷（根據生平摘要）
3. 描述${genderPronoun}的離開如何影響了周遭的人
4. 結尾留一點懸念或溫暖
5. 控制在500字以內
6. 直接回傳純文字故事，不要 JSON 格式
7. 嚴禁簡體中文、英文
`;
};

module.exports = { getEpiloguePrompt };
