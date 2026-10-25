"""验证卖出页控件定位（不会下单）。"""
import json
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import load_config
from thsapi.gui.ths import ThsClient

cfg = load_config()
c = ThsClient(cfg)
t0 = time.time()
info = c.prepare("sell", "513310")
print("prepare sell:", json.dumps(info, ensure_ascii=False), f"{time.time()-t0:.1f}s")

w = c.page_widgets("sell")
wins = w.get("_wins") or {}
for k in ("code", "price", "qty", "name", "available"):
    win = wins.get(k)
    print(f"  {k}: hwnd={win.hwnd if win else None} cls={win.cls if win else None} text={win.text if win else None!r}")
