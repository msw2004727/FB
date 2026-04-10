# AI 文江 — PWA 本機化遷移計劃書

> **版本**: v1.0  
> **日期**: 2026-04-10  
> **目標**: 將遊戲從 Firebase 雲端架構遷移至 PWA 本機化架構，消除資料庫費用  

---

## 一、專家會議紀錄

### 與會專家角色

| 代號 | 專業領域 | 關注重點 |
|------|----------|----------|
| FE | 前端架構 | 模組遷移、IndexedDB 設計、UI 相容性 |
| BE | 後端/API | 遊戲邏輯拆分、AI Proxy 設計 |
| DB | 資料庫 | 資料模型轉換、完整性、儲存上限 |
| SEC | 資安 | API Key 保護、防作弊、XSS |
| MOB | 行動端/PWA | 跨平台相容、離線能力、安裝體驗 |
| GD | 遊戲設計 | 存檔完整性、遊戲體驗、狀態一致性 |

---

### 會議討論摘要

#### FE（前端架構）：

> 現有 `localPreviewMockApi.js`（777 行）已經實現了約 60% 的客戶端狀態管理，
> 包含完整的遊戲迴圈、修煉、物品管理、存檔載入。這是一個很好的起點，
> 但缺少**戰鬥系統、NPC 交易/聊天、贈物、乞丐系統、百科、小說、結局**等。
> 
> 前端目前有 24 個 JS 模組、36 個 API 端點呼叫。核心 `api.js` 已有 mock 分流機制，
> 遷移時只需將 mock 路徑升級為正式路徑，不需要改動 UI 層呼叫方式。
> 
> **風險**: `scripts/api.js` 中 `backendBaseUrl` 硬編碼為 Render 線上位址，需改為可切換。

#### BE（後端/API）：

> 經分析全部後端邏輯，分類結果如下：
> - **純邏輯（可直接搬前端）**: ~50 個函式（體力計算、日期推進、負重計算、戰鬥標籤推斷等）
> - **資料庫依賴**: ~35 個函式 → 改為讀寫 IndexedDB
> - **AI 依賴**: ~20 個函式 → 透過 AI Proxy 呼叫
> - **混合型**: ~25 個函式 → 需拆分純邏輯與 I/O
> 
> 最關鍵的是 `contextBuilder.js`，它在每次 AI 呼叫前組裝完整遊戲上下文
> （玩家資料、最近 3 回合、技能、物品、地點、NPC 檔案）。
> 遷移後，這個組裝工作要在客戶端完成，再送到 AI Proxy。
> 
> **風險**: `updateGameState()` 是個巨型協調函式（處理物品/NPC/地點/經濟/聲望），
> 搬到前端後需要仔細拆分，否則容易產生狀態不一致。

#### DB（資料庫）：

> 現有 15 個 Firestore 集合，379+ 次操作。改用 IndexedDB 後：
> - 優勢：零成本、低延遲、無讀寫次數限制
> - IndexedDB 儲存上限：Chrome/Edge 約為硬碟 60%（通常 > 1GB），Safari 約 1GB
> - 對本遊戲來說綽綽有餘（一個完整存檔估計 5-20MB）
> 
> **但有三個必須解決的問題：**
> 1. 清除瀏覽器資料 = 存檔消失（必須有匯出/匯入機制）
> 2. 無跨裝置同步（需要手動搬存檔）
> 3. 無伺服器端備份（玩家自負責任）
> 
> **風險**: Firestore 的 `runTransaction()` 和 `batch()` 在 IndexedDB 中需要用
> `IDBTransaction` 模擬，語法差異大，是遷移最繁瑣的部分。

#### SEC（資安）：

> **最大風險是 API Key 暴露。** 如果前端直接呼叫 OpenAI/Gemini API，
> Key 會出現在瀏覽器 DevTools 的 Network 標籤中，任何人都能偷走並盜用。
> 
> **必須保留一個輕量 AI Proxy 伺服器**，前端只跟 Proxy 溝通，
> Proxy 持有所有 API Key，轉發請求到各 AI 供應商。
> 
> 其他安全考量：
> - 客戶端遊戲邏輯可被篡改（修改功力、物品等） → 單人遊戲可接受
> - Prompt 模板暴露在前端 → 可接受（不含敏感資料）
> - JWT 認證在純本機化後可簡化或移除 → 改為本機身份管理
> 
> **風險**: AI Proxy 如果不做速率限制，可能被惡意使用者濫用你的 API 額度。

#### MOB（行動端/PWA）：

> PWA 在主流手機瀏覽器的支援度：
> - Chrome Android: 完整支援（安裝、離線、通知）
> - Safari iOS: 支援安裝到桌面、IndexedDB、Service Worker
>   - **但** iOS Safari 有已知問題：長時間未使用可能清除 IndexedDB 資料
> - Firefox: 支援但不支援安裝提示
> 
> **iOS Safari 的 IndexedDB 清除政策是最大風險。**
> Apple 會在 7 天未使用後標記為可清除（實際清除時機不確定）。
> → 必須在 UI 中強烈提醒玩家定期匯出存檔。
> 
> PWA 所需元件：
> 1. `manifest.json`（應用名稱、圖示、主題色、啟動 URL）
> 2. Service Worker（快取靜態資源、離線回退頁面）
> 3. HTTPS（PWA 安裝的硬性要求）

#### GD（遊戲設計）：

> 遊戲體驗層面的考量：
> 1. **存檔系統**: 改為本機後，可以支援多存檔槽位（Firestore 時期只有一個）
> 2. **遊戲速度**: IndexedDB 讀寫比 Firestore 快 10-100 倍，體感會明顯提升
> 3. **離線體驗**: 沒有 AI 就無法推進劇情，但可以瀏覽存檔、物品、關係圖、地圖
> 4. **新手體驗**: 不需要註冊帳號了，打開就能玩，大幅降低門檻
> 
> **建議**: 把 `localPreviewMockApi.js` 中的 mock 故事機制保留為「離線模式」，
> 讓玩家在無網路時也能用簡易關鍵字匹配繼續玩（體驗降級但不中斷）。
> 
> **風險**: 現有玩家的 Firestore 存檔無法自動遷移到本機，
> 需要提供一次性的「雲端存檔匯出」工具。

---

### 專家共識

經討論後，六位專家達成以下共識：

1. **遷移方向正確** — 單人遊戲 + 雲端資料庫是架構不匹配，本機化是正解
2. **AI Proxy 不可省略** — 安全性的底線，必須有伺服器保護 API Key
3. **iOS Safari 風險可控** — 透過匯出功能 + UI 提醒解決
4. **分階段執行** — 不要一次全改，按優先級逐步遷移
5. **保留降級模式** — 離線時仍可瀏覽已有內容
6. **現有 mock 系統是加速器** — 直接在其基礎上擴建

---

## 二、現狀盤點

### 2.1 現有技術棧

| 元件 | 現況 | 遷移後 |
|------|------|--------|
| 後端框架 | Express.js（50+ 路由） | 輕量 AI Proxy（~5 路由） |
| 資料庫 | Firebase Firestore（15 集合、379+ 操作） | IndexedDB（瀏覽器本機） |
| 認證 | JWT + bcryptjs | 本機身份（無需密碼） |
| AI 服務 | 5 供應商（OpenAI/Gemini/Claude/DeepSeek/Grok） | 不變，透過 Proxy 轉發 |
| 前端 | ES6 模組 + Tailwind | 不變 + PWA 外殼 |
| 圖像生成 | DALL-E 3 → Firebase Storage | DALL-E 3 → Base64/本機快取 |
| 部署 | Render（後端）| Vercel/Cloudflare（AI Proxy）+ 任意靜態託管（前端）|

### 2.2 前端 API 端點盤點（36 個）

#### 遊戲核心（需 AI）
| 端點 | 方法 | 遷移策略 |
|------|------|----------|
| `/api/game/play/interact` | POST | 客戶端組裝 context → AI Proxy |
| `/api/game/cultivation/start` | POST | 客戶端計算結果 → AI Proxy 生成敘事 |
| `/api/game/combat/initiate` | POST | 客戶端建立戰鬥 → AI Proxy 生成場景 |
| `/api/game/combat/action` | POST | 客戶端處理機制 → AI Proxy 生成戰報 |
| `/api/game/combat/surrender` | POST | AI Proxy |
| `/api/game/combat/finalize-combat` | POST | 客戶端結算 → AI Proxy 生成後敘事 |
| `/api/game/npc/chat` | POST | AI Proxy |
| `/api/game/npc/end-chat` | POST | AI Proxy 生成摘要 |
| `/api/game/npc/give-item` | POST | 客戶端處理物品 → AI Proxy 生成反應 |
| `/api/game/npc/confirm-trade` | POST | 客戶端處理交易 → AI Proxy 生成敘事 |
| `/api/game/state/force-suicide` | POST | AI Proxy 生成死亡敘事 |
| `/api/game/state/get-encyclopedia` | GET | AI Proxy |
| `/api/game/state/forget-skill` | POST | AI Proxy 生成遺忘敘事 |
| `/api/epilogue` | GET | AI Proxy |
| `/api/image/generate/npc/:name` | POST | AI Proxy（圖像生成） |
| `/api/bounties/claim` | POST | AI Proxy 生成獎勵 |
| `/api/beggar/start-inquiry` | POST | AI Proxy |
| `/api/beggar/ask` | POST | AI Proxy |

#### 純資料操作（改為 IndexedDB）
| 端點 | 方法 | 遷移策略 |
|------|------|----------|
| `/api/game/state/latest-game` | GET | 直接讀 IndexedDB |
| `/api/game/state/inventory` | GET | 直接讀 IndexedDB |
| `/api/game/state/skills` | GET | 直接讀 IndexedDB |
| `/api/game/state/get-relations` | GET | 客戶端計算關係圖 |
| `/api/game/state/get-novel` | GET | 直接讀 IndexedDB |
| `/api/game/state/restart` | POST | 清除 IndexedDB 資料 |
| `/api/game/state/drop-item` | POST | 直接改 IndexedDB |
| `/api/inventory/equip/:id` | POST | 直接改 IndexedDB |
| `/api/inventory/unequip/:id` | POST | 直接改 IndexedDB |
| `/api/game/npc/profile/:name` | GET | 直接讀 IndexedDB |
| `/api/game/npc/start-trade/:name` | GET | 直接讀 IndexedDB |
| `/api/bounties` | GET | 直接讀 IndexedDB |
| `/api/map/world-map` | GET | 客戶端計算地圖 |

#### 可移除
| 端點 | 原因 |
|------|------|
| `/api/auth/login` | 本機化不需要帳密認證 |
| `/api/auth/register` | 本機化不需要註冊 |
| `/api/admin/*` | 可保留為本機 GM 面板，不需要網路 |
| `/api/gcp/*` | 不再使用 GCP |
| `/api/beggar/summon` | 整合到客戶端邏輯 |

### 2.3 資料模型盤點

#### IndexedDB Store 設計（從 15 個 Firestore 集合轉換）

```
IndexedDB Database: "WenJiang_Game"
│
├── Store: "profiles"              ← users（玩家檔案）
│   Key: profileId (auto)
│   Index: name
│   Fields: username, gender, powers, morality, stamina,
│           equipment, bulkScore, isDeceased, dates, customSkills
│
├── Store: "game_saves"            ← users/{id}/game_saves
│   Key: [profileId, round]       (複合鍵)
│   Index: profileId, round
│   Fields: R, story, playerState, roundData 全部欄位 (25+)
│
├── Store: "inventory"             ← users/{id}/inventory_items
│   Key: [profileId, instanceId]
│   Index: profileId
│   Fields: templateId, itemType, quantity, bulk, isEquipped, equipSlot
│
├── Store: "skills"                ← users/{id}/skills
│   Key: [profileId, skillName]
│   Index: profileId
│   Fields: exp, level, power_type, combatCategory, description, isCustom
│
├── Store: "npc_states"            ← users/{id}/npc_states
│   Key: [profileId, npcName]
│   Index: profileId
│   Fields: friendlinessValue, romanceValue, interactionSummary,
│           equipment, inventory, isDeceased
│
├── Store: "npc_templates"         ← npcs（全域 NPC 模板）
│   Key: npcName
│   Fields: name, gender, status_title, allegiance, skills,
│           relationships, currentLocation, personality, appearance
│
├── Store: "item_templates"        ← items（物品模板）
│   Key: itemName
│   Fields: itemType, bulk, description, damage, rarity
│
├── Store: "skill_templates"       ← skills（技能模板）
│   Key: skillName
│   Fields: combatCategory, power_type, description
│
├── Store: "locations"             ← locations（靜態地點）
│   Key: locationName
│   Fields: geography, governance, economy, lore, facilities, address
│
├── Store: "location_states"       ← users/{id}/location_states
│   Key: [profileId, locationName]
│   Index: profileId
│   Fields: (同 locations，追蹤動態變化)
│
├── Store: "bounties"              ← users/{id}/bounties
│   Key: [profileId, bountyId]
│   Index: profileId
│   Fields: title, description, reward, status, expireAt, isRead
│
├── Store: "novel_chapters"        ← library_novels/{id}/chapters
│   Key: [profileId, round]
│   Index: profileId
│   Fields: story, round, timestamp
│
├── Store: "game_state"            ← users/{id}/game_state
│   Key: [profileId, docId]
│   Fields: summary, novel_cache, current_combat, pending_combat_result
│
└── Store: "logs"                  ← logs（可選，除錯用）
    Key: auto
    Fields: action, timestamp, details
```

---

## 三、架構設計

### 3.1 新架構總覽

```
┌───────────────────────────────────────────────────┐
│              玩家瀏覽器（PWA）                       │
│                                                    │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  UI 層      │  │ 遊戲邏輯引擎  │  │ Prompt 組裝 │ │
│  │ (現有 HTML  │  │ (從後端遷移)  │  │ (從後端遷移) │ │
│  │  /CSS/JS)   │  │              │  │             │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │        │
│  ┌──────┴────────────────┴──────────────────┴─────┐ │
│  │              clientDB (IndexedDB)               │ │
│  │  profiles | saves | inventory | npcs | skills   │ │
│  └────────────────────────────────────────────────┘ │
│                                                    │
│  ┌────────────────────────────────────────────────┐ │
│  │           Service Worker (離線快取)              │ │
│  └────────────────────────────────────────────────┘ │
└────────────────────────┬──────────────────────────┘
                         │ HTTPS（唯一需要網路）
                         ▼
              ┌──────────────────────┐
              │   AI Proxy Server    │
              │                      │
              │  POST /ai/story      │
              │  POST /ai/combat     │
              │  POST /ai/npc-chat   │
              │  POST /ai/image      │
              │  POST /ai/general    │
              │                      │
              │  • 持有 API Keys     │
              │  • 速率限制           │
              │  • 模型路由/Fallback  │
              │  • 無資料庫           │
              │  • 無狀態             │
              └──────────┬───────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
         OpenAI      Gemini      Claude ...
```

### 3.2 AI Proxy 設計

#### 端點定義

```
POST /ai/generate
  Body: {
    task: "story" | "combat" | "combat-setup" | "surrender" | "post-combat"
         | "cultivation" | "npc-chat" | "chat-summary" | "npc-creator"
         | "npc-memory" | "give-item" | "give-narrative" | "trade-summary"
         | "suggestion" | "summary" | "encyclopedia" | "epilogue"
         | "skill-generator" | "item-generator" | "location-generator"
         | "bounty-generator" | "reward-generator" | "action-classifier"
         | "anachronism" | "proactive-chat" | "romance-event"
         | "relation-graph" | "death-cause" | "forget-skill" | "prequel"
         | "beggar-inquiry",
    model: "openai" | "gemini" | "claude" | "deepseek" | "grok",
    context: { ... },        // 客戶端組裝的遊戲上下文
    prompt: string           // 可選：覆蓋預設 prompt
  }

  Response: {
    success: boolean,
    data: { ... },           // AI 回傳的 JSON 或文字
    model_used: string       // 實際使用的模型（可能是 fallback）
  }

POST /ai/image
  Body: {
    prompt: string,          // 圖像描述
    style: "anime" | "realistic"
  }

  Response: {
    success: boolean,
    imageBase64: string,     // Base64 編碼圖片（不存雲端）
    revisedPrompt: string
  }
```

#### Proxy 特性

| 特性 | 實作方式 |
|------|----------|
| API Key 保護 | 環境變數，前端不可見 |
| 模型路由 | 根據 `model` 參數分發到對應供應商 |
| Fallback | 非預設模型失敗 → 自動重試 OpenAI GPT-5.2 |
| 速率限制 | 每 IP 每分鐘 30 次（可調） |
| 請求大小限制 | 100KB（context 通常 10-30KB） |
| CORS | 只允許指定前端域名 |
| Prompt 構建 | **在 Proxy 端完成**（保護 prompt 不外洩）|
| 回應解析 | JSON 解析 + markdown 清理（現有邏輯搬過來）|

#### 重要設計決策：Prompt 組裝放哪裡？

| 方案 | 優點 | 缺點 |
|------|------|------|
| **A: Prompt 在前端組裝** | Proxy 最簡、無狀態 | Prompt 邏輯外洩、40+ prompt 檔搬前端 |
| **B: Prompt 在 Proxy 組裝** | Prompt 保密、前端更輕量 | Proxy 需要帶 prompts/ 目錄 |

**專家共識：選方案 B。**

理由：
1. Prompt 是遊戲核心智慧，不應暴露給玩家
2. Proxy 仍然是無狀態的（context 由客戶端傳入，Proxy 只負責組裝 prompt + 呼叫 AI）
3. `prompts/` 目錄（40+ 檔案）留在 Proxy 端，維護更簡單
4. 未來調整 prompt 只需更新 Proxy，不需要玩家更新前端

### 3.3 客戶端資料層設計

#### clientDB.js 核心 API

```javascript
// 初始化
clientDB.init()                                    // 開啟 IndexedDB

// 玩家檔案
clientDB.profiles.create(data)                     // 建立新玩家
clientDB.profiles.get(profileId)                   // 讀取檔案
clientDB.profiles.update(profileId, changes)       // 更新檔案
clientDB.profiles.list()                           // 列出所有存檔（多存檔支援）
clientDB.profiles.delete(profileId)                // 刪除存檔

// 遊戲存檔
clientDB.saves.add(profileId, roundData)           // 儲存新回合
clientDB.saves.getLatest(profileId)                // 取最新回合
clientDB.saves.getRecent(profileId, count)         // 取最近 N 回合
clientDB.saves.getAll(profileId)                   // 取全部回合（小說用）

// 物品
clientDB.inventory.list(profileId)                 // 列出所有物品
clientDB.inventory.add(profileId, item)            // 新增物品
clientDB.inventory.update(profileId, instanceId, changes)
clientDB.inventory.remove(profileId, instanceId)   // 移除物品
clientDB.inventory.equip(profileId, instanceId)    // 裝備
clientDB.inventory.unequip(profileId, instanceId)  // 卸下

// 技能
clientDB.skills.list(profileId)
clientDB.skills.add(profileId, skill)
clientDB.skills.update(profileId, skillName, changes)
clientDB.skills.remove(profileId, skillName)

// NPC
clientDB.npcs.getState(profileId, npcName)         // 玩家專屬狀態
clientDB.npcs.setState(profileId, npcName, data)
clientDB.npcs.listStates(profileId)                // 所有已知 NPC
clientDB.npcs.getTemplate(npcName)                 // 全域模板
clientDB.npcs.setTemplate(npcName, data)

// 地點
clientDB.locations.getTemplate(name)
clientDB.locations.setTemplate(name, data)
clientDB.locations.getState(profileId, name)
clientDB.locations.setState(profileId, name, data)
clientDB.locations.getMerged(profileId, name)       // 靜態 + 動態合併

// 懸賞
clientDB.bounties.list(profileId)
clientDB.bounties.add(profileId, bounty)
clientDB.bounties.update(profileId, bountyId, changes)

// 小說
clientDB.novel.addChapter(profileId, round, story)
clientDB.novel.getAll(profileId)

// 遊戲狀態
clientDB.state.get(profileId, key)                 // summary, current_combat 等
clientDB.state.set(profileId, key, data)

// 匯出/匯入
clientDB.exportAll(profileId)                      // → JSON 檔案下載
clientDB.importAll(jsonData)                       // ← JSON 檔案上傳

// 模板快取
clientDB.templates.getItem(name)
clientDB.templates.setItem(name, data)
clientDB.templates.getSkill(name)
clientDB.templates.setSkill(name, data)
```

---

## 四、風險評估與對策

### 4.1 高風險

| # | 風險 | 影響 | 對策 |
|---|------|------|------|
| R1 | **iOS Safari 清除 IndexedDB** | 長時間未玩 → 存檔消失 | 每次遊戲結束自動提醒匯出；首頁加紅字警告 |
| R2 | **AI Proxy 被濫用** | API 費用暴增 | 速率限制 + 可選的簡易 token 驗證 |
| R3 | **清除瀏覽器資料** | 所有存檔消失 | 匯出/匯入功能 + 自動備份提醒 + 可選雲端備份 |
| R4 | **遷移期間功能遺漏** | 某些功能失效 | 分階段遷移，每階段完整測試 |

### 4.2 中風險

| # | 風險 | 影響 | 對策 |
|---|------|------|------|
| R5 | **context 資料量過大** | AI Proxy 請求緩慢 | 壓縮上下文，只傳必要欄位（最近 3 回合摘要而非原文）|
| R6 | **IndexedDB API 複雜** | 開發效率低 | 使用 `idb` 套件（Promise 化封裝，僅 1.2KB）|
| R7 | **Firestore Transaction → IndexedDB** | 邏輯轉換困難 | IndexedDB 原生支援 transaction，語法不同但概念相同 |
| R8 | **現有玩家存檔遷移** | 舊玩家無法繼續遊戲 | 提供一次性「Firestore → JSON」匯出工具 |
| R9 | **Prompt 更新部署** | 調整 prompt 需更新 Proxy | 可接受，Proxy 部署在 Vercel/Cloudflare，更新秒級 |

### 4.3 低風險

| # | 風險 | 影響 | 對策 |
|---|------|------|------|
| R10 | **客戶端作弊（修改功力等）** | 遊戲平衡 | 單人遊戲，可接受 |
| R11 | **舊瀏覽器不支援 IndexedDB** | 無法遊玩 | IE 已淘汰，現代瀏覽器全支援 |
| R12 | **Service Worker 快取過期** | 需要重新下載 | 版本化快取策略 |

---

## 五、執行計劃

### 階段總覽

```
Phase 0: 準備工作                    [1 天]
Phase 1: IndexedDB 資料層            [3 天]
Phase 2: 客戶端遊戲引擎              [5 天]
Phase 3: AI Proxy 伺服器             [2 天]
Phase 4: 前端整合                    [3 天]
Phase 5: PWA 外殼                    [1 天]
Phase 6: 存檔系統與收尾              [2 天]
────────────────────────────────────
總計                                 ~17 天
```

---

### Phase 0: 準備工作

**目標**: 建立開發環境，確保可回滾

- [ ] 建立 `pwa` 分支
- [ ] 安裝 `idb` 套件（IndexedDB Promise 封裝）
- [ ] 建立 `client/` 目錄結構：
  ```
  client/
  ├── db/
  │   ├── clientDB.js          # IndexedDB 主模組
  │   ├── schema.js            # Store 定義與版本管理
  │   └── migrations.js        # IndexedDB 版本升級邏輯
  ├── engine/
  │   ├── stateManager.js      # 遊戲狀態管理（取代 stateUpdaters.js）
  │   ├── combatEngine.js      # 戰鬥邏輯（取代 combatManager.js）
  │   ├── cultivationEngine.js # 修煉邏輯（取代 cultivationManager.js）
  │   ├── itemEngine.js        # 物品管理（取代 itemManager.js）
  │   ├── npcEngine.js         # NPC 管理（取代 npcHelpers.js）
  │   ├── economyEngine.js     # 經濟系統（取代 economyManager.js）
  │   ├── worldEngine.js       # 世界系統（取代 worldEngine.js）
  │   ├── relationEngine.js    # 關係系統（取代 relationshipManager.js）
  │   └── contextBuilder.js    # AI 上下文組裝（取代 contextBuilder.js）
  ├── ai/
  │   └── aiProxy.js           # AI Proxy 客戶端
  └── utils/
      ├── gameUtils.js         # 純邏輯工具函式
      ├── dateUtils.js         # 日期計算
      └── exportImport.js      # 存檔匯出/匯入
  ```

---

### Phase 1: IndexedDB 資料層

**目標**: 建立完整的本機資料庫，可讀寫所有遊戲資料

#### 1.1 建立 schema.js
- 定義所有 14 個 Object Store
- 定義索引（profileId, round, npcName 等）
- 版本管理邏輯

#### 1.2 建立 clientDB.js
- 基於 `idb` 套件封裝
- 實作所有 CRUD 操作
- 實作 transaction 支援（裝備、貨幣等需要原子操作）
- 實作 `exportAll()` / `importAll()`

#### 1.3 建立 migrations.js
- IndexedDB 版本升級處理
- 未來新增欄位/Store 時的遷移邏輯

#### 1.4 測試
- 單元測試：每個 Store 的 CRUD
- 壓力測試：寫入 1000 回合存檔，確認效能
- 匯出匯入完整性測試

---

### Phase 2: 客戶端遊戲引擎

**目標**: 將後端遊戲邏輯遷移到前端

#### 2.1 gameUtils.js — 搬移純邏輯函式（~50 個）
從後端提取，不需修改：
- `calculateBulkScore()`, `calculateNewStamina()`, `advanceDate()`
- `toSafeNumber()`, `clampNumber()`, `toFiniteNumber()`
- `deepMergeObjects()`, `isPlainObject()`, `cloneValue()`
- `inferNpcTagType()`, `getNpcTags()`, `getFriendlinessLevel()`
- `normalizeLocationHierarchy()`, `hasLocationOverlap()`
- `normalizePowerChange()`, `normalizeCombatEntity()`
- `sanitizeLocationData()`, `buildLocationSummary()`
- `isCurrencyLikeItem()`, `preprocessPlayerAction()`
- 修煉公式：`cultivationFormulas.js` 全部搬過來

#### 2.2 stateManager.js — 遊戲狀態更新
取代 `stateUpdaters.js` 的 `updateGameState()`，拆分為：
- `applyPowerChanges(profile, powerChange)` → 更新 IndexedDB
- `applyMoralityChange(profile, change)` → 更新 IndexedDB
- `applyItemChanges(profileId, itemChanges)` → 更新 IndexedDB inventory
- `applySkillChanges(profileId, skillChanges)` → 更新 IndexedDB skills
- `applyNpcUpdates(profileId, npcUpdates)` → 更新 IndexedDB npc_states
- `applyLocationUpdates(profileId, locationUpdates)` → 更新 IndexedDB
- `applyRomanceChanges(profileId, romanceChanges)` → 更新 IndexedDB
- `saveRound(profileId, roundData)` → 寫入新回合

#### 2.3 combatEngine.js — 戰鬥系統
- `initiateCombat(profile, targetNpc, intention)` → 建立戰鬥狀態
- `processCombatAction(combatState, action)` → 計算機制
- `finalizeCombat(profileId, combatResult)` → 結算
- `processSurrender(combatState)` → 投降處理

#### 2.4 其他引擎模組
- `cultivationEngine.js`: 修煉流程（計算結果 + 資源消耗）
- `itemEngine.js`: 物品新增/移除/裝備/模板管理
- `npcEngine.js`: NPC 狀態合併、好感度/戀愛值更新
- `economyEngine.js`: 貨幣管理
- `worldEngine.js`: 地點資料合併
- `relationEngine.js`: 關係圖建構

#### 2.5 contextBuilder.js — AI 上下文組裝
最關鍵的遷移：
```javascript
async function buildContext(profileId) {
  const profile = await clientDB.profiles.get(profileId);
  const recentSaves = await clientDB.saves.getRecent(profileId, 3);
  const skills = await clientDB.skills.list(profileId);
  const inventory = await clientDB.inventory.list(profileId);
  const summary = await clientDB.state.get(profileId, 'summary');
  const location = await clientDB.locations.getMerged(profileId, profile.currentLocation);
  const npcStates = await clientDB.npcs.listStates(profileId);
  // ... 組裝成 AI Proxy 需要的 context 物件
  return { player, recentHistory, skills, inventory, summary, location, npcs, bulkScore };
}
```

---

### Phase 3: AI Proxy 伺服器

**目標**: 建立極簡的 AI 轉發伺服器

#### 3.1 建立 Proxy 專案
```
ai-proxy/
├── server.js              # Express 入口（~100 行）
├── routes/
│   └── aiRoutes.js        # POST /ai/generate, POST /ai/image
├── services/
│   └── aiService.js       # 搬自現有 services/aiService.js（幾乎不改）
├── prompts/               # 搬自現有 prompts/（完整複製）
│   ├── storyPrompt.js
│   ├── combatPrompt.js
│   ├── story_components/
│   └── ... (40+ 檔案)
├── middleware/
│   ├── rateLimit.js       # 速率限制
│   └── cors.js            # CORS 設定
├── package.json
└── .env                   # API Keys
```

#### 3.2 核心邏輯
- 接收 `{ task, model, context }`
- 根據 `task` 選擇對應的 prompt 模板
- 將 `context` 注入 prompt
- 呼叫 AI（帶 fallback）
- 解析回應（JSON / 純文字）
- 回傳結果

#### 3.3 部署
- **推薦**: Vercel Serverless Functions 或 Cloudflare Workers
- 免費方案足夠（無資料庫、無狀態）
- 自動 HTTPS
- 全球 CDN

---

### Phase 4: 前端整合

**目標**: 改寫 `scripts/api.js`，將所有 API 呼叫指向本機 + AI Proxy

#### 4.1 改寫 api.js
```javascript
// 現在：全部打後端
api.interact(body) → fetch('/api/game/play/interact', body)

// 改為：純資料走本機，AI 走 Proxy
api.interact(body) → {
  const context = await contextBuilder.buildContext(profileId);
  const aiResult = await aiProxy.generate('story', body.model, { ...context, action: body.action });
  await stateManager.applyAllChanges(profileId, aiResult.data);
  await clientDB.saves.add(profileId, aiResult.data.roundData);
  return formatResponse(aiResult.data);
}
```

#### 4.2 逐端點改寫
- 純資料端點（13 個）：直接改為 clientDB 呼叫
- AI 端點（18 個）：clientDB 讀取 → contextBuilder 組裝 → aiProxy 呼叫 → clientDB 寫入
- 移除端點（5 個）：刪除相關程式碼

#### 4.3 改寫認證流程
- 移除 JWT 登入
- 改為「選擇存檔」或「建立新角色」
- 支援多存檔槽位

#### 4.4 UI 調整
- 登入頁 → 存檔選擇頁
- 新增「匯出存檔」「匯入存檔」按鈕
- 新增「新建存檔」功能
- 新增離線狀態提示

---

### Phase 5: PWA 外殼

**目標**: 讓遊戲可安裝到手機/PC 桌面

#### 5.1 manifest.json
```json
{
  "name": "AI 文江 — 武俠文字冒險",
  "short_name": "AI 文江",
  "start_url": "/index.html",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

#### 5.2 Service Worker
```javascript
// 快取策略
// - 靜態資源（HTML/CSS/JS）：Cache First
// - AI Proxy 請求：Network Only（不快取）
// - 圖片：Cache First with Network Fallback
// - 離線回退：顯示「需要網路連線才能推進劇情」
```

#### 5.3 HTTPS
- 前端部署到支援 HTTPS 的平台（Vercel / Netlify / GitHub Pages）
- PWA 安裝要求 HTTPS（localhost 開發例外）

---

### Phase 6: 存檔系統與收尾

**目標**: 完善存檔安全機制，清理舊程式碼

#### 6.1 存檔匯出/匯入
- 「匯出存檔」→ 下載 `wenjiang_save_<name>_<date>.json`
- 「匯入存檔」→ 上傳 JSON → 驗證格式 → 寫入 IndexedDB
- 存檔格式版本號（未來相容性）

#### 6.2 自動備份提醒
- 每次關閉遊戲時提醒
- iOS Safari 額外警告
- 可設定提醒頻率

#### 6.3 Firestore 遷移工具（一次性）
- 登入舊帳號 → 從 Firestore 下載所有資料 → 轉成匯入格式的 JSON
- 用完即棄的工具頁

#### 6.4 清理
- 移除 `firebase-admin` 依賴
- 移除全部後端路由檔案（保留在 git 歷史中）
- 移除 `middleware/auth.js`（JWT）
- 更新 `package.json`

---

## 六、技術決策記錄

| 決策 | 選項 | 選擇 | 理由 |
|------|------|------|------|
| 本機資料庫 | SQLite / IndexedDB / localStorage | **IndexedDB** | 瀏覽器原生、手機支援、容量大、支援 transaction |
| IndexedDB 封裝 | 原生 / idb / Dexie.js | **idb** | 最輕量（1.2KB）、Promise API、夠用 |
| Prompt 位置 | 前端 / Proxy | **Proxy** | 保護遊戲邏輯、方便更新 |
| AI Proxy 框架 | Express / Hono / Cloudflare Workers | **依部署平台決定** | Vercel → Express; Cloudflare → Hono |
| 圖片儲存 | Firebase Storage / Base64 in IndexedDB | **Base64 in IndexedDB** | 免費、離線可用 |
| 認證方式 | JWT / 無 / 本機 PIN | **無（本機身份）** | 單機遊戲不需網路認證 |
| 多存檔 | 單存檔 / 多存檔 | **多存檔** | 本機化的額外好處，無成本增加 |

---

## 七、成功指標

| 指標 | 目標 |
|------|------|
| Firebase 費用 | **$0**（完全移除） |
| 伺服器費用 | **$0**（AI Proxy 用免費方案） |
| 首次載入時間 | < 3 秒 |
| 遊戲回合延遲 | < AI 回應時間（無 DB 延遲） |
| 離線可用功能 | 瀏覽存檔、物品、關係圖、地圖、小說 |
| 手機可安裝 | iOS Safari + Chrome Android |
| PC 瀏覽器支援 | Chrome / Edge / Firefox / Safari |
| 存檔安全 | 匯出/匯入功能 + 自動提醒 |

---

## 八、不在本次範圍內（未來考慮）

- 多人連線功能
- 雲端存檔同步（可選的輕量實作）
- App Store / Google Play 上架
- WebSocket 即時通訊
- UI 大改版（排在本次遷移之後）

---

## 附錄 A：Firestore 操作對映表（關鍵轉換）

| Firestore 語法 | IndexedDB (idb) 對應 |
|----------------|----------------------|
| `db.collection('x').doc(id).get()` | `db.get('x', id)` |
| `db.collection('x').doc(id).set(data)` | `db.put('x', data)` |
| `db.collection('x').doc(id).update(data)` | `get → merge → put` |
| `db.collection('x').doc(id).delete()` | `db.delete('x', id)` |
| `.where('f','==',v).get()` | `db.getAllFromIndex('x', 'f', v)` |
| `.orderBy('f','desc').limit(1)` | `index.openCursor(null,'prev')` |
| `db.batch()` | `tx = db.transaction([...], 'readwrite')` |
| `db.runTransaction(fn)` | 同上（IndexedDB tx 天生 atomic） |
| `FieldValue.serverTimestamp()` | `new Date().toISOString()` |
| `FieldValue.increment(n)` | `get → value+n → put` |
| `.set(data, {merge:true})` | `get → deepMerge → put` |
| 子集合 `doc(id).collection('sub')` | 獨立 Store + 複合鍵 `[parentId, docId]` |

---

## 附錄 B：檔案保留/移除清單

### 保留（搬到前端或 Proxy）
```
prompts/                    → AI Proxy
services/aiService.js       → AI Proxy
api/aiConfig.js             → AI Proxy
api/config/cultivationFormulas.js → client/engine/
shared/gameConstants.mjs    → client/utils/
scripts/                    → 保留（改寫 api.js）
styles/                     → 保留
*.html                      → 保留
```

### 移除
```
server.js                   → 移除（由 AI Proxy 取代）
middleware/auth.js           → 移除（不需 JWT）
api/authRoutes.js            → 移除（不需帳密）
api/stateRoutes.js           → 移除（邏輯搬前端）
api/gameRoutes.js            → 移除
api/gameplayRoutes.js        → 移除
api/combatRoutes.js          → 移除（邏輯搬前端）
api/npcRoutes.js             → 移除
api/routes/*                 → 移除
api/gameplay/*               → 移除（邏輯搬前端）
api/models/*                 → 移除（改用 IndexedDB schema）
api/admin/*                  → 保留（改為前端 GM 面板）
api/*.js (管理器/幫手)        → 拆分後部分搬前端
firebase-admin               → 移除
package.json                 → 大幅瘦身
```

---

*本計劃書待審閱確認後開始執行。*
