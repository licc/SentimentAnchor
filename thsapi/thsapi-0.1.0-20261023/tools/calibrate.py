"""校准脚本：遍历左侧导航，导出各页面的可见控件，供 selectors.yaml 使用。"""
from __future__ import annotations

import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

from pywinauto import Desktop  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from thsapi.gui.controls import dump_controls, find_all  # noqa: E402

OUT = ROOT / "runtime"
OUT.mkdir(exist_ok=True)


def main_window():
    for w in Desktop(backend="uia").windows():
        if "网上股票交易系统" in (w.window_text() or ""):
            return w
    raise SystemExit("客户端主窗口未找到")


def tree_items(tree):
    return tree.descendants(control_type="TreeItem")


def main() -> int:
    win = main_window()
    try:
        win.set_focus()
    except Exception:  # noqa: BLE001
        pass
    time.sleep(0.4)

    trees = find_all(win, class_name="SysTreeView32")
    if not trees:
        raise SystemExit("导航树未找到")
    tree = trees[0]
    items = tree_items(tree)
    lines = [f"left={it.rectangle().left:5d} name={it.window_text()!r}" for it in items]
    (OUT / "tree.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"tree items: {len(items)} -> runtime/tree.txt")

    pages = sys.argv[1:] or ["买入", "卖出", "撤单", "资金股票", "当日委托", "当日成交"]
    for name in pages:
        target = None
        for it in items:
            label = (it.window_text() or "").strip()
            if label.startswith(name):
                target = it
                break
        if target is None:
            print("skip (not found):", name)
            continue
        try:
            target.click_input()
        except Exception as exc:  # noqa: BLE001
            print("click failed", name, exc)
            continue
        time.sleep(1.0)
        text = dump_controls(main_window())
        path = OUT / f"page_{name}.txt"
        path.write_text(text, encoding="utf-8")
        print(f"{name}: {len(text)} chars, {text.count(chr(10))} lines -> {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
