# MemPalace x 文字冒險故事 整合計劃書

> **版本**: v1.0 | **日期**: 2026-04-10  
> **專案**: 文字冒險故事 (武俠文字冒險 PWA)  
> **目標**: 整合 MemPalace 長期記憶系統，解決遊戲超過 ~10 回合後 AI 遺忘早期事件、NPC、劇情線的核心問題  

---

## 1. 專家會議紀錄

### 1.1 AI 架構專家 — 連接 Node.js AI Proxy 與 Python MemPalace

**現況分析：**

目前「文字冒險故事」的記憶架構由兩層組成：
- **短期記憶**：Firebase Firestore 儲存最近 3 回合的 `game_saves`（由 `contextBuilder.js` 的 `savesSnapshot` 查詢）
- **長期記憶**：1 份 AI 生成的摘要文字（`summaryDoc`），每回合由 `getAISummary()` 壓縮更新

這種設計的致命缺陷在於：摘要是有損壓縮。每次更新摘要時，「故事檔案管理員」AI 必須在有限 token 內抉擇保留哪些資訊。經過 10+ 回合的連續壓縮，早期的 NPC 名字、物品來歷、支線任務等細節不可避免地被丟棄。

**MemPalace 的關鍵技術特性：**

MemPalace 是一套 Python 本地運行的語意記憶系統，使用 ChromaDB（向量資料庫）+ SQLite（時序知識圖譜），通過 MCP (Model Context Protocol) 協定曝露 23 個工具函式。核心通訊方式為 **stdio JSON-RPC 2.0** —— 即它是一個讀取 stdin、寫入 stdout 的行程，而非 HTTP 伺服器。

**連接方案：**

由於 AI Proxy 是 Node.js/Express 伺服器，而 MemPalace 是 Python stdio 行程，我建議採用 **mcp-proxy 橋接方案**：

```
Node.js AI Proxy  ←→  (HTTP/SSE)  ←→  mcp-proxy  ←→  (stdio)  ←→  MemPalace MCP Server
```

具體來說：
1. 使用 `mcp-proxy`（`pip install mcp-proxy` 或 `docker run ghcr.io/sparfenyuk/mcp-proxy`）在伺服器上啟動一個 HTTP 橋接層
2. `mcp-proxy --port=8200 python -m mempalace.mcp_server` 將 MemPalace 的 stdio 介面轉為 HTTP/SSE 端點
3. Node.js AI Proxy 透過標準 HTTP 請求呼叫 `http://localhost:8200/sse` 來存取 MemPalace 的 23 個 MCP 工具
4. 在 AI Proxy 中封裝一個 `mempalaceClient.js` 模組，將 MCP 工具呼叫抽象為簡潔的 JavaScript API

**替代方案評估：**

| 方案 | 優點 | 缺點 |
|------|------|------|
| mcp-proxy 橋接 (推薦) | 零改動 MemPalace 原始碼；標準 HTTP 通訊 | 多一個行程需管理 |
| child_process 直接 spawn | 不需額外依賴 | 需自行處理 JSON-RPC stdio 協定；管理行程生命週期複雜 |
| Python FastAPI 包裝層 | 完全自訂 API | 需撰寫維護額外 Python 程式碼；重複造輪 |
| 共享 SQLite/ChromaDB | 最低延遲 | 需深入理解 MemPalace 內部資料結構；升版風險高 |

**結論**：mcp-proxy 橋接方案最為穩健，既利用了 MemPalace 的完整 MCP 工具鏈，又保持了 Node.js 端的簡潔性。

---

### 1.2 遊戲設計專家 — 記憶結構映射 (Wings/Halls/Rooms)

**核心設計哲學：**

MemPalace 的「記憶宮殿」比喻與武俠世界有天然的對應關係。每位玩家就是一座獨立的宮殿（Palace），而遊戲的各個面向則映射為不同層級的空間結構。

**記憶的價值判斷：**

並非所有遊戲資料都需要進入 MemPalace。以下是分級策略：

| 記憶等級 | 類型 | 儲存位置 | 範例 |
|----------|------|----------|------|
| L0 (身份) | 玩家核心設定 | MemPalace L0 (永久載入) | 角色名、性別、出身、核心人格 |
| L1 (關鍵事實) | 不可遺忘的重大事件 | MemPalace L1 (永久載入) | 師門、結義兄弟、生死大仇、主線進度 |
| L2 (主題回憶) | 按需檢索的情節 | MemPalace Rooms (語意搜尋) | 某次與 NPC 的對話、特定地點的探索 |
| L3 (深度搜尋) | 完整原文 | MemPalace Drawers (向量搜尋) | 完整回合的 story 原文 |
| 即時資料 | 結構化數值 | Firebase (現有) | HP、內力值、背包、座標 |

**應儲存的記憶類型：**

1. **每回合的完整故事文本**（story 欄位）—— 作為 Drawer 原文保存
2. **NPC 互動記錄** —— 每次對話、交易、戰鬥的摘要
3. **重大抉擇** —— 玩家做出的有道德/劇情後果的選擇
4. **地點探索記錄** —— 首次到訪地點的發現
5. **武學傳承** —— 從誰學到什麼、在哪裡學到
6. **任務/懸賞進度** —— 接受、推進、完成、放棄
7. **時序事件** —— 利用知識圖譜的 `valid_from` / `ended` 記錄狀態變化

---

### 1.3 後端工程專家 — 部署架構、效能、可靠性

**當前部署架構：**

```
[客戶端 PWA]  ─── HTTPS ───→  [AI Proxy (Node.js, Port 3001)]  ───→  [MiniMax M2.7 API]
                                        ↕
                               [Firebase Firestore]
```

**整合後的部署架構：**

```
[客戶端 PWA]  ─── HTTPS ───→  [AI Proxy (Node.js, Port 3001)]  ───→  [MiniMax M2.7 API]
                                        ↕                    ↕
                               [Firebase Firestore]   [mcp-proxy (Port 8200)]
                                                             ↕ (stdio)
                                                      [MemPalace MCP Server]
                                                             ↕
                                                   [ChromaDB] + [SQLite]
```

**效能考量：**

- MemPalace 的語意搜尋延遲取決於 ChromaDB 的嵌入模型（預設 `all-MiniLM-L6-v2`，~80MB）
- 首次啟動需載入嵌入模型，約 3-5 秒；後續搜尋 <100ms
- 每回合需執行的 MemPalace 操作：1 次搜尋 + 1 次寫入，預估增加 200-500ms 延遲
- 相較於 LLM API 呼叫的 3-15 秒延遲，MemPalace 的開銷可忽略不計

**可靠性設計：**

1. MemPalace 應設計為「可降級」的附加功能。若 MemPalace 行程崩潰或無回應，AI Proxy 應 fallback 到現有的摘要機制
2. 所有 MemPalace 寫入操作使用 fire-and-forget 模式（不阻塞玩家回應）
3. MemPalace 讀取操作設 2 秒超時，超時則使用現有 `longTermSummary`
4. 利用 MemPalace 內建的 WAL (Write-Ahead Log) 確保寫入的原子性

---

### 1.4 前端 UX 專家 — 記憶如何改善玩家體驗

**問題的體驗面影響：**

目前 AI 遺忘問題表現為：
- AI 反覆介紹玩家已認識的 NPC（「你遇到了一位自稱王大夫的老者...」——第 5 次了）
- 忘記玩家的重大承諾（明明答應保護小蓮，下一章卻完全不提）
- 支線劇情斷裂（第 3 回合拿到的藏寶圖線索再也沒被提起）
- NPC 性格飄忽（同一個角色前後行為矛盾）

**整合後的體驗提升：**

1. **NPC 記住玩家**：「上次你救了我女兒，這次的藥費就免了吧！」—— AI 可從 MemPalace 檢索到與該 NPC 的完整互動史
2. **伏筆與呼應**：第 3 回合埋下的線索可以在第 30 回合被 AI 自然地引用
3. **角色弧線的連貫性**：玩家的道德選擇形成一條可追溯的軌跡，AI 可據此調整世界的反應
4. **「江湖百曉生」功能增強**：現有的百科全書功能可直接從 MemPalace 提取豐富的歷史資料

**前端無需改動：**

MemPalace 整合完全在後端進行。前端 PWA 的 API 呼叫介面不變。玩家唯一會感受到的變化是：AI 生成的故事更加連貫、更有記憶。

---

## 2. MemPalace 技術概要

### 2.1 核心架構

MemPalace 使用「記憶宮殿」隱喻組織 AI 記憶：

```
Palace (宮殿)
├── Wing (翼) ── 一個人或專案的頂層容器
│   ├── Room (房間) ── 特定主題分類
│   │   ├── Closet (衣櫥) ── 摘要，指向原文
│   │   └── Drawer (抽屜) ── 原始逐字記錄
│   └── Room ...
├── Wing ...
└── Hall (廳) ── 跨所有 Wing 的記憶類型
    ├── hall_facts ── 已確認的事實與決策
    ├── hall_events ── 里程碑事件
    ├── hall_discoveries ── 突破性發現
    ├── hall_preferences ── 偏好與習慣
    └── hall_advice ── 建議與解方
```

**Tunnel（隧道）** 是跨 Wing 的連接，當相同的 Room 出現在不同 Wing 時建立。

### 2.2 儲存後端

| 元件 | 技術 | 用途 |
|------|------|------|
| 向量資料庫 | ChromaDB (PersistentClient) | 儲存嵌入向量，支援語意搜尋 |
| 知識圖譜 | SQLite (`knowledge_graph.sqlite3`) | 儲存實體關係三元組，支援時間旅行查詢 |
| 嵌入模型 | all-MiniLM-L6-v2 (~80MB) | 本地語意嵌入，無需外部 API |
| 審計日誌 | JSONL WAL (`write_log.jsonl`) | 所有寫入操作的不可變記錄 |

### 2.3 MCP 工具清單 (23 個)

**讀取操作 (10 個)：**

| 工具名稱 | 功能 | 關鍵參數 |
|----------|------|----------|
| `mempalace_status` | 宮殿總覽統計 | — |
| `mempalace_list_wings` | 列出所有 Wing | — |
| `mempalace_list_rooms` | 列出 Wing 內的房間 | `wing` |
| `mempalace_get_taxonomy` | 完整結構樹 | — |
| `mempalace_get_aaak_spec` | AAAK 壓縮格式規格 | — |
| `mempalace_search` | **語意搜尋** (核心) | `query`, `limit`, `wing`, `room` |
| `mempalace_check_duplicate` | 相似度偵測 | `content`, `threshold` |
| `mempalace_traverse` | 圖形遍歷 | `room`, `max_hops` |
| `mempalace_find_tunnels` | 跨 Wing 橋接 | — |
| `mempalace_graph_stats` | 連接度指標 | — |

**知識圖譜操作 (5 個)：**

| 工具名稱 | 功能 | 關鍵參數 |
|----------|------|----------|
| `mempalace_kg_query` | 查詢實體關係 | `entity`, `as_of`, `direction` |
| `mempalace_kg_add` | 新增事實三元組 | `subject`, `predicate`, `object`, `valid_from` |
| `mempalace_kg_invalidate` | 標記事實過期 | `subject`, `predicate`, `object`, `ended` |
| `mempalace_kg_timeline` | 時間線回溯 | `entity` |
| `mempalace_kg_stats` | 實體/關係統計 | — |

**寫入操作 (2 個)：**

| 工具名稱 | 功能 | 關鍵參數 |
|----------|------|----------|
| `mempalace_add_drawer` | 存入記憶內容 | `wing`, `room`, `content`, `source_file`, `added_by` |
| `mempalace_delete_drawer` | 刪除記憶 | `drawer_id` |

**Agent 日誌 (2 個)：**

| 工具名稱 | 功能 | 關鍵參數 |
|----------|------|----------|
| `mempalace_diary_write` | 寫入 Agent 日誌 | `agent_name`, `entry`, `topic` |
| `mempalace_diary_read` | 讀取近期日誌 | `agent_name`, `last_n` |

### 2.4 搜尋效能基準

| 搜尋範圍 | R@5 準確率 |
|----------|-----------|
| 全量搜尋 (raw mode) | 96.6% |
| Wing 內搜尋 | 94.8% |
| Wing + Hall | 84.8% |
| AAAK 壓縮模式 | 84.2% |

**建議**：對遊戲記憶使用 **raw mode**（預設），按 Wing 過濾搜尋，可獲得最佳準確率。

### 2.5 儲存成本

以單一玩家 100 回合遊戲為例（每回合 ~1000 字故事 + 結構化數據）：
- 預估總 token 量：~200K tokens
- ChromaDB 磁碟佔用：<10MB
- SQLite 知識圖譜：<1MB
- 嵌入模型（共用）：~80MB

---

## 3. 整合架構設計

### 3.1 系統架構圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                        客戶端 (PWA)                                │
│  IndexedDB (本地快取) ←→ UI 層 ←→ API Client                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   AI Proxy Server (Node.js/Express)                │
│                                                                     │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │
│  │ aiRoutes.js  │→ │ aiService.js  │→ │ LLM API (MiniMax M2.7)  │ │
│  └──────┬───────┘  └───────────────┘  └──────────────────────────┘ │
│         │                                                           │
│  ┌──────▼──────────────────┐                                       │
│  │ contextBuilder.js (改造) │                                       │
│  │  ├─ buildContext()       │                                       │
│  │  └─ enrichWithMemPalace()│  ← 新增                              │
│  └──────┬──────────────────┘                                       │
│         │                                                           │
│  ┌──────▼──────────────────┐                                       │
│  │ mempalaceClient.js (新) │                                       │
│  │  ├─ search()            │                                       │
│  │  ├─ addMemory()         │                                       │
│  │  ├─ addFact()           │                                       │
│  │  ├─ queryEntity()       │                                       │
│  │  └─ getWakeUpContext()  │                                       │
│  └──────┬──────────────────┘                                       │
│         │ HTTP/SSE (localhost:8200)                                 │
└─────────┼───────────────────────────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    mcp-proxy (Port 8200)                           │
│         HTTP/SSE ←→ stdio JSON-RPC 2.0 橋接                       │
└─────────┬───────────────────────────────────────────────────────────┘
          │ stdio
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              MemPalace MCP Server (Python)                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │   ChromaDB      │  │   SQLite KG      │  │   WAL Log        │  │
│  │ (向量嵌入搜尋)   │  │ (時序知識圖譜)    │  │ (審計日誌)       │  │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 mempalaceClient.js 模組設計

```javascript
// ai-proxy/services/mempalaceClient.js (概念設計)

const EventSource = require('eventsource');

class MemPalaceClient {
    constructor(baseUrl = 'http://localhost:8200') {
        this.baseUrl = baseUrl;
        this.timeout = 2000; // 2 秒超時
    }

    /**
     * 語意搜尋相關記憶
     * @param {string} query - 搜尋查詢（自然語言）
     * @param {string} wing - Wing 過濾器 (如 'player_xxx')
     * @param {string} room - Room 過濾器 (如 'npc_interactions')
     * @param {number} limit - 最多回傳幾筆
     * @returns {Promise<Array>} 匹配的記憶片段
     */
    async search(query, wing, room = null, limit = 5) { ... }

    /**
     * 存入一則新記憶
     * @param {string} wing - 玩家 Wing
     * @param {string} room - 記憶分類
     * @param {string} content - 記憶內容
     */
    async addMemory(wing, room, content) { ... }

    /**
     * 新增知識圖譜事實
     * @param {string} subject - 主體 (如 NPC 名字)
     * @param {string} predicate - 關係 (如 'located_at')
     * @param {string} object - 客體 (如 '無名村')
     * @param {string} validFrom - 生效時間
     */
    async addFact(subject, predicate, object, validFrom) { ... }

    /**
     * 查詢實體的所有關係
     * @param {string} entity - 實體名稱
     * @param {string} asOf - 時間點 (可選)
     */
    async queryEntity(entity, asOf = null) { ... }

    /**
     * 標記事實過期
     */
    async invalidateFact(subject, predicate, object, ended) { ... }

    /**
     * 取得 L0+L1 喚醒上下文 (~170 tokens)
     */
    async getWakeUpContext(wing) { ... }
}
```

### 3.3 玩家隔離策略

每位玩家使用獨立的 Wing，命名規則：`player_{userId}`

```
Palace
├── Wing: player_abc123
│   ├── Room: main_story (主線故事)
│   ├── Room: npc_interactions (NPC 互動)
│   ├── Room: combat_records (戰鬥記錄)
│   ├── Room: quests (任務進度)
│   ├── Room: discoveries (探索發現)
│   └── Room: choices (重大抉擇)
├── Wing: player_def456
│   └── ...
└── Wing: world_lore (共用世界觀)
    ├── Room: factions (門派/幫派)
    ├── Room: locations (地點典故)
    └── Room: history (江湖大事)
```

---

## 4. 記憶結構設計

### 4.1 Wings 設計

| Wing 名稱 | 用途 | 生命週期 |
|-----------|------|----------|
| `player_{userId}` | 單一玩家的所有遊戲記憶 | 隨帳號存在 |
| `world_lore` | 共用的武俠世界觀設定 | 永久 (預載入) |

### 4.2 Rooms 設計 (玩家 Wing 內)

| Room 名稱 | 儲存內容 | 寫入時機 | 搜尋場景 |
|-----------|----------|----------|----------|
| `main_story` | 每回合完整故事文本 | 每回合結束 | AI 生成故事前的情節回顧 |
| `npc_interactions` | NPC 互動摘要 | NPC 對話/交易/戰鬥後 | AI 生成 NPC 反應時 |
| `combat_records` | 戰鬥過程與結果 | 戰鬥結束 | 遇到同一敵人時參考 |
| `quests` | 任務接取/進度/完成 | 任務狀態變更時 | AI 判斷任務相關劇情 |
| `discoveries` | 地點探索、秘密發現 | 首次探索新地點 | AI 生成地點相關故事 |
| `choices` | 道德抉擇與後果 | 影響道德值的行動 | AI 根據過往行為調整世界反應 |
| `relationships` | 人際關係變化軌跡 | 好感度/關係變化時 | AI 生成人物互動 |

### 4.3 Halls 映射

MemPalace 的 5 個 Hall 在遊戲中的對應：

| Hall | 遊戲中的含義 | 範例 |
|------|-------------|------|
| `hall_facts` | 已確認的遊戲世界事實 | 「玩家的師父是張三丰」「黑風寨位於青山東麓」 |
| `hall_events` | 重要的遊戲里程碑 | 「第 15 回合：玩家在華山論劍中擊敗東方不敗」 |
| `hall_discoveries` | 玩家的重大發現 | 「發現黑風寨地道的入口在枯井底部」 |
| `hall_preferences` | 玩家的行為傾向 | 「玩家傾向以和平方式解決衝突」「偏好使用劍類武器」 |
| `hall_advice` | 遊戲內的建議/提示 | 「王大夫曾建議避開青龍會的地盤」 |

### 4.4 知識圖譜設計

利用 MemPalace 的時序知識圖譜記錄動態事實：

```python
# NPC 位置追蹤
kg.add_triple("王大夫", "located_at", "無名村藥鋪", valid_from="R1")
kg.add_triple("王大夫", "located_at", "開封府醫館", valid_from="R15")
kg.invalidate("王大夫", "located_at", "無名村藥鋪", ended="R15")

# 人際關係
kg.add_triple("玩家", "saved_life_of", "小蓮", valid_from="R5")
kg.add_triple("小蓮", "attitude_toward_player", "grateful", valid_from="R5")
kg.add_triple("玩家", "enemy_of", "黑風寨寨主", valid_from="R8")

# 任務狀態
kg.add_triple("尋找失蹤藥草", "status", "accepted", valid_from="R3")
kg.add_triple("尋找失蹤藥草", "status", "completed", valid_from="R7")
kg.invalidate("尋找失蹤藥草", "status", "accepted", ended="R7")

# 物品追蹤
kg.add_triple("玩家", "possesses", "虎頭令牌", valid_from="R4")
kg.add_triple("玩家", "gave_to", "虎頭令牌→趙捕頭", valid_from="R12")
kg.invalidate("玩家", "possesses", "虎頭令牌", ended="R12")
```

---

## 5. 資料流程

### 5.1 玩家行動 → AI 回應（改造後的完整流程）

```
[玩家提交行動] (前端 → API)
       │
       ▼
[1. contextBuilder.js: buildContext()]
       │ ── 從 Firebase 取得:
       │    • 玩家基本資料 (playerContext)
       │    • 最近 3 回合 (recentHistory)
       │    • 長期摘要 (longTermSummary)  ← 保留，作為 fallback
       │    • NPC 上下文 (npcContext)
       │    • 地點上下文 (locationContext)
       │
       ▼
[2. enrichWithMemPalace()] ← ★ 新增步驟
       │
       │  (a) 語意搜尋：用玩家行動作為 query
       │      mempalace.search(playerAction, wing="player_{userId}")
       │      → 取回 3-5 條最相關的歷史記憶片段
       │
       │  (b) NPC 記憶查詢：如果場景中有 NPC
       │      mempalace.search(npcName, wing="player_{userId}", room="npc_interactions")
       │      → 取回與該 NPC 的互動歷史
       │
       │  (c) 知識圖譜查詢：查詢 NPC 最新位置/關係
       │      mempalace.queryEntity(npcName)
       │      → 取回 NPC 的當前狀態事實
       │
       │  (d) 組裝「深度記憶上下文」(~500-1500 tokens)
       │
       ▼
[3. 組裝 AI Prompt]
       │  longTermSummary (現有, ~500 tokens)
       │  + deepMemoryContext (新增, ~500-1500 tokens)
       │  + recentHistory (現有, 3 回合)
       │  + playerAction + 其他上下文
       │
       ▼
[4. callAI() → LLM 生成故事]
       │
       ▼
[5. 回傳故事給前端]
       │
       ▼
[6. 非同步記憶儲存] ← ★ 新增步驟 (fire-and-forget)
       │
       │  (a) 儲存完整故事到 MemPalace
       │      mempalace.addMemory(wing, "main_story", storyText)
       │
       │  (b) 解析 roundData，儲存結構化事實
       │      • NPC 互動 → room: "npc_interactions"
       │      • 新任務 → room: "quests"
       │      • 道德選擇 → room: "choices"
       │
       │  (c) 更新知識圖譜
       │      • NPC 位置變化 → kg_add / kg_invalidate
       │      • 關係變化 → kg_add
       │      • 物品異動 → kg_add / kg_invalidate
       │
       ▼
[7. 同時：現有的 getAISummary() 繼續運行]  ← 保留作為 fallback
```

### 5.2 搜尋策略

為每個回合構建「深度記憶上下文」時，執行以下搜尋（並行）：

```javascript
async function enrichWithMemPalace(context, playerAction, userId) {
    const wing = `player_${userId}`;
    const npcNames = Object.keys(context.npcContext || {});

    try {
        const [
            actionMemories,     // 與玩家行動相關的歷史記憶
            npcMemories,        // 與在場 NPC 相關的記憶
            entityFacts          // NPC 的知識圖譜事實
        ] = await Promise.all([
            mempalace.search(playerAction, wing, null, 3),
            Promise.all(npcNames.map(name =>
                mempalace.search(name, wing, 'npc_interactions', 2)
            )),
            Promise.all(npcNames.map(name =>
                mempalace.queryEntity(name)
            ))
        ]);

        // 組裝深度記憶上下文字串
        context.deepMemoryContext = formatMemories(
            actionMemories, npcMemories, entityFacts
        );
    } catch (error) {
        console.warn('[MemPalace] 搜尋失敗，使用現有摘要:', error.message);
        context.deepMemoryContext = ''; // 降級：不使用深度記憶
    }

    return context;
}
```

### 5.3 記憶寫入策略

```javascript
async function saveRoundToMemPalace(userId, roundData, storyText) {
    const wing = `player_${userId}`;
    const roundId = `R${roundData.R}`;

    // 不等待完成 (fire-and-forget)
    Promise.allSettled([
        // 1. 儲存完整故事
        mempalace.addMemory(wing, 'main_story', 
            `[${roundId}] ${storyText}`),

        // 2. 儲存 NPC 互動 (如果有)
        ...(roundData.NPC || []).map(npc =>
            mempalace.addMemory(wing, 'npc_interactions',
                `[${roundId}] 在${roundData.LOC}與${npc.name}互動: ${npc.action || '相遇'}`)
        ),

        // 3. 更新知識圖譜 - NPC 位置
        ...(roundData.NPC || []).map(npc =>
            mempalace.addFact(npc.name, 'located_at', 
                roundData.LOC?.join?.('→') || roundData.LOC, roundId)
        ),

        // 4. 更新知識圖譜 - 物品變動
        ...(roundData.itemChanges || []).map(item =>
            mempalace.addFact('玩家', 
                item.quantity > 0 ? 'obtained' : 'lost',
                item.name, roundId)
        )
    ]).then(results => {
        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
            console.warn(`[MemPalace] ${failures.length} 筆記憶儲存失敗`);
        }
    });
}
```

---

## 6. 部署方案

### 6.1 方案 A：同機部署（推薦用於初始整合）

在 AI Proxy 所在的伺服器上同時運行 MemPalace。

**安裝步驟：**

```bash
# 1. 確保 Python 3.9+ 已安裝
python --version

# 2. 建立虛擬環境
python -m venv /opt/mempalace-venv
source /opt/mempalace-venv/bin/activate

# 3. 安裝 MemPalace
pip install mempalace

# 4. 初始化宮殿
mempalace init

# 5. 安裝 mcp-proxy
pip install mcp-proxy

# 6. 啟動 mcp-proxy 橋接 (可用 systemd 管理)
mcp-proxy --port=8200 --allow-origin='*' \
    python -m mempalace.mcp_server
```

**Windows 開發環境特殊處理：**

```powershell
# Windows 需設定 UTF-8 編碼（MemPalace 處理中文必須）
$env:PYTHONIOENCODING = "utf-8"

# 或在 .env 中加入
PYTHONIOENCODING=utf-8
```

**systemd 服務設定範例 (Linux 部署)：**

```ini
# /etc/systemd/system/mempalace-bridge.service
[Unit]
Description=MemPalace MCP-Proxy Bridge
After=network.target

[Service]
Type=simple
User=www-data
Environment=PYTHONIOENCODING=utf-8
ExecStart=/opt/mempalace-venv/bin/mcp-proxy \
    --port=8200 \
    --allow-origin=* \
    /opt/mempalace-venv/bin/python -m mempalace.mcp_server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 6.2 方案 B：Docker Compose 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  ai-proxy:
    build: ./ai-proxy
    ports:
      - "3001:3001"
    environment:
      - MEMPALACE_URL=http://mempalace-bridge:8200
      - MINIMAX_API_KEY=${MINIMAX_API_KEY}
    depends_on:
      - mempalace-bridge

  mempalace-bridge:
    image: python:3.11-slim
    command: >
      bash -c "pip install mempalace mcp-proxy &&
               mempalace init &&
               mcp-proxy --port=8200 --host=0.0.0.0 --allow-origin='*'
               python -m mempalace.mcp_server"
    ports:
      - "8200:8200"
    volumes:
      - mempalace-data:/root/.mempalace
    environment:
      - PYTHONIOENCODING=utf-8

volumes:
  mempalace-data:
    driver: local
```

### 6.3 方案 C：child_process 直接 spawn（不推薦但可行）

如果不想引入 mcp-proxy，可在 Node.js 中直接 spawn MemPalace 的 MCP server：

```javascript
const { spawn } = require('child_process');

const mempalaceProcess = spawn('python', ['-m', 'mempalace.mcp_server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
});

// 發送 JSON-RPC 請求
function callMCP(method, params) {
    return new Promise((resolve, reject) => {
        const request = JSON.stringify({
            jsonrpc: '2.0', id: Date.now(),
            method: 'tools/call',
            params: { name: method, arguments: params }
        }) + '\n';

        mempalaceProcess.stdin.write(request);
        // ... 監聽 stdout 解析回應
    });
}
```

**此方案的風險**：需自行處理 JSON-RPC 協定細節、行程生命週期管理、以及 MCP 握手協商。推薦使用方案 A 或 B。

### 6.4 環境變數配置

在 AI Proxy 的 `.env` 中新增：

```env
# MemPalace 配置
MEMPALACE_ENABLED=true
MEMPALACE_URL=http://localhost:8200
MEMPALACE_TIMEOUT=2000
MEMPALACE_SEARCH_LIMIT=5
MEMPALACE_FALLBACK_TO_SUMMARY=true
```

---

## 7. 風險評估

### 7.1 技術風險

| 風險 | 嚴重度 | 可能性 | 緩解策略 |
|------|--------|--------|----------|
| MemPalace 行程崩潰 | 高 | 中 | Fallback 到現有摘要機制；systemd 自動重啟 |
| mcp-proxy 連線中斷 | 高 | 低 | 2 秒超時 + graceful degradation |
| ChromaDB 嵌入模型載入緩慢 | 中 | 低 | 預熱機制；首次啟動後常駐 |
| 中文語意搜尋品質不佳 | 中 | 中 | `all-MiniLM-L6-v2` 支援多語言但非中文最佳化；可能需替換為中文嵌入模型（如 `shibing624/text2vec-base-chinese`） |
| 記憶碎片化（過多無關記憶污染搜尋結果） | 中 | 中 | 精心設計 Room 分類；使用 Wing + Room 過濾搜尋 |
| 多玩家並行寫入造成競爭條件 | 中 | 低 | MemPalace 的 Drawer ID 使用確定性 SHA256；ChromaDB 支援並行讀寫 |
| Python 環境與 Node.js 環境衝突 | 低 | 低 | 使用虛擬環境或 Docker 隔離 |

### 7.2 遊戲設計風險

| 風險 | 嚴重度 | 緩解策略 |
|------|--------|----------|
| 記憶過多導致 AI prompt 超出 token 限制 | 高 | 嚴格控制注入的記憶 token 數（上限 1500 tokens）|
| 錯誤的記憶被搜尋到導致劇情矛盾 | 中 | 使用 `mempalace_check_duplicate` 去重；人工標記重要記憶 |
| 知識圖譜事實過期未正確處理 | 中 | 每次 kg_add 新事實時同時 invalidate 舊事實 |
| 記憶系統增加的延遲影響遊戲節奏 | 低 | MemPalace 操作並行化；寫入使用 fire-and-forget |

### 7.3 營運風險

| 風險 | 嚴重度 | 緩解策略 |
|------|--------|----------|
| MemPalace 為新專案 (2026-04-06 發布) 穩定性未驗證 | 高 | 初期設為可選功能（`MEMPALACE_ENABLED`）；密切追蹤 GitHub issues |
| 磁碟空間隨玩家增長 | 中 | 定期清理不活躍玩家的記憶；設定每玩家記憶上限 |
| MemPalace 升版可能破壞 API 相容性 | 中 | 鎖定版本號 (`pip install mempalace==x.y.z`)；升版前測試 |

---

## 8. 執行計劃

### Phase 0：前期準備 (1 天)

- [ ] 在開發環境安裝 Python 3.11、MemPalace、mcp-proxy
- [ ] 設定 `PYTHONIOENCODING=utf-8` 環境變數
- [ ] 執行 `mempalace init` 並驗證 `mempalace status` 正常
- [ ] 啟動 `mcp-proxy --port=8200 python -m mempalace.mcp_server` 並用 curl 測試 SSE 端點
- [ ] 評估中文語意搜尋品質：手動寫入幾條中文記憶並搜尋

### Phase 1：基礎整合層 (2-3 天)

- [ ] 建立 `ai-proxy/services/mempalaceClient.js` 模組
  - [ ] 實作 MCP over HTTP/SSE 的通訊層
  - [ ] 實作 `search()`, `addMemory()`, `addFact()`, `queryEntity()` 方法
  - [ ] 加入 2 秒超時和錯誤處理
  - [ ] 加入 `MEMPALACE_ENABLED` 開關
- [ ] 在 `.env` 加入 MemPalace 配置
- [ ] 撰寫基本測試：寫入一條記憶 → 搜尋回來

### Phase 2：記憶寫入 (2-3 天)

- [ ] 在 `aiRoutes.js` 的 story 回應後加入 `saveRoundToMemPalace()` 呼叫
- [ ] 設計記憶內容的格式化規則（從 roundData 提取什麼、如何格式化為自然語言）
- [ ] 實作知識圖譜寫入（NPC 位置、關係、物品異動）
- [ ] 在 `chatSummary` 任務後也寫入 NPC 互動記錄
- [ ] 測試：進行 10 回合遊戲，檢查 MemPalace 中的記憶數量與品質

### Phase 3：記憶讀取與上下文增強 (3-4 天)

- [ ] 改造 `contextBuilder.js`，加入 `enrichWithMemPalace()` 函式
- [ ] 修改 `storyPrompt.js`，在 prompt 中加入「深度記憶上下文」區段
- [ ] 設計記憶注入的 token 預算控制邏輯（最多 1500 tokens）
- [ ] 實作智慧搜尋策略：
  - 用玩家行動文本作為語意搜尋 query
  - 用在場 NPC 名字搜尋互動歷史
  - 用當前地點搜尋相關記憶
- [ ] A/B 測試：比較有/無 MemPalace 的故事連貫性

### Phase 4：知識圖譜深度整合 (2-3 天)

- [ ] 利用 `kg_timeline` 追蹤 NPC 的活動軌跡
- [ ] 在 `npcMemoryPrompt.js` 中注入來自知識圖譜的事實
- [ ] 實作「NPC 記得你」功能：AI 提示中附加與該 NPC 的互動時間線
- [ ] 實作「世界狀態感知」：知識圖譜中的門派關係、勢力變化

### Phase 5：優化與強化 (持續)

- [ ] 評估是否需要替換中文嵌入模型（提升搜尋品質）
- [ ] 研究 AAAK 壓縮在大量記憶下是否能節省搜尋時間
- [ ] 加入「江湖百曉生」（百科全書功能）與 MemPalace 的整合
- [ ] 加入「前情提要」功能與 MemPalace 的整合（用深度記憶取代淺層摘要）
- [ ] 設計記憶清理策略（老舊記憶的歸檔/壓縮）
- [ ] 監控生產環境的延遲、記憶體使用、磁碟成長

---

## 附錄 A：現有系統的關鍵檔案清單

| 檔案路徑 | 角色 | 整合影響 |
|----------|------|----------|
| `ai-proxy/server.js` | AI Proxy 入口 | 需啟動時初始化 MemPalace 連線 |
| `ai-proxy/services/aiService.js` | AI 調度中心 | 可能需修改以注入記憶上下文 |
| `ai-proxy/routes/aiRoutes.js` | API 路由 | 在回應後觸發記憶寫入 |
| `api/contextBuilder.js` | 上下文構建器 | **核心改造對象** — 加入 MemPalace 讀取 |
| `ai-proxy/prompts/storyPrompt.js` | 故事生成提示 | 需新增「深度記憶上下文」區段 |
| `ai-proxy/prompts/summaryPrompt.js` | 摘要生成提示 | 保留不變 (作為 fallback) |
| `ai-proxy/prompts/npcMemoryPrompt.js` | NPC 記憶提示 | 注入知識圖譜中的 NPC 事實 |
| `ai-proxy/prompts/chatMasterPrompt.js` | NPC 對話提示 | 注入互動歷史記憶 |

## 附錄 B：MemPalace Python API 快速參考

```python
# 搜尋記憶
from mempalace.searcher import search_memories
results = search_memories("為什麼選擇學習降龍十八掌",
                          palace_path="~/.mempalace/palace")

# 知識圖譜操作
from mempalace.knowledge_graph import KnowledgeGraph
kg = KnowledgeGraph()
kg.add_triple("小蓮", "attitude", "grateful", valid_from="R5")
kg.query_entity("小蓮")
kg.timeline("小蓮")
kg.invalidate("小蓮", "attitude", "grateful", ended="R20")
```

## 附錄 C：mcp-proxy 啟動指令參考

```bash
# 基本啟動
mcp-proxy --port=8200 python -m mempalace.mcp_server

# 含 CORS 與調試
mcp-proxy --port=8200 --allow-origin='*' --debug \
    python -m mempalace.mcp_server

# 使用虛擬環境
mcp-proxy --port=8200 \
    /opt/mempalace-venv/bin/python -m mempalace.mcp_server

# 含環境變數
mcp-proxy --port=8200 -e PYTHONIOENCODING=utf-8 \
    python -m mempalace.mcp_server
```

## 附錄 D：中文嵌入模型替代方案

若預設的 `all-MiniLM-L6-v2` 對中文語意搜尋品質不佳，可考慮替換：

| 模型 | 大小 | 中文表現 | 說明 |
|------|------|----------|------|
| `all-MiniLM-L6-v2` (預設) | 80MB | 中等 | 多語言但非中文最佳化 |
| `shibing624/text2vec-base-chinese` | 400MB | 優秀 | 中文專用 |
| `BAAI/bge-small-zh-v1.5` | 130MB | 優秀 | 中文專用，體積較小 |
| `moka-ai/m3e-base` | 400MB | 優秀 | 中文+英文雙語 |

替換方式需查閱 MemPalace 的 `config.yaml` 是否支援自訂嵌入模型設定。
