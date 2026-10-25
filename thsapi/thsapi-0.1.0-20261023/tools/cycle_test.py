"""接口切换压力测试：多轮循环调用 6 个接口，检查返回质量与一致性问题。

不包含真实下单（market 已收盘），下单只做参数校验层测试。
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8888/api/v1"
ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 4

issues: list[str] = []


def call(method: str, path: str, **kw) -> tuple[int, float, dict | list | None]:
    t0 = time.time()
    data = None
    headers = {}
    if "json" in kw:
        data = json.dumps(kw["json"]).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8")
            code = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        code = exc.code
    except Exception as exc:  # noqa: BLE001
        return 0, (time.time() - t0) * 1000, {"error": str(exc)}
    ms = (time.time() - t0) * 1000
    try:
        body = json.loads(raw)
    except Exception:  # noqa: BLE001
        body = None
    return code, ms, body


def check(cond: bool, msg: str) -> None:
    if not cond:
        issues.append(msg)


for rd in range(1, ROUNDS + 1):
    print(f"\n===== 第 {rd} 轮 =====")

    # 1) health
    code, ms, b = call("GET", "/health")
    print(f"  health    {code} {ms/1000:5.2f}s")
    check(code == 200 and b and b.get("ok") is True, f"R{rd} health 异常: {code} {b}")

    # 2) portfolio
    code, ms, b = call("GET", "/portfolio?fresh=true")
    acct = (b or {}).get("account") or {}
    pos = (b or {}).get("positions") or []
    print(f"  portfolio {code} {ms/1000:5.2f}s  总资产={acct.get('total_asset')} 持仓={len(pos)}")
    check(code == 200, f"R{rd} portfolio HTTP {code}")
    check(isinstance(b, dict) and "account" in b and "positions" in b, f"R{rd} portfolio 结构不对: {b}")
    if pos:
        p = pos[0]
        bad = [k for k in ("symbol", "quantity", "cost_price", "last_price") if not p.get(k)]
        check(not bad, f"R{rd} portfolio 持仓字段为空 {bad}: {p}")
        check(bool(re.fullmatch(r"\d{6}", str(p.get("symbol", "")))), f"R{rd} 持仓代码异常: {p.get('symbol')}")
        mv_sum = sum(float(x.get("market_value") or 0) for x in pos)
        acct_mv = float(acct.get("market_value") or 0)
        check(
            abs(mv_sum - acct_mv) < max(2.0, acct_mv * 0.02),
            f"R{rd} 市值对不上: 持仓合计 {mv_sum} vs 资金页 {acct_mv}",
        )
    for p in pos:
        print(f"            {p.get('symbol')} {p.get('name')} {p.get('quantity')}股 "
              f"成本{p.get('cost_price')} 市价{p.get('last_price')} 盈亏{p.get('pnl')}")

    # 3) orders
    code, ms, b = call("GET", "/orders?fresh=true")
    rows = b or []
    print(f"  orders    {code} {ms/1000:5.2f}s  {len(rows)} 笔")
    check(code == 200, f"R{rd} orders HTTP {code}")
    for o in rows:
        check(bool(re.fullmatch(r"\d{3,}", str(o.get("order_id", "")))), f"R{rd} 委托编号异常: {o}")
        check(o.get("side") in ("买入", "卖出"), f"R{rd} 买卖方向异常: {o.get('side')!r}")
        check(bool(o.get("quantity")), f"R{rd} 委托数量为 0: {o}")
        check("已成" in (o.get("status") or "") or "撤" in (o.get("status") or "")
              or "报" in (o.get("status") or ""), f"R{rd} 委托状态异常: {o.get('status')!r}")

    # 4) trades
    code, ms, b = call("GET", "/trades?fresh=true")
    trs = b or []
    print(f"  trades    {code} {ms/1000:5.2f}s  {len(trs)} 笔")
    check(code == 200, f"R{rd} trades HTTP {code}")
    for t in trs:
        check(bool(re.fullmatch(r"\d+", str(t.get("trade_id", "")))), f"R{rd} 成交编号异常: {t.get('trade_id')!r}")
        check(bool(re.fullmatch(r"\d{6}", str(t.get("symbol", "")))), f"R{rd} 成交代码异常: {t.get('symbol')!r}")
        check(float(t.get("price") or 0) > 0, f"R{rd} 成交价异常: {t}")

    # 5) cancel（不存在的单号，检查能否正确报错、不乱点）
    code, ms, b = call("POST", "/cancel", json={"order_id": "99999999"})
    print(f"  cancel    {code} {ms/1000:5.2f}s  {(b or {}).get('code')}")
    check(code in (400, 404), f"R{rd} cancel 不存在的单应报错，实际 {code} {b}")

    # 6) 下单校验层（数量不是 100 整数倍 → 必须被风控拦下）
    code, ms, b = call(
        "POST", "/orders",
        json={"symbol": "513100", "side": "buy", "price": 1.85, "quantity": 150, "ref_price": 1.85},
    )
    print(f"  order-chk {code} {ms/1000:5.2f}s  {(b or {}).get('code')}")
    check(code == 400 and (b or {}).get("code") == "risk_rejected",
          f"R{rd} 非整手应被拦，实际 {code} {b}")

print("\n" + "=" * 60)
if issues:
    print(f"发现 {len(issues)} 个问题：")
    for i, m in enumerate(issues, 1):
        print(f"{i}. {m}")
else:
    print("没有问题")
