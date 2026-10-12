from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "tasks.sqlite3"
        with self.connect() as con:
            con.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS documents (
                    kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY(kind,id)
                );
                CREATE TABLE IF NOT EXISTS items (
                    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, position INTEGER NOT NULL,
                    data TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS items_batch ON items(batch_id,position);
                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL,
                    data TEXT NOT NULL
                );
            """)

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.path, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def put(self, kind: str, identifier: str, data: dict):
        with self.connect() as con:
            con.execute("INSERT OR REPLACE INTO documents VALUES (?,?,?)",
                        (kind, identifier, json.dumps(data, ensure_ascii=False)))

    def get(self, kind: str, identifier: str) -> dict:
        with self.connect() as con:
            row = con.execute("SELECT data FROM documents WHERE kind=? AND id=?",
                              (kind, identifier)).fetchone()
        if row is None:
            raise KeyError("记录不存在")
        return json.loads(row[0])

    def all(self, kind: str) -> list[dict]:
        with self.connect() as con:
            rows = con.execute("SELECT data FROM documents WHERE kind=? ORDER BY rowid DESC", (kind,))
            return [json.loads(row[0]) for row in rows]

    def create_batch(self, batch: dict, items: list[dict]):
        with self.connect() as con:
            con.execute("INSERT INTO documents VALUES ('batch',?,?)",
                        (batch["id"], json.dumps(batch, ensure_ascii=False)))
            con.executemany("INSERT INTO items VALUES (?,?,?,?)", [
                (item["id"], batch["id"], item["position"], json.dumps(item, ensure_ascii=False))
                for item in items
            ])

    def items(self, batch_id: str) -> list[dict]:
        with self.connect() as con:
            rows = con.execute("SELECT data FROM items WHERE batch_id=? ORDER BY position", (batch_id,))
            return [json.loads(row[0]) for row in rows]

    def item(self, item_id: str) -> dict:
        with self.connect() as con:
            row = con.execute("SELECT data FROM items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise KeyError("商品记录不存在")
        return json.loads(row[0])

    def save_item(self, item: dict):
        with self.connect() as con:
            con.execute("UPDATE items SET data=? WHERE id=?",
                        (json.dumps(item, ensure_ascii=False), item["id"]))

    def begin_attempt(self, item_id: str) -> int:
        with self.connect() as con:
            cur = con.execute("INSERT INTO attempts(item_id,data) VALUES (?,?)", (
                item_id, json.dumps({"started_at": now(), "status": "running"})))
            return cur.lastrowid

    def finish_attempt(self, attempt_id: int, result: dict):
        with self.connect() as con:
            row = con.execute("SELECT data FROM attempts WHERE id=?", (attempt_id,)).fetchone()
            data = {**json.loads(row[0]), **result, "ended_at": now()}
            con.execute("UPDATE attempts SET data=? WHERE id=?", (json.dumps(data, ensure_ascii=False), attempt_id))

    def attempts(self, item_id: str) -> list[dict]:
        with self.connect() as con:
            return [{"id": row[0], **json.loads(row[1])} for row in con.execute(
                "SELECT id,data FROM attempts WHERE item_id=? ORDER BY id", (item_id,))]

    def recover(self):
        for batch in self.all("batch"):
            if batch["status"] in {"running", "pausing"}:
                batch.update(status="paused", error="上次运行已中断，已保存的结果可以继续使用。")
                self.put("batch", batch["id"], batch)
            for item in self.items(batch["id"]):
                if item["status"] == "running":
                    item.update(status="unknown", error="请求中断，结果未知；可能已计费，请决定是否重新生成。")
                    self.save_item(item)
                    for attempt in self.attempts(item["id"]):
                        if attempt["status"] == "running":
                            self.finish_attempt(attempt["id"], {"status": "unknown", "error": item["error"]})
