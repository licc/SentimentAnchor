"""对三类场景分别截图并验证接口读取：查询 / 下单 / 撤单。

只做只读检查，不提交任何委托。
"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import ImageGrab

from thsapi.config import load_config
from thsapi.gui import winapi
from thsapi.gui.ths import ThsClient

OUT = Path(r"D:\jyauto\runtime\shots")
OUT.mkdir(parents=True, exist_ok=True)

cfg = load_config()
c = ThsClient(cfg)
c.ensure_ready()


def shot(name: str) -> Path:
    """截整个客户端窗口。"""
    w = winapi.info(c.win.hwnd)
    p = OUT / f"{name}.png"
    ImageGrab.grab(bbox=(w.left, w.top, w.right, w.bottom)).save(p)
    return p


def scenario(title: str, page: str) -> None:
    print(f"\n=== {title}  (page={page})")
    c.nav(page)
    time.sleep(0.6)
    print("  截图:", shot(page))


# ---------- 场景一：查询 ----------
print("########## 场景 1：查询 ##########")
scenario("查询-资金", "资金股票")
print("  account:", c.read_account_current_page())
rows, _ = c.positions()
print(f"  positions: {len(rows)} 行")
for r in rows[:3]:
    print("   ", r)

scenario("查询-委托", "当日委托")
print("  orders:", len(c._read_grid().dicts()), "行")
for d in c._read_grid().dicts()[:3]:
    print("   ", d)

scenario("查询-成交", "当日成交")
print("  trades:", len(c._read_grid().dicts()), "行")

# ---------- 场景二：下单（只填单，不提交） ----------
print("\n########## 场景 2：下单页 ##########")
for side, page, symbol in (("buy", "买入", "513310"), ("sell", "卖出", "513100")):
    print(f"\n--- {page}页")
    c.nav(page)
    time.sleep(0.4)
    try:
        name = c.fill_code(symbol, side=side)
    except Exception as exc:  # noqa: BLE001
        name = f"<ERR {exc}>"
    time.sleep(0.3)
    print("  填写代码:", symbol, "->", name)
    w = c.page_widgets(side)
    wins = w.get("_wins") or {}
    for k in ("code", "price", "qty", "name", "available"):
        win = wins.get(k)
        print(f"    {k}: {'OK' if win else 'MISSING'} {win.text if win else ''}")
    print("  截图:", shot(f"order_{side}"))

# ---------- 场景三：撤单 ----------
print("\n########## 场景 3：撤单页 ##########")
c.nav("撤单")
time.sleep(0.6)
print("  截图:", shot("cancel"))
cells = c._cells()
for label in ("撤单(Del)", "全撤(Z /)", "撤买(X)", "撤卖(C)", "撤最后(G)"):
    hit = winapi.find(cells, cls="Button", text=label)
    print(f"    {label}: {'OK' if hit else 'MISSING'}")
print("  可撤列表:", len(c._order_rows(c._read_grid())), "行")
