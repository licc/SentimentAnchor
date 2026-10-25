"""验证：客户端有模态框时，导航是否快速失败并给出明确原因。"""
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pywinauto import Desktop, mouse

from thsapi.config import load_config
from thsapi.errors import ClientNeedsAttention
from thsapi.gui import winapi
from thsapi.gui.ths import ThsClient

cfg = load_config()
c = ThsClient(cfg)
c.ensure_ready()

# 1) 打开一个无害的模态框：系统按钮右端 -> 系统设置
btn = next(
    (b for b in c.win.wrapper().descendants(control_type="SplitButton") if "系统" in (b.window_text() or "")),
    None,
)
r = btn.rectangle()
mouse.click(coords=(r.right - 5, r.top + r.height() // 2))
time.sleep(0.8)
item = None
for w in winapi.top_level(lambda x, h: x.cls == "#32768" and x.visible):
    if winapi.pid_of(w.hwnd) != winapi.pid_of(c.win.hwnd):
        continue
    mw = Desktop(backend="uia").window(handle=w.hwnd)
    for it in mw.descendants(control_type="MenuItem"):
        if (it.window_text() or "").strip() == "系统设置":
            item = it
            break
    if item:
        break
if item is None:
    print("无法打开系统设置，跳过")
    raise SystemExit(0)

item.click_input()
time.sleep(1.5)

# 2) 此时 系统设置 对话框会挡住主界面
try:
    c.nav("当日委托", timeout=6)
    print("!! 不应该执行到这里（导航居然成功了）")
except ClientNeedsAttention as exc:
    print("✅ 快速失败:", exc.message[:100])
except Exception as exc:  # noqa: BLE001
    print("其他异常:", type(exc).__name__, exc)

# 3) 关掉设置窗口
for w in winapi.top_level(lambda x, h: x.cls == "#32770" and x.visible):
    if winapi.pid_of(w.hwnd) != winapi.pid_of(c.win.hwnd):
        continue
    try:
        dlg = Desktop(backend="uia").window(handle=w.hwnd)
        btns = {b.window_text().strip(): b for b in dlg.descendants(control_type="Button")}
        if "取消" in btns:
            print("关闭对话框:", w.hwnd, "取消")
            btns["取消"].click_input()
            time.sleep(0.5)
    except Exception:  # noqa: BLE001
        pass
