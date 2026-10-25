"""委托台账（SQLite）：幂等、审计、当日统计。"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
    client_order_id TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    trade_date      TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    side            TEXT NOT NULL,
    price           REAL NOT NULL,
    quantity        INTEGER NOT NULL,
    order_type      TEXT NOT NULL,
    status          TEXT NOT NULL,
    broker_order_id TEXT,
    order_key       TEXT,
    message         TEXT,
    name            TEXT,
    raw             TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(trade_date);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    payload    TEXT
);
"""


class Journal:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as conn:
            conn.executescript(SCHEMA)
            # 老库补列：order_key（日期-HHMMSS-合同编号）
            cols = {r[1] for r in conn.execute("PRAGMA table_info(orders)")}
            if "order_key" not in cols:
                conn.execute("ALTER TABLE orders ADD COLUMN order_key TEXT")

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # ------------------------------------------------------------------ #
    def get(self, client_order_id: str) -> dict[str, Any] | None:
        if not client_order_id:
            return None
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM orders WHERE client_order_id=?", (client_order_id,)
            ).fetchone()
        return dict(row) if row else None

    def record(
        self,
        *,
        client_order_id: str,
        symbol: str,
        side: str,
        price: float,
        quantity: int,
        order_type: str,
        status: str,
        broker_order_id: str | None = None,
        order_key: str | None = None,
        message: str = "",
        name: str = "",
        raw: dict | None = None,
        created_at: datetime | None = None,
    ) -> None:
        now = datetime.now()
        created = (created_at or now).isoformat(timespec="seconds")
        with self._lock, self._conn() as conn:
            conn.execute(
                """
                INSERT INTO orders (client_order_id, created_at, updated_at, trade_date, symbol, side,
                                    price, quantity, order_type, status, broker_order_id, order_key,
                                    message, name, raw)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(client_order_id) DO UPDATE SET
                    updated_at=excluded.updated_at,
                    status=excluded.status,
                    broker_order_id=COALESCE(excluded.broker_order_id, orders.broker_order_id),
                    order_key=COALESCE(excluded.order_key, orders.order_key),
                    message=excluded.message,
                    name=excluded.name,
                    raw=excluded.raw
                """,
                (
                    client_order_id,
                    created,
                    now.isoformat(timespec="seconds"),
                    now.date().isoformat(),
                    symbol,
                    side,
                    price,
                    quantity,
                    order_type,
                    status,
                    broker_order_id,
                    order_key,
                    message,
                    name,
                    json.dumps(raw or {}, ensure_ascii=False),
                ),
            )

    def event(self, kind: str, payload: dict | None = None) -> None:
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO events (ts, kind, payload) VALUES (?,?,?)",
                (datetime.now().isoformat(timespec="seconds"), kind, json.dumps(payload or {}, ensure_ascii=False)),
            )

    def daily_stats(self, day: date | None = None) -> tuple[int, float]:
        day = day or date.today()
        with self._lock, self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(price*quantity),0) AS amt FROM orders "
                "WHERE trade_date=? AND status NOT IN ('rejected','failed','duplicate')",
                (day.isoformat(),),
            ).fetchone()
        return int(row["n"]), float(row["amt"])

    def last_order_at(self) -> datetime | None:
        with self._lock, self._conn() as conn:
            row = conn.execute("SELECT MAX(created_at) AS ts FROM orders").fetchone()
        if not row or not row["ts"]:
            return None
        try:
            return datetime.fromisoformat(row["ts"])
        except ValueError:  # pragma: no cover
            return None

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock, self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]
