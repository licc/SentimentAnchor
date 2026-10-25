"""给台账里已有的委托补上 order_key（日期-HHMMSS-合同编号）。"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.journal import Journal
from thsapi.service import _make_order_key

DB = r"D:\jyauto\data\orders.db"
journal = Journal(DB)

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
rows = list(con.execute("select client_order_id, trade_date, broker_order_id, raw, message from orders"))

updated = 0
for r in rows:
    cid = r["client_order_id"]
    contract = r["broker_order_id"]
    if not contract:
        continue
    t = ""
    try:
        raw = json.loads(r["raw"] or "{}")
        row = raw.get("order_row") or {}
        t = row.get("time") or ""
    except Exception:  # noqa: BLE001
        pass
    key = _make_order_key(r["trade_date"].replace("-", ""), t, contract)
    con.execute("update orders set order_key=? where client_order_id=?", (key, cid))
    updated += 1
    print(f"{cid:28s} 合同={contract:8s} 时间={t or '-':8s} → {key}")
con.commit()
print(f"\n补齐 {updated} 条")

print("\n台账现有记录：")
for r in con.execute(
    "select client_order_id, trade_date, broker_order_id, order_key, status from orders order by created_at desc limit 8"
):
    print("  ", dict(r))
