# -*- coding: utf-8 -*-
"""
MemPalace HTTP Server v2.0
- Phase 1: /add, /search (ChromaDB vector memory)
- Phase 3: /kg/add, /kg/query, /kg/invalidate (SQLite knowledge graph)
"""
import os, json, sqlite3, time
from http.server import HTTPServer, BaseHTTPRequestHandler

PALACE_DIR = os.environ.get("MEMPALACE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mempalace_data"))
PORT = int(os.environ.get("MEMPALACE_PORT", "8200"))
os.makedirs(PALACE_DIR, exist_ok=True)

import chromadb

# ── ChromaDB (vector memory) ──────────────────────────
_client = None
_collection = None

def get_collection():
    global _client, _collection
    if _collection is None:
        chroma_path = os.path.join(PALACE_DIR, "chroma_db")
        os.makedirs(chroma_path, exist_ok=True)
        _client = chromadb.PersistentClient(path=chroma_path)
        _collection = _client.get_or_create_collection("mempalace_drawers")
        print(f"[MemPalace] ChromaDB: {_collection.count()} docs")
    return _collection

# ── SQLite Knowledge Graph ────────────────────────────
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
                ended TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_wing ON facts(wing)")
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)")
        _kg_db.execute("CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object)")
        _kg_db.commit()
        count = _kg_db.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        print(f"[MemPalace] KnowledgeGraph: {count} facts")
    return _kg_db


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
            "/kg/add": self._handle_kg_add,
            "/kg/query": self._handle_kg_query,
            "/kg/invalidate": self._handle_kg_invalidate,
        }
        handler = routes.get(self.path)
        if handler:
            handler(body)
        else:
            self._json_response(404, {"error": "not found"})

    # ── Vector Memory ─────────────────────────────────
    def _handle_add(self, body):
        col = get_collection()
        doc_id = body.get("id") or f"doc_{col.count()+1}_{os.urandom(4).hex()}"
        content = body.get("content", "")
        wing = body.get("wing", "default")
        room = body.get("room", "general")
        metadata = body.get("metadata", {})
        if not content:
            self._json_response(400, {"error": "content is required"})
            return
        col.add(documents=[content], ids=[doc_id], metadatas=[{**metadata, "wing": wing, "room": room}])
        self._json_response(200, {"success": True, "id": doc_id, "total": col.count()})

    def _handle_search(self, body):
        col = get_collection()
        query = body.get("query", "")
        n_results = min(body.get("limit", 5), 20)
        wing = body.get("wing")
        if not query:
            self._json_response(400, {"error": "query is required"})
            return
        where = {"wing": wing} if wing else None
        try:
            results = col.query(query_texts=[query], n_results=n_results, where=where)
        except Exception as e:
            self._json_response(200, {"results": [], "error": str(e)})
            return
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]
        output = [{"content": docs[i], "metadata": metas[i] if i<len(metas) else {}, "distance": dists[i] if i<len(dists) else None} for i in range(len(docs))]
        self._json_response(200, {"results": output})

    # ── Knowledge Graph ───────────────────────────────
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
        kg.execute("INSERT INTO facts (wing, subject, predicate, object, valid_from) VALUES (?,?,?,?,?)",
                   (wing, subject, predicate, obj, valid_from))
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
        query = "UPDATE facts SET ended=? WHERE wing=? AND subject=? AND predicate=? AND ended IS NULL"
        params = [ended, wing, subject, predicate]
        if obj:
            query = "UPDATE facts SET ended=? WHERE wing=? AND subject=? AND predicate=? AND object=? AND ended IS NULL"
            params = [ended, wing, subject, predicate, obj]
        kg.execute(query, params)
        kg.commit()
        self._json_response(200, {"success": True})


def main():
    get_collection()
    get_kg()
    server = HTTPServer(("0.0.0.0", PORT), MemPalaceHandler)
    print(f"[MemPalace] Server v2.0 on http://localhost:{PORT}")
    print(f"[MemPalace] Data: {PALACE_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[MemPalace] Shutting down")
        server.server_close()

if __name__ == "__main__":
    main()
