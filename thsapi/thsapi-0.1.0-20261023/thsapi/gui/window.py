"""主窗口定位与窗口状态管理。"""
from __future__ import annotations

import ctypes
import re
import time
import warnings
from ctypes import wintypes as wt
from typing import Iterator

from pywinauto import Desktop
from pywinauto.application import Application

from ..errors import ClientNotLoggedIn, ClientNotRunning

warnings.filterwarnings("ignore")

_u32 = ctypes.WinDLL("user32", use_last_error=True)
_k32 = ctypes.WinDLL("kernel32", use_last_error=True)

SW_RESTORE = 9
SW_MINIMIZE = 6
SW_SHOWNOACTIVATE = 4


class ThsWindow:
    """封装"同花顺下单客户端"主窗口。"""

    def __init__(self, title_re: str = ".*网上股票交易系统.*", exe_path: str = ""):
        self.title_re = re.compile(title_re)
        self.exe_path = exe_path
        self._hwnd: int | None = None

    # ------------------------------------------------------------------ #
    # 查找
    # ------------------------------------------------------------------ #
    def _top_level_windows(self) -> Iterator[tuple[int, str, int]]:
        """枚举顶层窗口（win32 枚举，速度比 UIA 快且不受 COM 影响）。"""
        found: list[tuple[int, str, int]] = []
        enum_proc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

        def _cb(hwnd, _lparam):
            length = _u32.GetWindowTextLengthW(hwnd)
            if length:
                buf = ctypes.create_unicode_buffer(length + 1)
                _u32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value
                if self.title_re.search(title):
                    pid = wt.DWORD()
                    _u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    found.append((hwnd, title, pid.value))
            return True

        _u32.EnumWindows(enum_proc(_cb), 0)
        return iter(found)

    def find(self, timeout: float = 5.0) -> tuple[int, str]:
        """等待主窗口出现，返回 (hwnd, title)。

        登录前客户端会先创建一个**隐藏**的主窗口；这种情况下返回隐藏窗口，
        由调用方通过 has_tree() 判断是否已登录，避免误操作未登录的界面。
        """
        deadline = time.time() + timeout
        hidden: tuple[int, str] | None = None
        while True:
            for hwnd, title, _pid in self._top_level_windows():
                visible = bool(_u32.IsWindowVisible(wt.HWND(hwnd))) or bool(
                    _u32.IsIconic(wt.HWND(hwnd))
                )
                if visible:
                    self._hwnd = hwnd
                    return hwnd, title
                if hidden is None:
                    hidden = (hwnd, title)
            if hidden is not None:
                self._hwnd = hidden[0]
                return hidden
            if time.time() >= deadline:
                self._hwnd = None
                raise ClientNotRunning("未找到交易客户端窗口，请确认 xiadan.exe 已启动")
            time.sleep(0.25)

    def exists(self) -> bool:
        if self._hwnd and _u32.IsWindow(wt.HWND(self._hwnd)):
            return True
        self._hwnd = None
        try:
            self.find(timeout=0.2)
            return True
        except ClientNotRunning:
            return False

    # ------------------------------------------------------------------ #
    # 窗口包装
    # ------------------------------------------------------------------ #
    @property
    def hwnd(self) -> int:
        if not self._hwnd:
            self.find()
        assert self._hwnd is not None
        return self._hwnd

    def wrapper(self):
        """返回 UIA 顶层窗口包装对象。"""
        hwnd = self.hwnd
        return Desktop(backend="uia").window(handle=hwnd)

    def app(self) -> Application:
        return Application(backend="uia").connect(handle=self.hwnd, timeout=5)

    # ------------------------------------------------------------------ #
    # 状态
    # ------------------------------------------------------------------ #
    def is_minimized(self) -> bool:
        return bool(_u32.IsIconic(wt.HWND(self.hwnd)))

    def is_visible(self) -> bool:
        return bool(_u32.IsWindowVisible(wt.HWND(self.hwnd)))

    def restore(self) -> None:
        """还原并置前（已经是前台且未最小化时直接跳过，省 ~0.8s）。"""
        hwnd = self.hwnd
        if not _u32.IsIconic(wt.HWND(hwnd)) and _u32.GetForegroundWindow() == hwnd:
            return
        _u32.ShowWindow(wt.HWND(hwnd), SW_RESTORE)
        try:
            _u32.SetForegroundWindow(wt.HWND(hwnd))
        except OSError:  # pragma: no cover - 前台锁
            pass
        if _u32.GetForegroundWindow() != hwnd:
            self._force_foreground(hwnd)
        time.sleep(0.03)

    def _force_foreground(self, hwnd: int) -> None:
        """绕过前台窗口限制。"""
        fg = _u32.GetForegroundWindow()
        cur_tid = _k32.GetCurrentThreadId()
        fg_tid = _u32.GetWindowThreadProcessId(wt.HWND(fg), None) if fg else 0
        target_tid = _u32.GetWindowThreadProcessId(wt.HWND(hwnd), None)
        attached_fg = attached_tg = False
        try:
            if fg_tid and fg_tid != cur_tid:
                attached_fg = bool(_u32.AttachThreadInput(cur_tid, fg_tid, True))
            if target_tid and target_tid != cur_tid:
                attached_tg = bool(_u32.AttachThreadInput(cur_tid, target_tid, True))
            _u32.BringWindowToTop(wt.HWND(hwnd))
            _u32.SetForegroundWindow(wt.HWND(hwnd))
        finally:
            if attached_tg:
                _u32.AttachThreadInput(cur_tid, target_tid, False)
            if attached_fg:
                _u32.AttachThreadInput(cur_tid, fg_tid, False)

    def is_foreground(self) -> bool:
        return _u32.GetForegroundWindow() == self.hwnd

    def minimize(self) -> None:
        _u32.ShowWindow(wt.HWND(self.hwnd), SW_MINIMIZE)

    def pin_topmost(self, on: bool = True) -> None:
        """临时置顶，保证真实鼠标点击/截图不会被其他窗口挡住。

        已经是前台窗口时直接跳过（省 ~0.5s）。
        """
        hwnd = self.hwnd
        if on:
            if _u32.GetForegroundWindow() == hwnd and not _u32.IsIconic(wt.HWND(hwnd)):
                return
        elif not getattr(self, "_pinned", False):
            return

        SWP_NOMOVE = 0x0002
        SWP_NOSIZE = 0x0001
        SWP_SHOWWINDOW = 0x0040
        insert_after = -1 if on else -2  # HWND_TOPMOST / HWND_NOTOPMOST
        _u32.SetWindowPos(
            wt.HWND(hwnd), wt.HWND(insert_after), 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        self._pinned = on
        if on:
            try:
                _u32.SetForegroundWindow(wt.HWND(hwnd))
            except OSError:  # pragma: no cover
                pass
        time.sleep(0.03)

    # ------------------------------------------------------------------ #
    # 登录状态
    # ------------------------------------------------------------------ #
    def has_tree(self) -> bool:
        """主界面是否已加载（左侧导航树存在）。

        用 win32 枚举子窗口判断，比 UIA 遍历整棵控件树快一个数量级，
        也避免同名 TreeView 造成的 AmbiguousError。
        """
        found = {"ok": False}
        enum_proc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

        def _cb(hwnd, _lparam):
            buf = ctypes.create_unicode_buffer(128)
            _u32.GetClassNameW(hwnd, buf, 128)
            if buf.value == "SysTreeView32" and _u32.IsWindowVisible(hwnd):
                found["ok"] = True
                return False
            return True

        try:
            _u32.EnumChildWindows(wt.HWND(self.hwnd), enum_proc(_cb), 0)
        except Exception:  # pragma: no cover
            return False
        return found["ok"]

    def assert_ready(self) -> None:
        if not self.exists():
            raise ClientNotRunning("交易客户端未运行")
        if not self.has_tree():
            raise ClientNotLoggedIn("客户端尚未登录（左侧导航树不存在），请先人工登录")
