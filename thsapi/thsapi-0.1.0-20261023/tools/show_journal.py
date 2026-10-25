import sqlite3

con = sqlite3.connect(r"D:\jyauto\data\orders.db")
con.row_factory = sqlite3.Row
rows = list(
    con.execute(
        "select client_order_id, created_at, symbol, side, price, quantity, status,"
        " broker_order_id, message from orders order by created_at desc limit 8"
    )
)
for r in rows:
    d = dict(r)
    print(f"{d['created_at']} {d['client_order_id']} {d['symbol']} {d['side']} "
          f"{d['price']}x{d['quantity']} {d['status']} broker={d['broker_order_id']}")
    print("    ", (d["message"] or "")[:120])
