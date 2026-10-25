"""并发 + 超时测试：验证串行保护与 18s 上限。"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8888/api/v1"


def call(path: str, method: str = "GET", payload: dict | None = None) -> tuple[int, float, object]:
    t0 = time.time()
    data = json.dumps(payload).encode() if payload else None
    headers = {"Content-Type": "application/json"} if payload else {}
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read().decode())
            code = r.status
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode() or "{}")
        code = e.code
    except Exception as exc:  # noqa: BLE001
        body, code = {"error": str(exc)}, 0
    return code, time.time() - t0, body


print("=== 并发 3 个请求（应串行执行，不交错）===")
results: list[tuple[str, int, float, object]] = []


def worker(name: str, path: str) -> None:
    code, dt, body = call(path)
    results.append((name, code, dt, body))


threads = [
    threading.Thread(target=worker, args=("A:portfolio", "/portfolio?fresh=true")),
    threading.Thread(target=worker, args=("B:orders", "/orders?fresh=true")),
    threading.Thread(target=worker, args=("C:trades", "/trades?fresh=true")),
]
t_all = time.time()
for t in threads:
    t.start()
for t in threads:
    t.join()
wall = time.time() - t_all

for name, code, dt, body in results:
    print(f"  {name:14s} {code}  {dt:5.2f}s")
print(f"  墙钟总计 {wall:.2f}s（串行则应接近三者耗时之和）")

print("\n=== 18s 超时上限 ===")
# 休市 + 非真实价格：会走完填单再被交易时段拦下，天然是最慢的路径
code, dt, body = call(
    "/orders", "POST",
    {"symbol": "513100", "side": "buy", "price": 2.261, "quantity": 100,
     "client_order_id": "serial-timeout-test", "ref_price": 2.26},
)
print(f"  POST /orders  {code}  {dt:5.2f}s  {(body or {}).get('code')}")
print(f"  是否 <=18.5s: {dt <= 18.5}")
