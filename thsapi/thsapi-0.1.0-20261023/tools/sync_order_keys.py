"""把本地台账和券商当日委托对齐：用「合同编号」接上，补全 order_key（日期-HHMMSS-合同编号）。

台账里只有合同号、没有委托时间的（多半是超时/未知状态），用客户端的当日委托补上时间。
"""
from __future__ import annotations

import json
import sqlite3
import sys
import warnings
from datetime import date
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import load_config
from thsapi.gui.ths import ThsClient
from thsapi.gui.grid import pick
from thsapi.service import _make_order_key

DB = Path(r"D:\jyauto\data\orders.db")

cfg = load_config()
client = ThsClient(cfg)
client.ensure_ready()
broker_rows = client.orders(refresh=True)

# 合同编号 -> (时间, 代码, 方向, 价格, 数量, 状态)
broker: dict[str, dict] = {}
for r in broker_rows:
    contract = pick(r, "合同编号", "委托编号", "合同号").strip()
    if not contract:
        continue
    broker[contract] = {
        "time": pick(r, "委托时间", "时间", "申报时间").strip(),
        "symbol": pick(r, "证券代码", "代码").strip(),
        "side": pick(r, "操作", "买卖标志").strip(),
        "price": pick(r, "委托价格", "价格").strip(),
        "qty": pick(r, "委托数量", "数量").strip(),
        "status": pick(r, "备注", "委托状态", "状态").strip().lstrip(".·• "),
    }

print(f"客户端当日委托 {len(broker)} 笔")
for k, v in broker.items():
    print(f"  {k:8s} {v['time']:10s} {v['symbol']} {v['side']} {v['price']} x{v['qty']} {v['status']}")
print()

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
today = date.today().strftime("%Y%m%d")
updated = 0
for row in con.execute(
    "select client_order_id, trade_date, broker_order_id, order_key, status from orders"
):
    contract = row["broker_order_id"]
    if not contract:
        continue
    info = broker.get(contract)
    if not info:
        continue
    d = re.sub(r"\D", "", row["trade_date"] or "") if (re := __import__("re")) else today
    key = _make_order_key(d or today, info["time"], contract)
    # 台账写着 unknown、券商那边其实已成/已撤 → 顺手把状态对齐
    new_status = row["status"]
    st = info["status"]
    if row["status"] == "unknown" and ("已成" in st or "已撤" in st):
        new_status = "accepted" if "已成" in st else "cancelled"
    if key != (row["order_key"] or "") or new_status != row["status"]:
        con.execute(
            "update orders set order_key=?, status=?, raw=? where client_order_id=?",
            (
                key,
                new_status,
                json.dumps({"broker": info}, ensure_ascii=False),
                row["client_order_id"],
            ),
        )
        updated += 1
        print(f"  {row['client_order_id']:28s} {contract:8s} → {key}  ({row['status']}→{new_status}, {st})")
con.commit()

print(f"\n更新 {updated} 条")
print("\n对齐结果：")
for r in con.execute(
    "select client_order_id, broker_order_id, order_key, status from orders "
    "where broker_order_id is not null order by order_key desc"
):
    print("  ", dict(r))
