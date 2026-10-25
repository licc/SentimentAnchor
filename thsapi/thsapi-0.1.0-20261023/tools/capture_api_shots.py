"""为 7 个接口各截一张"操作现场"图，放到 static/shots/。"""
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

OUT = Path(r"D:\jyauto\static\shots")
OUT.mkdir(parents=True, exist_ok=True)

cfg = load_config()
c = ThsClient(cfg)
c.ensure_ready()
c.win.restore()


def shot(name: str) -> None:
    w = winapi.info(c.win.hwnd)
    p = OUT / f"{name}.png"
    ImageGrab.grab(bbox=(w.left, w.top, w.right, w.bottom)).save(p)
    print(f"  {name}.png  {p.stat().st_size//1024} KB")


print("[1] health —— 主界面")
c.nav("资金股票")
time.sleep(0.5)
shot("health")

print("[2] account —— 资金栏")
shot("account")

print("[3] positions —— 持仓表")
c.refresh()
time.sleep(1.0)
shot("positions")

print("[4] orders —— 当日委托")
c.nav("当日委托")
time.sleep(0.8)
c.refresh()
time.sleep(1.0)
shot("orders")

print("[5] trades —— 当日成交")
c.nav("当日成交")
time.sleep(0.8)
c.refresh()
time.sleep(1.0)
shot("trades")

print("[6] POST /orders —— 买入页（填好代码/价格/数量，未提交）")
c.nav("买入")
time.sleep(0.6)
c.fill_code("513310", side="buy")
w = c.page_widgets("buy")
wins = w.get("_wins") or {}
if wins.get("price") is not None:
    c._set_field(w["price"], "3.700")
if wins.get("qty") is not None:
    c._set_field(w["qty"], "100")
time.sleep(0.6)
shot("order")

print("[7] POST /cancel —— 撤单页")
c.nav("撤单")
time.sleep(0.8)
shot("cancel")

print("\n全部完成 ->", OUT)
