"""测试 OCR 读表：当日委托 / 资金股票。"""
import sys, time, warnings
from pathlib import Path
warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thsapi.config import load_config
from thsapi.gui import ocr_table, winapi
from thsapi.gui.controls import find_all
from thsapi.gui.window import ThsWindow

cfg = load_config()
tw = ThsWindow(cfg.client.title_re, cfg.client.exe_path)
tw.find(5); tw.restore(); tw.pin_topmost(True)
time.sleep(0.5)
win = tw.wrapper()

for page in ("当日委托", "资金股票"):
    item = next((i for i in win.descendants(control_type="TreeItem") if (i.window_text() or "").startswith(page)), None)
    if item is None:
        print("skip", page); continue
    item.select()
    time.sleep(1.0)
    grid = next((w for w in winapi.children(tw.hwnd) if w.cls == "CVirtualGridCtrl" and w.visible), None)
    if grid is None:
        print(page, "no grid"); continue
    t0 = time.time()
    table = ocr_table.read_table((grid.left, grid.top, grid.right, grid.bottom))
    print(f"\n=== {page} ({time.time()-t0:.2f}s) columns={len(table.columns)}")
    print("headers:", table.headers)
    print("rows:", len(table.rows))
    for r in table.rows[:5]:
        print("  ", r)

tw.pin_topmost(False)
