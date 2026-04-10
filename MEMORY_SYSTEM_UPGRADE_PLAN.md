# 記憶系統緊急修復 + 升級計畫書

> 版本: v1.0 | 日期: 2026-04-11
> 狀態: 專家審計發現兩個致命斷裂，需優先修復

---

## 一、審計發現（三位專家一致確認）

### 🔴 致命問題 1：longTermSummary 從未被寫入

**現象**: `contextBuilder.js:15` 讀取 `clientDB.state.get(profileId, 'summary')`，但**整個客戶端程式碼中沒有任何地方呼叫 `clientDB.state.set(profileId, 'summary', ...)`**。

**根因**: Firebase → IndexedDB 遷移時，Firestore 的摘要寫入邏輯（在 `_archive/api/gameplay/stateUpdaters.js:79`）未被移植到新架構。

**結果**: 每局遊戲，AI 收到的長期摘要永遠是 `'遊戲剛剛開始...'`。100 回合的遊戲和第 1 回合的遊戲擁有相同的長期記憶。

**影響**: 11 個 prompt 檔案（story、encyclopedia、chatSummary、relationGraph 等）全部收到錯誤的摘要。

---

### 🔴 致命問題 2：recentHistory 輸出亂碼

**現象**: `storyPrompt.js:119` 使用 `${recentHistory}` 在模板字串中插入，但 `recentHistory` 是 JavaScript 物件陣列。

**根因**: JavaScript 模板字串對陣列呼叫 `.toString()`，物件陣列會產生 `[object Object],[object Object],[object Object]`。

**結果**: AI 收到的「最近事件」是無意義的亂碼字串。

**影響**: 故事 AI 無法知道最近 3 回合發生了什麼。

---

### 🟡 中等問題：IndexedDB 容量管理

**現象**: `game_saves` 和 `novel_chapters` 每回合累積，永不清理。

**實際風險比預期低**: ~4.3 KB/回合，100 回合 ≈ 430 KB，Chrome/Firefox 下不成問題。

**真正風險**: Safari/iOS 可能在用戶 7 天不訪問後清除所有 IndexedDB 資料。且未呼叫 `navigator.storage.persist()` 請求持久化。

---

## 二、三項升級方案

### 升級 A：修復 + 結構化 longTermSummary

#### A1. 緊急修復：接回摘要寫入管線

在 `gameEngine.js` 的 `interact()` 中，`applyAllChanges()` 之後加入 fire-and-forget 摘要更新：

```javascript
// gameEngine.js — interact() 函式內，applyAllChanges() 之後
(async () => {
    try {
        const oldSummary = await clientDB.state.get(profileId, 'summary');
        const oldText = typeof oldSummary === 'string' ? oldSummary : (oldSummary?.text || '遊戲剛剛開始...');
        const result = await aiProxy.generate('summary', null, {
            oldSummary: oldText,
            newRoundData: roundData
        });
        const newSummary = (result && typeof result === 'object') ? result.summary : result;
        if (newSummary) {
            await clientDB.state.set(profileId, 'summary', newSummary);
        }
    } catch (e) {
        console.warn('[Summary] 摘要更新失敗（非阻塞）:', e.message);
    }
})();
```

**延遲影響**: +0 秒（fire-and-forget，不阻塞玩家）
**成本影響**: 每回合多 1 次 AI 呼叫（MiniMax，~500 input + ~500 output tokens ≈ ¥0.003）

#### A2. 結構化 JSON 摘要（取代自由文字）

改造 `summaryPrompt.js`，讓 AI 輸出結構化 JSON：

```json
{
  "narrative": "（200字內的整體故事摘要）",
  "npcs": {
    "王大夫": {
      "personality": "仁厚",
      "location": "無名村藥鋪",
      "relation": "friendly",
      "keyEvents": ["R3 為主角治傷", "R12 請託尋找草藥"]
    }
  },
  "items": [
    {"name": "虎頭令牌", "qty": 1, "source": "R10 山賊屍體"}
  ],
  "skills": [
    {"name": "基礎劍法", "level": "初成", "source": "R5 閱讀秘笈"}
  ],
  "quests": {
    "active": [{"name": "調查後山異響", "since": "R7"}],
    "completed": ["尋找草藥(R14)"]
  },
  "world": ["青龍會掌控漕運", "梁國與西域通商"]
}
```

#### A3. Token 預算控制

| 區段 | 上限 | 策略 |
|------|------|------|
| narrative | 300 tokens | AI 每次重寫，限 200 字 |
| npcs | 600 tokens | 上限 8 個 NPC，低分的壓縮為 1 行 |
| items | 150 tokens | 上限 10 個 |
| skills | 100 tokens | 上限 8 個 |
| quests | 200 tokens | active 上限 5，completed 只保留最近 5 |
| world | 150 tokens | 上限 8 條 |
| **總計** | **~1,500 tokens** | **固定上限，永不膨脹** |

#### A4. 兩階段管線（避免 AI 幻覺）

**Stage A（AI 呼叫）**: 從 newRoundData 提取本回合的變化（新 NPC、物品變動、事件）
**Stage B（確定性程式碼）**: 用 JavaScript 合併到 oldSummary，執行預算控制

好處：合併邏輯不依賴 AI，不會產生幻覺，token 預算由程式碼強制執行。

---

### 升級 B：修復 recentHistory + 精簡格式

#### B1. 緊急修復：序列化

在 `storyPrompt.js` 修改：

```javascript
// 原本（產生 [object Object] 亂碼）
${recentHistory}

// 修復後（格式化為精簡文字）
${formatRecentHistory(recentHistory)}
```

格式化函式：
```javascript
function formatRecentHistory(saves) {
    if (!saves || !Array.isArray(saves) || saves.length === 0) return '（無近期記錄）';
    return saves.map(s => {
        const loc = Array.isArray(s.LOC) ? s.LOC.join('/') : (s.LOC || '');
        const npcs = (s.NPC || []).map(n => `${n.name}(${n.friendliness})`).join(', ');
        const time = s.timeOfDay || '';
        return `【R${s.R} ${time} ${loc}】${s.EVT || ''} | ${s.PC || ''} | NPC: ${npcs || '無'}`;
    }).join('\n');
}
```

每回合精簡為 ~50-60 tokens（取代原本 ~450 tokens 的完整 JSON）。

#### B2. 擴大到 5 回合 + 動態調整

```javascript
// contextBuilder.js
function getRecentSaveCount(currentRound) {
    if (currentRound <= 5) return currentRound;   // 前期：全部顯示
    if (currentRound <= 20) return 5;              // 中期：5 回合
    return 3;                                       // 後期：3 回合（靠摘要+MemPalace）
}

const count = getRecentSaveCount(playerContext.R);
const recentSaves = await clientDB.saves.getRecent(profileId, count);
```

#### B3. Token 影響

| 方案 | 每回合 tokens | 5 回合總計 |
|------|-------------|-----------|
| 目前（亂碼） | ~10（垃圾） | ~50（無效） |
| 完整 JSON | ~450 | ~2,250（太重） |
| **精簡格式** | **~55** | **~275（最佳）** |

---

### 升級 C：IndexedDB 容量管理

#### C1. 自動清理策略

| Store | 保留策略 | 觸發時機 |
|-------|---------|---------|
| `game_saves` | 最近 10 筆 + 每 10 回合 1 筆檢查點 | 每 10 回合 |
| `novel_chapters` | 最近 20 筆 | 每 10 回合 |
| `clues_summary` | 截斷至最新 2000 字元 | 超過 3000 字時 |

#### C2. 持久化儲存請求

```javascript
// 應用程式啟動時
if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist();
    // granted = true: 瀏覽器不會自動清除 IndexedDB
}
```

#### C3. 新建 `storageManager.js`

```
client/db/storageManager.js
├── pruneGameSaves(profileId)      — 清理舊存檔
├── pruneNovelChapters(profileId)  — 清理舊章節
├── trimCluesSummary(profileId)    — 截斷線索摘要
├── runCleanup(profileId, round)   — 主清理（每 10 回合）
└── initStorageManager(profileId)  — 初始化（請求持久化）
```

整合在 `stateManager.applyAllChanges()` 結尾呼叫 `runCleanup()`。

---

## 三、實施順序

```
Phase 0（緊急修復 — 立即）
  ├── 0a. 修復 recentHistory 序列化（[object Object] → 精簡文字）
  └── 0b. 接回 longTermSummary 寫入管線
  → 這兩個是致命 bug，修完遊戲品質會立即大幅提升

Phase 1（結構化升級）
  ├── 1a. summaryPrompt.js 改為結構化 JSON 輸出
  ├── 1b. 新建 summaryMerger.js（確定性合併 + 預算控制）
  └── 1c. recentHistory 動態回合數 + 精簡格式
  → 預算控制確保 100 回合不膨脹

Phase 2（容量管理）
  ├── 2a. 新建 storageManager.js
  ├── 2b. navigator.storage.persist() 請求
  └── 2c. 整合到 stateManager
  → Safari/iOS 保護 + 長期容量安全
```

---

## 四、預期效果

| 指標 | 修復前 | 修復後 |
|------|--------|--------|
| longTermSummary | `'遊戲剛剛開始...'`（永遠） | 結構化 JSON，~1,500 tokens，每回合更新 |
| recentHistory | `[object Object]`（亂碼） | 精簡文字，~275 tokens，動態 3-5 回合 |
| AI 有效記憶來源 | **僅 MemPalace**（800 tokens） | **摘要 + 近期 + MemPalace**（~2,575 tokens） |
| 100 回合摘要大小 | N/A（不存在） | 固定 ~1,500 tokens（預算控制） |
| IndexedDB 安全 | 無清理、無持久化 | 自動清理 + 持久化請求 |
| 每回合額外成本 | +0 | +¥0.003（摘要 AI 呼叫） |
| 每回合額外延遲 | +0 | +0 秒（fire-and-forget） |

---

## 五、改動檔案清單

| 檔案 | 改動 | Phase |
|------|------|-------|
| `ai-proxy/prompts/storyPrompt.js` | 修復 recentHistory 序列化 + 格式化函式 | 0a |
| `client/engine/gameEngine.js` | 接回摘要寫入管線 | 0b |
| `client/engine/contextBuilder.js` | 動態回合數、摘要 JSON 解析 | 1c |
| `ai-proxy/prompts/summaryPrompt.js` | 改為結構化 JSON 提取 prompt | 1a |
| **新建** `client/engine/summaryMerger.js` | 確定性合併 + 預算控制 | 1b |
| **新建** `client/db/storageManager.js` | 自動清理 + 持久化 | 2a |
| `client/engine/stateManager.js` | 整合 runCleanup | 2c |

---

## 六、參考資料

- AI Dungeon: embedding pool + 自動摘要（不用向量 DB）
- NovelAI: 手動 Lorebook + 關鍵字觸發（不用向量 DB）
- Stanford Generative Agents: in-memory 列表 + embedding 比對 + 三因子加權
- 業界共識：結構化摘要 + 關鍵字匹配 > 純向量搜索（對敘事遊戲）
