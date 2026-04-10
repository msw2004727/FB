// client/engine/gameEngine.js
// 遊戲引擎 — 精簡版（僅保留使用中的功能）

import clientDB from '../db/clientDB.js';
import aiProxy from '../ai/aiProxy.js';
import { buildContext, buildLightContext } from './contextBuilder.js';
import { applyAllChanges } from './stateManager.js';
import { clamp, toFiniteNumber } from '../utils/gameUtils.js';

// ── 當前活躍檔案 ────────────────────────────────────

let _activeProfileId = null;

export function setActiveProfile(profileId) { _activeProfileId = profileId; }
export function getActiveProfileId() { return _activeProfileId; }

// ── 遊戲初始化 ──────────────────────────────────────

export async function createNewGame(username, gender) {
    await clientDB.init();
    const profile = await clientDB.profiles.create({ username, gender });
    const profileId = profile.id;

    const initialRound = {
        R: 0,
        EVT: '莫名其妙的穿越',
        story: `你睜開眼睛。\n\n頭頂是一片刺眼的藍天，身下是一堆扎人的乾草。空氣裡飄著一股你完全無法辨認的味道——像是有人把中藥房和燒烤攤強行混在一起。\n\n你猛地坐起來，四周是一條塵土飛揚的泥巴路，兩旁是低矮的土牆和掛著褪色布簾的店鋪。遠處傳來雞鳴狗吠，還有一個大嬸扯著嗓子罵誰家的孩子偷了她晾的蘿蔔乾。\n\n這絕對不是你的房間。\n\n你低頭一看——身上穿著一件灰撲撲的粗布衣裳，腳上是一雙草鞋，左邊那隻還破了個洞。你完全不記得自己是怎麼到這裡的，腦子裡一片空白，像是被人用橡皮擦狠狠擦過一遍。\n\n然後你發現右手緊緊攥著一張皺巴巴的紙條。你展開一看，上面用歪歪扭扭的毛筆字寫著：\n\n「任務：尋找回家的方法。」\n\n紙條背面還有一行小字：「附註：別死了，死了就真回不去了。」\n\n你盯著這張紙條看了三秒鐘，然後抬頭環顧四周。一個挑著扁擔的老大爺正好路過，用一種看傻子的眼神瞟了你一眼。\n\n好吧。看來你得先搞清楚這是哪裡，然後——想辦法活著回家。`,
        WRD: '大晴天，熱得要命',
        LOC: ['梁國', '東境', '臨川', '無名村'],
        PC: `${username}剛穿越，一臉懵，手握紙條。`,
        NPC: [],
        timeOfDay: '上午',
        morality: 0,
        yearName: '元祐', year: 1, month: 1, day: 1,
        playerState: 'alive',
        moralityChange: 0,
        suggestion: '你站在一條陌生的村莊小路上，手裡捏著一張寫著「尋找回家方法」的紙條。四周的一切都很古代，你需要先搞清楚狀況。'
    };

    await clientDB.saves.add(profileId, initialRound);
    setActiveProfile(profileId);
    return { profile, roundData: initialRound };
}

// ── 遊戲載入 ────────────────────────────────────────

export async function getLatestGame() {
    const profileId = getActiveProfileId();
    const profile = await clientDB.profiles.get(profileId);

    if (profile.isDeceased) {
        const lastSave = await clientDB.saves.getLatest(profileId);
        return { gameState: 'deceased', roundData: lastSave, locationData: null };
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    if (!lastSave) throw new Error('找不到存檔資料。');

    const roundData = {
        ...lastSave,
        morality: profile.morality,
        suggestion: lastSave.suggestion || '先觀察場面，再採取行動。'
    };

    let locationData = null;
    if (lastSave.LOC) {
        const locName = Array.isArray(lastSave.LOC) ? lastSave.LOC[lastSave.LOC.length - 1] : lastSave.LOC;
        locationData = await clientDB.locations.getTemplate(locName) || null;
    }

    return {
        gameState: 'alive',
        story: lastSave.story,
        roundData,
        suggestion: roundData.suggestion,
        locationData
    };
}

// ── 玩家行動 ────────────────────────────────────────

export async function interact({ action, model }) {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);

    const aiResult = await aiProxy.generate('story', model, {
        ...context,
        playerAction: action,
        actorCandidates: [],
        blackShadowEvent: Math.random() < 0.1
    });

    if (!aiResult || !aiResult.roundData) {
        throw new Error('AI 回應缺少 roundData');
    }

    const roundData = aiResult.roundData;
    roundData.R = (context.player.R || 0) + 1;
    roundData.story = aiResult.story || roundData.story;

    const result = await applyAllChanges(profileId, roundData);

    return {
        story: roundData.story,
        roundData: {
            ...roundData,
            ...result.profile
        },
        suggestion: aiResult.suggestion || roundData.suggestion || '繼續探索。',
        locationData: context.locationContext
    };
}

// ── 自殺 ────────────────────────────────────────────

export async function forceSuicide({ model }) {
    const profileId = getActiveProfileId();
    const context = await buildLightContext(profileId);

    let story;
    try {
        const aiResult = await aiProxy.generate('death-cause', model, context);
        story = typeof aiResult === 'string' ? aiResult : aiResult?.story || '你在混亂與寂靜之間做出了終局的選擇，江湖傳奇在此刻落幕。';
    } catch {
        story = '你在混亂與寂靜之間做出了終局的選擇，江湖傳奇在此刻落幕。';
    }

    const lastSave = await clientDB.saves.getLatest(profileId);
    const roundData = {
        ...(lastSave || {}),
        R: (lastSave?.R || 0) + 1,
        EVT: '英雄末路',
        story,
        playerState: 'dead',
        moralityChange: 0
    };

    await applyAllChanges(profileId, roundData);
    return { story, roundData, suggestion: '重新開始一段新的江湖人生。' };
}

// ── 結局 ────────────────────────────────────────────

export async function getEpilogue() {
    const profileId = getActiveProfileId();
    const context = await buildContext(profileId);
    const lastSave = await clientDB.saves.getLatest(profileId);

    const aiResult = await aiProxy.generate('epilogue', null, {
        ...context,
        playerData: {
            username: context.player.username,
            gender: context.player.gender,
            finalStats: context.player,
            deathInfo: { cause: lastSave?.EVT || '不明', round: lastSave?.R }
        },
        lastRoundData: lastSave
    });
    return { epilogue: typeof aiResult === 'string' ? aiResult : aiResult?.epilogue || '傳奇落幕。' };
}

// ── 重新開始 ────────────────────────────────────────

export async function startNewGame() {
    const profileId = getActiveProfileId();
    await clientDB.resetProfile(profileId);
    const profile = await clientDB.profiles.get(profileId);
    return createNewGame(profile.username, profile.gender);
}
