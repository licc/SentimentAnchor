"""Dump the UI tree of the THS order client (xiadan.exe) to a text file.

Usage:
    python tools/dump_ui.py                 # UIA backend, depth 4
    python tools/dump_ui.py --backend win32 --depth 3
"""
import argparse
import io
import sys
import warnings

warnings.filterwarnings("ignore")

from pywinauto import Desktop
from pywinauto.application import Application

TITLE_RE = ".*网上股票交易系统.*"


def get_main_window(backend: str):
    """Locate the order-client main window.

    The client is a 32-bit MFC app; enumerating the desktop and filtering by
    title is the most reliable way to grab the top-level window handle.
    """
    for w in Desktop(backend=backend).windows():
        if "网上股票交易系统" in (w.window_text() or ""):
            app = Application(backend=backend).connect(handle=w.handle)
            return app, app.top_window()
    app = Application(backend=backend).connect(title_re=TITLE_RE, timeout=10)
    return app, app.top_window()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth", type=int, default=4)
    ap.add_argument("--backend", default="uia", choices=["uia", "win32"])
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or f"tools/ui_tree_{args.backend}.txt"

    app, win = get_main_window(args.backend)

    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        print("=" * 100)
        print("HANDLE", win.handle, "TITLE", win.window_text())
        win.print_control_identifiers(depth=args.depth)
    finally:
        sys.stdout = old

    text = buf.getvalue()
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote {len(text)} chars / {text.count(chr(10))} lines to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
