# -*- coding: utf-8 -*-
"""
MemPalace HTTP Server — 為 Node.js AI Proxy 提供記憶讀寫 API
輕量 Flask 伺服器，包裝 ChromaDB 操作
"""
import os
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

PALACE_DIR = os.environ.get("MEMPALACE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mempalace_data"))
PORT = int(os.environ.get("MEMPALACE_PORT", "8200"))

os.makedirs(PALACE_DIR, exist_ok=True)

import chromadb

_client = None
_collection = None

def get_collection():
    global _client, _collection
    if _collection is None:
        chroma_path = os.path.join(PALACE_DIR, "chroma_db")
        os.makedirs(chroma_path, exist_ok=True)
        _client = chromadb.PersistentClient(path=chroma_path)
        _collection = _client.get_or_create_collection("mempalace_drawers")
        print(f"[MemPalace] ChromaDB initialized at {chroma_path}, docs: {_collection.count()}")
    return _collection


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
            self._json_response(200, {"status": "ok", "docs": col.count()})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            self._json_response(400, {"error": f"invalid body: {e}"})
            return

        if self.path == "/add":
            self._handle_add(body)
        elif self.path == "/search":
            self._handle_search(body)
        elif self.path == "/count":
            col = get_collection()
            self._json_response(200, {"count": col.count()})
        else:
            self._json_response(404, {"error": "not found"})

    def _handle_add(self, body):
        col = get_collection()
        doc_id = body.get("id") or f"doc_{col.count() + 1}_{os.urandom(4).hex()}"
        content = body.get("content", "")
        wing = body.get("wing", "default")
        room = body.get("room", "general")
        metadata = body.get("metadata", {})

        if not content:
            self._json_response(400, {"error": "content is required"})
            return

        col.add(
            documents=[content],
            ids=[doc_id],
            metadatas=[{**metadata, "wing": wing, "room": room}]
        )
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
            results = col.query(
                query_texts=[query],
                n_results=n_results,
                where=where
            )
        except Exception as e:
            self._json_response(200, {"results": [], "error": str(e)})
            return

        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]

        output = []
        for i, doc in enumerate(docs):
            output.append({
                "content": doc,
                "metadata": metas[i] if i < len(metas) else {},
                "distance": dists[i] if i < len(dists) else None
            })

        self._json_response(200, {"results": output})


def main():
    # Pre-init collection
    get_collection()
    server = HTTPServer(("0.0.0.0", PORT), MemPalaceHandler)
    print(f"[MemPalace] Server running on http://localhost:{PORT}")
    print(f"[MemPalace] Data dir: {PALACE_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[MemPalace] Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
