"""处理客户端弹出的委托确认框：打印内容，可选点"是"确认。"""
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pywinauto import Desktop

from thsapi.gui import winapi

confirm = "--confirm" in sys.argv

dialogs = [
    x for x in winapi.top_level(lambda win, h: win.cls == "#32770" and win.visible)
    if "委托确认" in (x.text or "") or x.text == ""
]

for d in dialogs:
    if winapi.pid_of(d.hwnd) != 8364:
        continue
    try:
        ui = Desktop(backend="uia").window(handle=d.hwnd)
        texts = [c.window_text() for c in ui.descendants(control_type="Text")]
        joined = " | ".join(t for t in texts if t)
        if "委托确认" not in joined and "确定" not in joined:
            continue
        print("dialog:", d.hwnd, joined[:300])
        btns = {b.window_text().strip(): b for b in ui.descendants(control_type="Button")}
        print("buttons:", list(btns))
        if confirm:
            target = None
            for name, btn in btns.items():
                if name.startswith("是") or name.startswith("确定"):
                    target = btn
                    break
            if target is not None:
                target.click_input()
                time.sleep(0.8)
                print("clicked confirm")
            else:
                print("no confirm button")
    except Exception as exc:  # noqa: BLE001
        print("err", exc)
