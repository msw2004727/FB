# CLAUDE.md — AI 文江 (WenJiang) 專案指南

> 此檔案供 Claude Code 作為開發輔助時的專案參考規則。

---

## 專案概述

**AI 文江** 是一款單人 AI 驅動的武俠敘事遊戲（穿越 × 武俠 × 搞笑風格）。玩家穿越到古代武俠世界，透過 AI 即時生成故事、NPC、戰鬥與世界觀，目標是「尋找回家的方法」。

- **類型**: PWA 單頁應用 + Node.js AI 代理伺服器
- **語言**: 全繁體中文（程式碼註解、UI、AI 輸出皆為繁體中文）
- **部署**: 前端 GitHub Pages / 後端 Vercel + Google Cloud Run

---

## 架構總覽

```
┌──────────────────────────────────────┐
│  前端 PWA (Vanilla JS + IndexedDB)   │
│  GitHub Pages 靜態託管               │
└──────────────┬───────────────────────┘
               │ HTTP POST /ai/generate
               ▼
┌──────────────────────────────────────┐
│  AI Proxy Server (Node.js + Express) │
│  Vercel / Google Cloud Run           │
│  ├─ 50+ AI 任務端點                  │
│  ├─ 多模型路由 (MiniMax 預設)        │
│  └─ MemPalace 記憶系統整合           │
└──────────────┬───────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 MiniMax    OpenAI    Anthropic ...
 (預設)    (需 Key)   (需 Key)
```

### 前端 (`/` 根目錄)
- **無框架**：純 Vanilla JS + ES6 Modules，無打包工具
- **資料儲存**：IndexedDB（6 個 Store），零伺服器端資料庫
- **PWA**：Service Worker + manifest.json，可安裝

### 後端 (`/ai-proxy/`)
- **輕量 Express**：純粹做 AI 請求轉發 + API Key 保護
- **CommonJS**：後端使用 `require()`，非 ES Module
- **無資料庫**：不儲存任何玩家資料

---

## 目錄結構

```
fb/
├── index.html              # 單一 HTML 入口（所有 UI 結構）
├── manifest.json            # PWA 設定
├── sw.js                    # Service Worker（快取策略）
│
├── scripts/                 # 前端控制層（ES Modules）
│   ├── main.js              # App 初始化、PWA、API Key 彈窗
│   ├── gameLoop.js          # 遊戲主迴圈、玩家輸入處理
│   ├── api.js               # API 客戶端抽象層
│   ├── gameState.js         # 執行時狀態物件
│   ├── uiUpdater.js         # DOM 渲染邏輯
│   ├── dom.js               # DOM 元素快取
│   ├── gmManager.js         # GM 面板（上帝模式）
│   ├── aiModelPreference.js # AI 模型選擇 + API Key 管理
│   ├── config.js            # 常數設定（MAX_POWER、Proxy URL）
│   └── tips.js              # 載入提示文字
│
├── client/                  # 前端遊戲引擎層
│   ├── ai/
│   │   └── aiProxy.js       # AI Proxy 通訊客戶端
│   ├── db/
│   │   ├── clientDB.js      # IndexedDB 抽象層
│   │   └── schema.js        # IndexedDB Store 定義（6 個）
│   ├── engine/
│   │   ├── gameEngine.js    # 核心遊戲邏輯（回合、進度）
│   │   ├── stateManager.js  # 狀態更新同步器
│   │   └── contextBuilder.js# AI 上下文組裝器
│   └── utils/
│       ├── gameUtils.js     # 工具函式（數學、日期）
│       └── exportImport.js  # 存檔匯出/匯入
│
├── styles/                  # CSS（7 個檔案）
│   ├── base.css             # 基礎樣式 + 主題變數
│   ├── game.css             # 遊戲區域
│   ├── components.css       # 共用元件
│   ├── gmPanel.css          # GM 面板
│   ├── modals_*.css         # 各種彈窗樣式
│   ├── skills.css           # 技能相關（暫留）
│   └── trade.css            # 交易相關（暫留）
│
├── ai-proxy/                # AI 代理伺服器
│   ├── server.js            # Express 入口
│   ├── package.json         # 依賴定義
│   ├── aiConfig.js          # 任務 ↔ 模型對照表
│   ├── vercel.json          # Vercel 部署設定
│   ├── routes/
│   │   └── aiRoutes.js      # 所有 AI 任務端點
│   ├── services/
│   │   ├── aiService.js     # 多模型 AI 呼叫抽象
│   │   └── mempalaceClient.js # MemPalace 記憶系統客戶端
│   ├── middleware/
│   │   └── rateLimit.js     # 速率限制（30 req/min）
│   ├── prompts/             # 50+ Prompt 模板
│   │   ├── storyPrompt.js   # 主敘事 Prompt
│   │   ├── progressEvaluatorPrompt.js # 里程碑判定
│   │   ├── story_components/ # 10 個模組化故事規則
│   │   └── ...              # 其他任務 Prompt
│   └── tests/               # Vitest 測試
│       ├── unit/
│       ├── integration/
│       └── prompts/
│
├── icons/                   # PWA 圖示
├── _archive/                # 148 個封存舊檔案（Firebase 時代）
│
├── CHANGELOG.md             # 更新日誌
├── claude-memory.md         # Claude 記憶日誌
├── PWA_MIGRATION_PLAN.md    # 遷移計劃書
├── MEMPALACE_INTEGRATION_PLAN.md # MemPalace 整合計劃書
├── MEMPALACE_OPTIMIZATION_PLAN.md # MemPalace 優化計畫書（5 項優化 + 實施時程）
└── AI模型型號.md             # AI 模型設定文件
```

---

## 技術棧

| 層級 | 技術 | 備註 |
|------|------|------|
| 前端 | Vanilla JS (ES6 Modules) | 無框架、無打包工具 |
| 資料庫 | IndexedDB | 6 Store，全客戶端 |
| PWA | Service Worker + manifest | 可安裝、離線快取靜態資源 |
| 後端 | Node.js 18+ / Express 4 | CommonJS |
| AI SDK | OpenAI, Anthropic, Google AI | 透過 ai-proxy 統一路由 |
| 預設模型 | MiniMax M2.7 | 內建 Key，免費供玩家使用 |
| 測試 | Vitest 4 | 單元 + 整合測試 |
| 部署 | GitHub Pages (前端) / Vercel + GCR (後端) | |

---

## 開發指令

```bash
# 前端：直接用瀏覽器開啟 index.html（或用 Live Server）

# 後端本機開發
cd ai-proxy
npm install
npm run dev          # node --watch server.js (port 3001)

# 測試
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage
```

前端會自動偵測 `localhost`，連線到本機 AI Proxy (`http://localhost:3001`)。

---

## 開發規則與慣例

### 語言
- **所有 UI 文字、AI Prompt、註解**一律使用**繁體中文**
- 變數名 / 函式名使用英文 camelCase
- 檔案名使用 camelCase（如 `gameEngine.js`、`storyPrompt.js`）

### 前端 (scripts/ + client/)
- 使用 ES Module (`import`/`export`)
- DOM 操作集中在 `dom.js`（快取）和 `uiUpdater.js`（渲染）
- 狀態透過 `gameState.js` 管理（簡單物件，非 reactive）
- 遊戲邏輯在 `client/engine/`，AI 通訊在 `client/ai/`
- IndexedDB 操作統一透過 `clientDB` 抽象層
- **不使用任何框架或打包工具**

### 後端 (ai-proxy/)
- 使用 CommonJS (`require()`/`module.exports`)
- 所有 AI 任務在 `aiRoutes.js` 的 `TASK_HANDLERS` 物件中註冊
- 每個任務對應一個獨立的 Prompt 檔案在 `prompts/`
- Prompt 模板是純函式：接收 context 參數，回傳 string
- 模型路由設定在 `aiConfig.js`（目前全部指向 `minimax`）
- 玩家前端選擇的模型會覆蓋 `aiConfig` 設定

### AI Prompt 規範
- Prompt 檔案放在 `ai-proxy/prompts/`
- 主敘事 Prompt 由 `story_components/` 下的 10 個模組化規則組裝
- JSON 輸出的 Prompt 必須在 handler 中設定 `json: true`
- 純文字輸出設定 `json: false`
- 新增任務時：建立 Prompt 檔 → 在 `TASK_HANDLERS` 註冊 → 在 `aiConfig` 設定預設模型

### 遊戲系統
- **8 里程碑進度系統**：M1~M8，隱藏式，不直接告知玩家
- **行動選項**：AI 每回合提供 3 個選項，每 5 回合可自由輸入
- **善惡值**：-100 ~ 100，影響故事走向
- **敘事風格**：幽默風趣、機智詼諧，禁止流水帳
- **死亡系統**：死亡 → AI 生成 500 字結局 → 可重新開始

### 資料流

```
玩家行動 → gameLoop.handlePlayerAction()
  → api.interact() → gameEngine.interact()
    → contextBuilder.buildContext()  # 從 IndexedDB 組裝上下文
    → aiProxy.generate('story', model, context)
      → POST /ai/generate  # AI Proxy
        → TASK_HANDLERS['story']  # 組裝 Prompt
        → callAI(model, prompt)   # 呼叫 AI
        → MemPalace 讀寫          # 記憶系統
        → 回傳 JSON
    → stateManager.applyAllChanges()  # 寫入 IndexedDB
  → processNewRoundData()  # 更新 UI
```

---

## IndexedDB Schema（6 Store）

| Store | Key | 用途 |
|-------|-----|------|
| `profiles` | `id` (UUID) | 玩家角色檔案 |
| `game_saves` | `[profileId, R]` | 每回合存檔快照 |
| `locations` | `locationName` | 靜態地點模板 |
| `location_states` | `[profileId, locName]` | 動態地點狀態 |
| `novel_chapters` | `[profileId, round]` | 小說章節全文 |
| `game_state` | `[profileId, key]` | KV 儲存（摘要、里程碑等） |

---

## AI 模型

| 模型名稱 | SDK | 需要 Key | 備註 |
|----------|-----|----------|------|
| `minimax` | OpenAI (baseURL 替換) | 否（內建） | 預設模型 |
| `openai` | OpenAI | 是 | GPT-5.4 |
| `deepseek` | OpenAI (baseURL 替換) | 是 | DeepSeek-V4 |
| `grok` | OpenAI (baseURL 替換) | 是 | Grok-4.20 |
| `gemini` | Google AI | 是 | Gemini 3.1 Pro |
| `claude` | Anthropic | 是 | Claude Opus 4.6 |

Fallback 機制：非預設模型失敗時自動切換回 MiniMax。

---

## 部署

| 服務 | 平台 | URL |
|------|------|-----|
| 前端 | GitHub Pages | `https://msw2004727.github.io/FB/` |
| AI Proxy (主) | Vercel | `https://ai-proxy-cyan.vercel.app` |
| AI Proxy (備) | Google Cloud Run (asia-east2) | `https://wenjiang-ai-proxy-*.run.app` |

---

## 重要注意事項

1. **`_archive/` 資料夾**：148 個 Firebase 時代的舊檔案，不要修改或引用
2. **環境變數**：`.env` 僅在 `ai-proxy/` 目錄，包含 `MINIMAX_API_KEY` 等，已 gitignore
3. **前後端模組系統不同**：前端 ESM (`import`)、後端 CJS (`require`)
4. **所有 UI 已移除但保留 CSS 的功能**：`skills.css`、`trade.css` 等暫留供未來改版
5. **`gameLoop.js` 有亂碼註解**：歷史遺留的編碼問題，不影響功能
6. **GM 面板**：輸入 `/*GM` 可開啟上帝模式面板
7. **MemPalace 為可選**：記憶系統不可用時遊戲正常運作（降級機制）
8. **AI Proxy URL 可配置**：localStorage `wenjiang_ai_proxy_url` 可覆蓋預設
9. **繁體中文雙層防護**：`aiService.js` 全域注入 `LANG_SYSTEM_RULE`（system message），且每個 prompt 檔案都有「語言鐵律」

---

## MemPalace 記憶系統

### 技術來源
- **官方 GitHub**：https://github.com/milla-jovovich/mempalace
- **第三方分析**：https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md
- **架構**：Python + ChromaDB（向量記憶）+ SQLite（知識圖譜），MCP Server 19 工具

### 本專案實作（自建 HTTP Server，非官方 MCP）

```
ai-proxy/mempalace_server.py    # Python HTTP server (port 8200)
ai-proxy/services/mempalaceClient.js  # Node.js 客戶端
ai-proxy/mempalace/Dockerfile   # 容器化部署
```

- **寫入**：每回合 fire-and-forget 寫入 3 類記憶（main_story / npc_interactions / events）+ KG 事實
- **讀取**：故事生成前呼叫 `buildDeepMemoryContext()`，語義搜索 + KG 查詢，注入 prompt
- **降級**：2 秒 timeout，不可用時回傳空字串，遊戲正常運作
- **部署**：Google Cloud Run (asia-east2)

### 目前使用率 vs 官方功能

| 功能 | 官方有 | 本專案 | 狀態 |
|------|--------|--------|------|
| ChromaDB 向量搜索 | ✅ | ✅ | 已用 |
| Wing 分隔 | ✅ | ✅ | 已用 |
| Room 分類 | ✅ | ✅（3 個）| 已用 |
| KG 時序三元組 | ✅ | ✅ | 已用 |
| 4 層漸進式載入 | ✅ | ❌ | 待優化 |
| Hall 記憶分類 | ✅ | ❌ | 待優化 |
| KG timeline / as_of | ✅ | ❌ | 待優化 |
| 去重機制 | ✅ | ❌ | 待優化 |
| 記憶衰減 | ❌ | ❌ | 雙方皆缺 |
| 中文 embedding | ❌ | ❌ | 需自行換模型 |

### 已知瓶頸（100 回合壓力測試）

- 記憶無上限累積，搜索品質隨回合下降
- 預設 embedding (`all-MiniLM-L6-v2`) 對中文語義搜索不友好
- 搜索固定 limit（行動 3 筆 / NPC 2 筆），無 recency 加權
- longTermSummary 無長度上限，第 100 回合估計 80-150 KB（~27K-50K tokens）
