"""量化系统侧调用示例（只用 httpx，可直接复制进你的策略进程）。

用法：
    python examples/quant_client.py --base http://127.0.0.1:8888 --key <API_KEY>
"""
from __future__ import annotations

import argparse
import time
import uuid
from typing import Any

import httpx


class ThsClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8888", api_key: str = "", timeout: float = 30.0):
        self.base = base_url.rstrip("/") + "/api/v1"
        self.http = httpx.Client(
            base_url=self.base,
            headers={"X-API-Key": api_key},
            timeout=timeout,
        )

    # ---------------- 只读 ----------------
    def health(self) -> dict[str, Any]:
        return self.http.get("/health").json()

    def account(self) -> dict[str, Any]:
        return self.http.get("/account").json()

    def positions(self) -> list[dict[str, Any]]:
        return self.http.get("/positions").json()

    def orders(self, refresh: bool = True) -> list[dict[str, Any]]:
        return self.http.get("/orders", params={"refresh": refresh}).json()

    def trades(self) -> list[dict[str, Any]]:
        return self.http.get("/trades").json()

    # ---------------- 交易 ----------------
    def order(
        self,
        symbol: str,
        side: str,
        price: float,
        quantity: int,
        client_order_id: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "symbol": symbol,
            "side": side,
            "price": price,
            "quantity": quantity,
            "client_order_id": client_order_id or f"q-{uuid.uuid4().hex[:16]}",
        }
        r = self.http.post("/orders", json=payload)
        data = r.json()
        data["_http_status"] = r.status_code
        return data

    def cancel(self, order_id: str | None = None, symbol: str | None = None) -> dict[str, Any]:
        r = self.http.post("/cancel", json={"order_id": order_id, "symbol": symbol})
        return r.json()

    # ---------------- 工具 ----------------
    def wait_order(self, order_id: str, timeout: float = 10.0, interval: float = 0.5) -> dict[str, Any] | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for o in self.orders(refresh=True):
                if o["order_id"] == order_id:
                    return o
            time.sleep(interval)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8888")
    ap.add_argument("--key", default="")
    ap.add_argument("--symbol", default="513100")
    ap.add_argument("--price", type=float, default=0.0)
    ap.add_argument("--qty", type=int, default=100)
    ap.add_argument("--side", default="buy", choices=["buy", "sell"])
    ap.add_argument("--cancel", default=None, help="撤单：传合同编号")
    args = ap.parse_args()

    c = ThsClient(args.base, args.key)
    print("health:", c.health())
    print("account:", c.account())
    print("positions:", c.positions())

    if args.cancel:
        print("cancel:", c.cancel(order_id=args.cancel))
        return 0

    if args.price <= 0:
        print("未指定 --price，跳过下单")
        return 0

    res = c.order(args.symbol, args.side, args.price, args.qty)
    print("order:", res)
    if res.get("order_id"):
        print("final:", c.wait_order(res["order_id"]))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
