# -*- coding: utf-8 -*-
"""
MemPalace HTTP Server v3.0 — 5 項優化
  1. 中文 Embedding (bge-small-zh-v1.5) + cosine distance
  2. Hall 記憶分類（metadata filtering）
  3. Recency weighting (/search_ranked)
  4. 寫入時去重 (_handle_add)
  5. KG Timeline (/kg/timeline, /kg/state_at) + valid_from_int
"""
import os, json, sqlite3, re
from http.server import HTTPServer, BaseHTTPRequestHandler

PALACE_DIR = os.environ.get("MEMPALACE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mempalace_data"))
PORT = int(os.environ.get("MEMPALACE_PORT", "8200"))
os.makedirs(PALACE_DIR, exist_ok=True)

import chromadb
from chromadb.utils import embedding_functions

# ── ChromaDB (vector memory) ── 優化 #1: 中文 Embedding ──
_client = None
_collection = None

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
            "mempalace_drawers_zh",
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"}
        )
        print(f"[MemPalace] ChromaDB: {_collection.count()} docs (bge-small-zh-v1.5, cosine)")
    return _collection

# ── SQLite Knowledge Graph ── 優化 #5: valid_from_int + 複合索引 ──
_kg_db = None

def get_kg():
    global _kg_db
    if _kg_db is None:
        db_path = os.path.join(PALACE_DIR, "knowledge_graph.sqlite3")
        _kg_db = sqlite3.connect(db_path, check_same_thread=False)
        _kg_db.execute("PRAGMA journal_mode=WAL")
        _kg_db.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wing TEXT NOT NULL,
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                object TEXT NOT NULL,
                valid_from TEXT,
                valid_from_int INTEGER DEFAULT 0,
                ended TEXT,
                ended_int INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # 基本索引
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_wing ON facts(wing)")
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)")
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object)")
        # 複合索引：最常用的查詢模式
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_wing_subj_ended ON facts(wing, subject, ended)")
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_timeline ON facts(wing, subject, valid_from_int)")
        # 遷移：舊資料補 valid_from_int / ended_int
        _kg_db.execute("""
            UPDATE facts SET valid_from_int = CAST(REPLACE(valid_from, 'R', '') AS INTEGER)
            WHERE valid_from_int = 0 AND valid_from LIKE 'R%'
        """)
        _kg_db.execute("""
            UPDATE facts SET ended_int = CAST(REPLACE(ended, 'R', '') AS INTEGER)
            WHERE ended_int = 0 AND ended LIKE 'R%'
        """)
        _kg_db.commit()
        count = _kg_db.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        print(f"[MemPalace] KnowledgeGraph: {count} facts")
    return _kg_db


def _parse_round_int(val):
    """從 'R5' 或 '5' 或 5 解析出整數回合數"""
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        m = re.match(r'R?(\d+)', val)
        return int(m.group(1)) if m else 0
    return 0


class MemPalaceHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[MemPalace] {args[0]}")

    def _json_response(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            col = get_collection()
            kg = get_kg()
            kg_count = kg.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
            self._json_response(200, {"status": "ok", "docs": col.count(), "facts": kg_count})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            self._json_response(400, {"error": f"invalid body: {e}"})
            return

        routes = {
            "/add": self._handle_add,
            "/search": self._handle_search,
            "/search_ranked": self._handle_search_ranked,
            "/kg/add": self._handle_kg_add,
            "/kg/query": self._handle_kg_query,
            "/kg/invalidate": self._handle_kg_invalidate,
            "/kg/timeline": self._handle_kg_timeline,
            "/kg/state_at": self._handle_kg_state_at,
        }
        handler = routes.get(self.path)
        if handler:
            handler(body)
        else:
            self._json_response(404, {"error": "not found"})

    # ── Vector Memory ── 優化 #4: 寫入時去重 ─────────────
    def _handle_add(self, body):
        col = get_collection()
        content = body.get("content", "")
        wing = body.get("wing", "default")
        room = body.get("room", "general")
        metadata = body.get("metadata", {})
        dedup = body.get("dedup", False)
        dedup_threshold = 0.15  # cosine distance: 0 = 完全相同, 0.15 ~ cosine similarity 0.85

        if not content:
            self._json_response(400, {"error": "content is required"})
            return

        # 去重檢查（僅在 dedup=True 且有資料時）
        if dedup and col.count() > 0:
            try:
                where = {"$and": [{"wing": wing}, {"room": room}]}
                existing = col.query(query_texts=[content], n_results=1, where=where)
                if (existing.get("distances") and existing["distances"][0]
                        and existing["distances"][0][0] < dedup_threshold):
                    existing_id = existing["ids"][0][0]
                    existing_meta = existing["metadatas"][0][0] if existing["metadatas"][0] else {}
                    merged_meta = {**existing_meta, **metadata, "wing": wing, "room": room}
                    merged_meta["dedup_count"] = existing_meta.get("dedup_count", 1) + 1
                    merged_meta["last_round"] = metadata.get("round", merged_meta.get("round", 0))
                    col.update(ids=[existing_id], documents=[content], metadatas=[merged_meta])
                    self._json_response(200, {"success": True, "id": existing_id, "deduplicated": True, "total": col.count()})
                    return
            except Exception:
                pass  # 去重失敗不影響正常寫入

        doc_id = body.get("id") or f"doc_{col.count()+1}_{os.urandom(4).hex()}"
        col.add(documents=[content], ids=[doc_id], metadatas=[{**metadata, "wing": wing, "room": room}])
        self._json_response(200, {"success": True, "id": doc_id, "deduplicated": False, "total": col.count()})

    # ── 基礎搜索（向下相容）─────────────────────────────
    def _handle_search(self, body):
        col = get_collection()
        query = body.get("query", "")
        n_results = min(body.get("limit", 5), 20)
        wing = body.get("wing")
        room = body.get("room")
        if not query:
            self._json_response(400, {"error": "query is required"})
            return

        # 優化 #2: 支援 room 過濾
        where_clauses = []
        if wing:
            where_clauses.append({"wing": wing})
        if room:
            where_clauses.append({"room": room})

        if len(where_clauses) == 1:
            where = where_clauses[0]
        elif len(where_clauses) > 1:
            where = {"$and": where_clauses}
        else:
            where = None

        try:
            results = col.query(query_texts=[query], n_results=n_results, where=where)
        except Exception as e:
            self._json_response(200, {"results": [], "error": str(e)})
            return
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]
        output = [{"content": docs[i], "metadata": metas[i] if i < len(metas) else {}, "distance": dists[i] if i < len(dists) else None} for i in range(len(docs))]
        self._json_response(200, {"results": output})

    # ── 優化 #3: Recency Weighted Search ─────────────────
    def _handle_search_ranked(self, body):
        col = get_collection()
        query = body.get("query", "")
        n_results = min(body.get("limit", 5), 20)
        wing = body.get("wing")
        room = body.get("room")
        current_round = body.get("current_round", 0)
        decay_rate = body.get("decay_rate", 0.98)
        w_rel = body.get("w_relevance", 0.5)
        w_rec = body.get("w_recency", 0.35)
        w_imp = body.get("w_importance", 0.15)
        max_distance = body.get("max_distance", 0.5)  # cosine distance 門檻

        if not query:
            self._json_response(400, {"error": "query is required"})
            return

        # 過度取回 3 倍候選
        fetch_k = min(n_results * 3, 60)

        where_clauses = []
        if wing:
            where_clauses.append({"wing": wing})
        if room:
            where_clauses.append({"room": room})
        where = where_clauses[0] if len(where_clauses) == 1 else ({"$and": where_clauses} if len(where_clauses) > 1 else None)

        try:
            results = col.query(query_texts=[query], n_results=fetch_k, where=where)
        except Exception as e:
            self._json_response(200, {"results": [], "error": str(e)})
            return

        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]

        if not docs:
            self._json_response(200, {"results": []})
            return

        # 先過濾低相關結果，再計算 min/max（Bug #3 修正）
        filtered = [(i, dists[i]) for i in range(len(docs)) if dists[i] <= max_distance]
        if not filtered:
            self._json_response(200, {"results": []})
            return

        f_dists = [d for _, d in filtered]
        max_d = max(f_dists)
        min_d = min(f_dists)
        d_range = max_d - min_d if max_d != min_d else 1.0

        scored = []
        for i, dist in filtered:
            # Relevance: cosine distance 越小越相關
            relevance = 1.0 - ((dist - min_d) / d_range) if d_range > 0 else 1.0

            # Recency: 指數衰減
            mem_round = metas[i].get("round", 0) if i < len(metas) else 0
            if current_round > 0 and mem_round > 0:
                rounds_ago = max(0, current_round - int(mem_round))
                recency = decay_rate ** rounds_ago
            else:
                recency = 0.5

            # Importance: 從 metadata 讀取
            importance = metas[i].get("importance", 0.5) if i < len(metas) else 0.5

            final = w_rel * relevance + w_rec * recency + w_imp * importance
            scored.append({
                "content": docs[i],
                "metadata": metas[i] if i < len(metas) else {},
                "distance": round(dist, 4),
                "final_score": round(final, 4)
            })

        scored.sort(key=lambda x: x["final_score"], reverse=True)
        self._json_response(200, {"results": scored[:n_results]})

    # ── Knowledge Graph ───────────────────────────────────
    def _handle_kg_add(self, body):
        kg = get_kg()
        wing = body.get("wing", "default")
        subject = body.get("subject", "")
        predicate = body.get("predicate", "")
        obj = body.get("object", "")
        valid_from = body.get("valid_from", "")
        if not subject or not predicate or not obj:
            self._json_response(400, {"error": "subject, predicate, object required"})
            return
        valid_from_int = _parse_round_int(valid_from)
        kg.execute(
            "INSERT INTO facts (wing, subject, predicate, object, valid_from, valid_from_int) VALUES (?,?,?,?,?,?)",
            (wing, subject, predicate, obj, valid_from, valid_from_int)
        )
        kg.commit()
        self._json_response(200, {"success": True})

    def _handle_kg_query(self, body):
        kg = get_kg()
        wing = body.get("wing")
        entity = body.get("entity", "")
        if not entity:
            self._json_response(400, {"error": "entity required"})
            return
        query = "SELECT subject, predicate, object, valid_from, ended FROM facts WHERE (subject=? OR object=?) AND ended IS NULL"
        params = [entity, entity]
        if wing:
            query += " AND wing=?"
            params.append(wing)
        query += " ORDER BY id DESC LIMIT 20"
        rows = kg.execute(query, params).fetchall()
        facts = [{"subject": r[0], "predicate": r[1], "object": r[2], "valid_from": r[3], "ended": r[4]} for r in rows]
        self._json_response(200, {"entity": entity, "facts": facts})

    def _handle_kg_invalidate(self, body):
        kg = get_kg()
        wing = body.get("wing", "default")
        subject = body.get("subject", "")
        predicate = body.get("predicate", "")
        obj = body.get("object", "")
        ended = body.get("ended", "")
        if not subject or not predicate:
            self._json_response(400, {"error": "subject, predicate required"})
            return
        ended_int = _parse_round_int(ended)
        if obj:
            kg.execute("UPDATE facts SET ended=?, ended_int=? WHERE wing=? AND subject=? AND predicate=? AND object=? AND ended IS NULL",
                       [ended, ended_int, wing, subject, predicate, obj])
        else:
            kg.execute("UPDATE facts SET ended=?, ended_int=? WHERE wing=? AND subject=? AND predicate=? AND ended IS NULL",
                       [ended, ended_int, wing, subject, predicate])
        kg.commit()
        self._json_response(200, {"success": True})

    # ── 優化 #5: KG Timeline ─────────────────────────────
    def _handle_kg_timeline(self, body):
        """實體完整歷史（包含已結束的事實）"""
        kg = get_kg()
        wing = body.get("wing")
        entity = body.get("entity", "")
        predicate = body.get("predicate")
        limit = min(body.get("limit", 30), 100)
        if not entity:
            self._json_response(400, {"error": "entity required"})
            return

        query = "SELECT subject, predicate, object, valid_from, valid_from_int, ended FROM facts WHERE (subject=? OR object=?)"
        params = [entity, entity]
        if wing:
            query += " AND wing=?"
            params.append(wing)
        if predicate:
            query += " AND predicate=?"
            params.append(predicate)
        query += " ORDER BY valid_from_int ASC, id ASC LIMIT ?"
        params.append(limit)

        rows = kg.execute(query, params).fetchall()
        timeline = [{"subject": r[0], "predicate": r[1], "object": r[2],
                      "valid_from": r[3], "round": r[4], "ended": r[5]} for r in rows]
        self._json_response(200, {"entity": entity, "timeline": timeline})

    def _handle_kg_state_at(self, body):
        """某個回合的實體快照"""
        kg = get_kg()
        wing = body.get("wing")
        entity = body.get("entity", "")
        as_of = body.get("as_of", 0)
        if not entity:
            self._json_response(400, {"error": "entity required"})
            return
        as_of_int = _parse_round_int(as_of)

        query = """SELECT subject, predicate, object, valid_from, ended
                   FROM facts WHERE (subject=? OR object=?) AND valid_from_int <= ?
                   AND (ended IS NULL OR ended_int > ?)"""
        params = [entity, entity, as_of_int, as_of_int]
        if wing:
            query += " AND wing=?"
            params.append(wing)
        query += " ORDER BY valid_from_int DESC LIMIT 30"
        rows = kg.execute(query, params).fetchall()
        facts = [{"subject": r[0], "predicate": r[1], "object": r[2], "valid_from": r[3], "ended": r[4]} for r in rows]
        self._json_response(200, {"entity": entity, "as_of": as_of, "facts": facts})


def main():
    get_collection()
    get_kg()
    server = HTTPServer(("0.0.0.0", PORT), MemPalaceHandler)
    print(f"[MemPalace] Server v3.0 on http://localhost:{PORT}")
    print(f"[MemPalace] Data: {PALACE_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[MemPalace] Shutting down")
        server.server_close()

if __name__ == "__main__":
    main()
