"""Win32 控件枚举（比 UIA 整树遍历快 50-100 倍）。

UIA 遍历同花顺主窗口一次约 5-6 秒（150 个元素，跨进程往返），
而 win32 的 EnumChildWindows + GetWindowRect 完成同样的事只需几十毫秒。
因此"找控件"用 win32，"读值/写值/点击"再用 UIA 包装具体控件。
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes as wt
from dataclasses import dataclass
from typing import Iterable

_u32 = ctypes.WinDLL("user32", use_last_error=True)


@dataclass
class Win:
    hwnd: int
    cls: str
    text: str
    ctrl_id: int
    left: int
    top: int
    right: int
    bottom: int
    visible: bool

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top

    @property
    def cx(self) -> float:
        return (self.left + self.right) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2


def info(hwnd: int) -> Win:
    cls = ctypes.create_unicode_buffer(128)
    _u32.GetClassNameW(wt.HWND(hwnd), cls, 128)
    n = _u32.GetWindowTextLengthW(wt.HWND(hwnd))
    text = ctypes.create_unicode_buffer(n + 1)
    _u32.GetWindowTextW(wt.HWND(hwnd), text, n + 1)
    r = wt.RECT()
    _u32.GetWindowRect(wt.HWND(hwnd), ctypes.byref(r))
    return Win(
        hwnd=hwnd,
        cls=cls.value,
        text=text.value.strip(),
        ctrl_id=_u32.GetDlgCtrlID(wt.HWND(hwnd)),
        left=r.left,
        top=r.top,
        right=r.right,
        bottom=r.bottom,
        visible=bool(_u32.IsWindowVisible(wt.HWND(hwnd))),
    )


def children(hwnd: int, limit: int = 4000) -> list[Win]:
    """枚举所有后代窗口（含子控件），速度 ~30ms。"""
    out: list[Win] = []
    cb = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def _cb(h, _l):
        try:
            out.append(info(h))
        except Exception:  # noqa: BLE001
            pass
        return len(out) < limit

    try:
        _u32.EnumChildWindows(wt.HWND(hwnd), cb(_cb), 0)
    except Exception:  # noqa: BLE001
        pass
    return out


def top_level(predicate=None) -> list[Win]:
    out: list[Win] = []
    cb = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def _cb(h, _l):
        try:
            w = info(h)
            if not predicate or predicate(w, h):
                out.append(w)
        except Exception:  # noqa: BLE001
            pass
        return True

    _u32.EnumWindows(cb(_cb), 0)
    return out


def pid_of(hwnd: int) -> int:
    pid = wt.DWORD()
    _u32.GetWindowThreadProcessId(wt.HWND(hwnd), ctypes.byref(pid))
    return pid.value


def find(
    items: Iterable[Win],
    *,
    cls: str | None = None,
    text: str | None = None,
    contains: str | None = None,
    ctrl_id: int | None = None,
    visible: bool | None = True,
) -> Win | None:
    for w in items:
        if visible is not None and w.visible != visible:
            continue
        if cls is not None and w.cls != cls:
            continue
        if ctrl_id is not None and w.ctrl_id != ctrl_id:
            continue
        if text is not None and w.text != text:
            continue
        if contains is not None and contains not in w.text:
            continue
        return w
    return None


def find_all(
    items: Iterable[Win],
    *,
    cls: str | None = None,
    contains: str | None = None,
    visible: bool | None = True,
) -> list[Win]:
    out = []
    for w in items:
        if visible is not None and w.visible != visible:
            continue
        if cls is not None and w.cls != cls:
            continue
        if contains is not None and contains not in w.text:
            continue
        out.append(w)
    return out


def find_right_of(
    items: Iterable[Win], label: Win, *, cls: tuple[str, ...] | None = None, dy_tol: int | None = None
) -> Win | None:
    """在标签右侧同一行找最近的控件。"""
    tol = dy_tol if dy_tol is not None else max(10, label.height)
    best = None
    best_score = None
    for w in items:
        if not w.visible or w.width <= 0 or w.height <= 0:
            continue
        if cls and w.cls not in cls:
            continue
        if w.left < label.right - 2:
            continue
        dy = abs(w.cy - label.cy)
        if dy > tol:
            continue
        score = (dy, w.left - label.right)
        if best_score is None or score < best_score:
            best, best_score = w, score
    return best


def norm_label(text: str) -> str:
    """标签归一化：去掉括号里的单位（"可买(股)"→"可买"）、空格和冒号。"""
    import re

    t = re.sub(r"[（(][^)）]*[)）]", "", text or "")
    return re.sub(r"[\s:：*＊]", "", t)


def find_by_label(items: Iterable[Win], labels: Iterable[str], *, cls: tuple[str, ...] = ("Static", "Button")) -> Win | None:
    want = {norm_label(x) for x in labels}
    for w in items:
        if w.visible and norm_label(w.text) in want and w.cls in cls:
            return w
    return None
