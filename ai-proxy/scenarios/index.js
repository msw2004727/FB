// ai-proxy/scenarios/index.js
// 劇本配置中心 — 根據 scenario ID 載入對應配置

const wuxia = require('./wuxia');
const school = require('./school');

const SCENARIOS = { wuxia, school };

function getScenario(scenarioId) {
    return SCENARIOS[scenarioId] || SCENARIOS.wuxia;
}

function getScenarioList() {
    return Object.values(SCENARIOS).map(s => ({ id: s.id, name: s.name }));
}

module.exports = { getScenario, getScenarioList, SCENARIOS };
