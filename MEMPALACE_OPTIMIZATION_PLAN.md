# MemPalace 記憶系統優化計畫書

> 版本: v1.0 | 日期: 2026-04-10
> 背景: 100 回合壓力測試發現記憶搜索品質下降、噪音累積、token 膨脹

---

## 一、現狀審計摘要

### 當前架構

```
mempalaceClient.js (Node.js)
    ↓ HTTP POST (2s timeout)
mempalace_server.py (Python 3.12, HTTPServer 單執行緒)
    ├── ChromaDB: all-MiniLM-L6-v2 (英文模型, 384 維, L2 距離)
    └── SQLite: facts 表 (WAL mode, 3 個索引)
```

### 審計發現的 10 個問題

| # | 問題 | 嚴重度 | 位置 |
|---|------|--------|------|
| 1 | **Embedding 模型是英文的**，對繁體中文語義搜索品質差 | 🔴 高 | `mempalace_server.py:26` |
| 2 | **零去重機制**，向量庫和 KG 都沒有 | 🔴 高 | `_handle_add`, `_handle_kg_add` |
| 3 | **搜索不過濾 room**，story/NPC/事件混在一起 | 🟡 中 | `_handle_search:130` |
| 4 | **無距離門檻**，不相關記憶也會回傳 | 🟡 中 | `_handle_search` |
| 5 | **deepMemoryContext 注入位置不佳**，在「生成指令」之後 | 🟡 中 | `aiRoutes.js:54-56` |
| 6 | **KG 查詢和向量搜索是串列的**，浪費延遲 | 🟡 中 | `mempalaceClient.js:96-97` |
| 7 | **KG 缺少複合索引**，查詢效率差 | 🟢 低 | `mempalace_server.py:51-53` |
| 8 | **單執行緒 HTTP server** | 🟢 低 | `mempalace_server.py:198` |
| 9 | **KG valid_from 用字串 "R5"**，無法正確比較大小 | 🟡 中 | `_handle_kg_add` |
| 10 | **pyyaml 裝了但沒用到** | 🟢 低 | `Dockerfile:6` |

---

## 二、5 項優化方案

### 優化 1：換中文 Embedding 模型

**目標**: 搜索精度提升 20-30%

**推薦模型**: `BAAI/bge-small-zh-v1.5`

| 屬性 | 現在 (all-MiniLM-L6-v2) | 目標 (bge-small-zh-v1.5) |
|------|------------------------|--------------------------|
| 語言 | 英文優化 | 中文優化 |
| 參數量 | 22M | 24M |
| 維度 | 384 | 512 |
| 模型大小 | ~80 MB | ~90 MB |
| 記憶體 | ~150 MB | ~200 MB |
| 256MB Cloud Run | ✅ | ✅ |

**備選**: `paraphrase-multilingual-MiniLM-L12-v2`（明確支援 zh-tw，但需 512MB Cloud Run）

**實作方式**:

```python
# mempalace_server.py — 替換 collection 初始化

from chromadb.utils import embedding_functions

def get_collection():
    global _client, _collection
    if _collection is None:
        chroma_path = os.path.join(PALACE_DIR, "chroma_db")
        os.makedirs(chroma_path, exist_ok=True)
        _client = chromadb.PersistentClient(path=chroma_path)
        ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="BAAI/bge-small-zh-v1.5"
        )
        _collection = _client.get_or_create_collection(
            "mempalace_drawers",
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"}   # 改用 cosine 距離
        )
    return _collection
```

**Dockerfile 更新**:

```dockerfile
RUN pip install --no-cache-dir chromadb sentence-transformers
# 構建時預下載模型，避免冷啟動
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-zh-v1.5')"
```

**遷移步驟**:
1. 維度從 384→512，向量空間完全不同
2. **必須刪除** `chroma_db/` 目錄，讓 ChromaDB 重建
3. 遊戲資料在 IndexedDB，記憶會隨新回合自動重新寫入
4. 已完成的回合記憶將丟失（可接受，因為 longTermSummary 仍在）

---

### 優化 2：Hall 記憶分類

**目標**: 搜索精度從 ~61% → ~95%

**分類定義**:

| Hall | 描述 | 觸發規則 |
|------|------|---------|
| `hall_facts` | 世界真相、NPC 身份 | 故事含「原來/真相/其實/身份/真名」 |
| `hall_events` | 里程碑事件 | 有 `roundData.EVT` |
| `hall_decisions` | 玩家道德/策略抉擇 | `moralityChange ≠ 0` |
| `hall_relationships` | NPC 關係變動 | `roundData.NPC.length > 0` |
| `hall_discoveries` | 發現、學會、獲得 | 故事含「發現/找到/學會/獲得/領悟/秘笈」 |
| `hall_combat` | 戰鬥結果 | 故事含「攻擊/戰鬥/受傷/招式/內力」 |

**實作方式**: 在 `mempalaceClient.js` 的 `saveRoundMemory()` 中加入規則式分類器：

```javascript
function classifyHalls(roundData, story) {
    const halls = [];
    if (roundData.moralityChange && roundData.moralityChange !== 0) halls.push('hall_decisions');
    if (roundData.NPC?.length > 0) halls.push('hall_relationships');
    if (roundData.EVT) halls.push('hall_events');
    if (story) {
        if (['攻擊','戰鬥','受傷','招式','內力'].some(kw => story.includes(kw))) halls.push('hall_combat');
        if (['發現','找到','學會','獲得','領悟'].some(kw => story.includes(kw))) halls.push('hall_discoveries');
        if (['原來','真相','其實','身份','真名'].some(kw => story.includes(kw))) halls.push('hall_facts');
    }
    return halls.length > 0 ? [...new Set(halls)] : ['hall_events'];
}
```

寫入時加入 metadata：`{ ..., halls: halls.join(',') }`
搜索時用 `where: {"halls": {"$contains": "hall_combat"}}` 過濾

---

### 優化 3：記憶衰減（Recency Weighting）

**目標**: 近期記憶優先，解決 100 回合噪音問題

**演算法**: Park et al.（Stanford 2023 Generative Agents）三因子加權

```
final_score = 0.5 × relevance + 0.35 × recency + 0.15 × importance
```

**衰減函數**: 指數衰減，rate = 0.98

```
recency_score = 0.98 ^ (current_round - memory_round)
```

| 回合距離 | recency 分數 | 效果 |
|---------|-------------|------|
| 10 回合前 | 0.817 | 仍然很相關 |
| 30 回合前 | 0.545 | 中等折扣 |
| 50 回合前 | 0.364 | 顯著折扣 |
| 100 回合前 | 0.133 | 大幅折扣但不歸零 |

**實作方式**: 新增 `/search_ranked` 端點

```python
def _handle_search_ranked(self, body):
    col = get_collection()
    query = body["query"]
    limit = min(body.get("limit", 5), 20)
    current_round = body.get("current_round", 0)
    wing = body.get("wing")
    
    # 過度取回 3 倍，再重新排序
    fetch_k = min(limit * 3, 60)
    where = {"wing": wing} if wing else None
    results = col.query(query_texts=[query], n_results=fetch_k, where=where)
    
    scored = []
    docs = results["documents"][0]
    metas = results["metadatas"][0]
    dists = results["distances"][0]
    
    max_d, min_d = max(dists), min(dists)
    d_range = max_d - min_d if max_d != min_d else 1.0
    
    for i in range(len(docs)):
        relevance = 1.0 - ((dists[i] - min_d) / d_range)
        mem_round = metas[i].get("round", 0)
        recency = 0.98 ** max(0, current_round - mem_round) if current_round and mem_round else 0.5
        importance = metas[i].get("importance", 0.5)
        final = 0.5 * relevance + 0.35 * recency + 0.15 * importance
        scored.append({"content": docs[i], "metadata": metas[i], "final_score": round(final, 3)})
    
    scored.sort(key=lambda x: x["final_score"], reverse=True)
    self._json_response(200, {"results": scored[:limit]})
```

---

### 優化 4：寫入時去重

**目標**: 減少 50%+ 冗餘記憶

**策略**: 寫入前查向量相似度，閾值 cosine distance < 0.15（≈ cosine similarity > 0.85）

**規則**:
- `main_story`: **不去重**（每回合敘事都是獨特的）
- `npc_interactions`: **去重**（重複率最高）
- `events`: **去重**（中等重複率）

**實作方式**: 修改 `_handle_add`

```python
def _handle_add(self, body):
    col = get_collection()
    content = body["content"]
    wing = body.get("wing", "default")
    room = body.get("room", "general")
    dedup = body.get("dedup", True)
    
    # 去重檢查
    if dedup and col.count() > 0:
        existing = col.query(query_texts=[content], n_results=1,
                             where={"$and": [{"wing": wing}, {"room": room}]})
        if existing["distances"][0] and existing["distances"][0][0] < 0.15:
            # 近似重複 → 更新而非新增
            col.update(ids=[existing["ids"][0][0]], documents=[content],
                       metadatas=[{**existing["metadatas"][0][0], **body.get("metadata", {})}])
            return self._json_response(200, {"success": True, "deduplicated": True})
    
    # 正常寫入
    doc_id = f"doc_{col.count()+1}_{os.urandom(4).hex()}"
    col.add(documents=[content], ids=[doc_id],
            metadatas=[{**body.get("metadata", {}), "wing": wing, "room": room}])
    self._json_response(200, {"success": True, "id": doc_id, "deduplicated": False})
```

客戶端控制去重開關：

```javascript
function addMemory(wing, room, content, metadata = {}) {
    const shouldDedup = room !== 'main_story';
    request('/add', { wing, room, content, metadata, dedup: shouldDedup });
}
```

---

### 優化 5：KG 時間線查詢

**目標**: AI 能講出 NPC 的歷史軌跡

**新增端點**:

| 端點 | 功能 | 範例 |
|------|------|------|
| `POST /kg/timeline` | 實體完整歷史 | 「王大夫去過哪裡？」 |
| `POST /kg/state_at` | 某回合的快照 | 「第 50 回合時張三在哪？」 |

**前置改動**: KG `valid_from` 從字串 `"R5"` 改為整數 `5`（支援正確的數值比較）

**Schema 升級**:

```sql
ALTER TABLE facts ADD COLUMN valid_from_int INTEGER DEFAULT 0;
UPDATE facts SET valid_from_int = CAST(REPLACE(valid_from, 'R', '') AS INTEGER)
    WHERE valid_from LIKE 'R%';
CREATE INDEX idx_facts_timeline ON facts(wing, subject, valid_from_int);
```

**時間線查詢**:

```python
def _handle_kg_timeline(self, body):
    entity = body["entity"]
    wing = body.get("wing")
    rows = kg.execute("""
        SELECT subject, predicate, object, valid_from_int, ended
        FROM facts WHERE (subject=? OR object=?) AND wing=?
        ORDER BY valid_from_int ASC LIMIT 30
    """, [entity, entity, wing]).fetchall()
    self._json_response(200, {"timeline": [
        {"subject": r[0], "predicate": r[1], "object": r[2],
         "round": r[3], "ended": r[4]} for r in rows
    ]})
```

**注入格式**（token-efficient）:

```
【王大夫的時間線】
R3: 王大夫 located_at 無名村 (已結束於R15)
R5: 王大夫 relationship 主角是恩人 (現況)
R15: 王大夫 located_at 翠雲峰 (現況)
```

---

## 三、同時修復的技術債

在實作 5 項優化的過程中，順便修復以下問題：

| 修復項 | 說明 | 涉及檔案 |
|--------|------|---------|
| deepMemoryContext 注入位置 | 移到「生成指令」**之前** | `aiRoutes.js:54-56` |
| 搜索加入 room 過濾 | where 條件增加 room | `mempalace_server.py:130` |
| KG+向量搜索並行化 | 一個 `Promise.all` 包全部 | `mempalaceClient.js:96-97` |
| 加入複合索引 | `(wing, subject, ended)` | `mempalace_server.py` |
| Token 預算控制 | deepMemoryContext 上限 800 tokens | `mempalaceClient.js` |
| 距離門檻 | 過濾 cosine distance > 0.5 的低相關結果 | `mempalace_server.py` |

---

## 四、實施順序與時程

```
Phase 1（基礎升級）
  ├── 1a. 換 embedding 模型 (bge-small-zh-v1.5)
  ├── 1b. ChromaDB 改用 cosine distance
  ├── 1c. 加入 room 過濾 + 距離門檻
  └── 1d. 修復 deepMemoryContext 注入位置
  → 部署、測試

Phase 2（記憶品質）
  ├── 2a. 實作寫入時去重
  ├── 2b. 實作 Hall 分類器 + metadata
  └── 2c. 加入 importance 評分
  → 部署、測試

Phase 3（進階搜索）
  ├── 3a. 新增 /search_ranked 端點
  ├── 3b. 實作 recency weighting
  ├── 3c. Token 預算控制
  └── 3d. 搜索+KG 並行化
  → 部署、測試

Phase 4（KG 升級）
  ├── 4a. valid_from 改為整數
  ├── 4b. 加入 /kg/timeline 端點
  ├── 4c. 加入 /kg/state_at 端點
  └── 4d. 複合索引優化
  → 部署、測試
```

---

## 五、預期效果

| 指標 | 現在 (Round 100) | 優化後 (Round 100) |
|------|-----------------|-------------------|
| 搜索精度 | ~30-40%（英文模型 + 無過濾） | ~80-90%（中文模型 + Hall + Room） |
| 記憶筆數 | ~300+（大量重複） | ~150-180（去重後） |
| deepMemoryContext token | 不穩定（0-2000） | 穩定 ~800 token |
| 搜索延遲 | ~200-500ms | ~300-600ms（多了 rerank） |
| 記憶相關性 | 低（無 recency 考量） | 高（近期優先 + 重要性加權） |
| NPC 歷史能力 | 無（只有活躍事實） | 完整時間線 |

---

## 六、風險與降級方案

| 風險 | 影響 | 降級方案 |
|------|------|---------|
| bge-small-zh 在 256MB Cloud Run OOM | 服務啟動失敗 | 升級至 512MB，或改用 multilingual-MiniLM |
| 去重閾值太激進，合併不同事件 | 丟失記憶 | 調高閾值至 0.10，或只對 NPC 互動去重 |
| sentence-transformers 冷啟動慢 | Cloud Run 首次請求 timeout | Dockerfile 預下載模型 + min-instances=1 |
| 舊記憶遷移丟失 | 前幾十回合的深度記憶消失 | 可接受，longTermSummary 仍保留摘要 |

---

## 七、參考資料

- [MemPalace 官方](https://github.com/milla-jovovich/mempalace) — 空間記憶組織架構
- [MemPalace 第三方分析](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md) — 功能 vs 宣稱的差距
- [Park et al. Generative Agents (Stanford 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763) — 三因子記憶加權公式
- [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5) — 推薦 embedding 模型
- [ChromaDB Metadata Filtering](https://docs.trychroma.com/docs/querying-collections/metadata-filtering) — Hall 過濾實作
