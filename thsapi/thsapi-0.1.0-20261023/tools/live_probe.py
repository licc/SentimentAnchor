"""实时联调：用 ThsClient 的真实方法跑一遍只读流程（不会下单）。"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import load_config  # noqa: E402
from thsapi.gui.ths import ThsClient  # noqa: E402


def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "600000"
    cfg = load_config()
    c = ThsClient(cfg)

    print("[1] ensure_ready")
    c.ensure_ready()
    print("    ok, hwnd=", c.win.hwnd, "title=", c.win.wrapper().window_text())

    print("[2] prepare(buy, %s)" % symbol)
    info = c.prepare("buy", symbol)
    print("   ", json.dumps(info, ensure_ascii=False))

    print("[3] page state")
    print("   ", json.dumps(c._page_state(), ensure_ascii=False))

    print("[4] positions")
    rows, account = c.positions()
    print("    account:", json.dumps(account, ensure_ascii=False))
    print("    rows:", len(rows))
    for r in rows[:5]:
        print("     ", json.dumps(r, ensure_ascii=False)[:300])

    print("[5] orders")
    orders = c.orders()
    print("    rows:", len(orders))
    for r in orders[:5]:
        print("     ", json.dumps(r, ensure_ascii=False)[:300])

    print("[6] trades")
    trades = c.trades()
    print("    rows:", len(trades))
    for r in trades[:5]:
        print("     ", json.dumps(r, ensure_ascii=False)[:300])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
