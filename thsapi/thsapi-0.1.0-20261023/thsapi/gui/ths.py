"""同花顺下单客户端（网上股票交易系统 5.0）GUI 适配器。

设计要点
--------
* **定位控件用 Win32**：UIA 遍历整树约 5-6 秒，Win32 枚举 500 个子窗口只要 50ms。
  先用 win32 拿到控件句柄，再用 UIA 包装该句柄做读写/点击。
* **绝不向 32 位目标进程发送带指针的消息**（如 TVM_GETITEM），否则目标会崩溃。
* **表格读取走剪贴板**（Ctrl+C → TSV）；同花顺偶尔会弹"复制验证码"保护框，
  此时抛 CopyGuardRequired，需要人工在客户端输入验证码。
* 所有操作前确认客户端已登录、无阻塞弹窗。
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from ..errors import (
    CancelFailed,
    ClientNeedsAttention,
    ClientNotLoggedIn,
    CopyGuardRequired,
    OrderNotFound,
    OrderRejected,
    UiElementNotFound,
    UiTimeout,
)
from . import clipboard, winapi
from .controls import (
    activate,
    click,
    find_all,
    find_one,
    send_key,
    set_text,
    set_value,
    text_value,
    wait_until,
)
from .grid import (
    GridData,
    find_blocking_dialog,
    find_grid,
    normalize_headers,
    pick,
    to_float,
    to_int,
)
from .selectors import norm
from .window import ThsWindow

SUCCESS_WORDS = ("委托成功", "委托已成功", "已成功", "下单成功", "已报")
FAIL_WORDS = (
    "失败",
    "不足",
    "超出",
    "错误",
    "废单",
    "不允许",
    "无此",
    "无效",
    "超过",
    "禁止",
)


@dataclass
class DialogResult:
    text: str
    buttons: list[str] = field(default_factory=list)
    hwnd: int = 0


def _looks_garbled(rows: list[list[str]]) -> bool:
    """判断 OCR 结果是否像"拍到半张表 / 列错位"。

    典型特征：整行关键列全空，或"证券代码"列不是 6 位数字（如 "513310中韩"）。
    """
    if not rows:
        return False
    empty_rows = sum(1 for r in rows if r and all(not c for c in r[1:4]))
    if empty_rows >= max(1, len(rows) // 2):
        return True
    for r in rows:
        if len(r) > 1:
            code = (r[1] or "").strip()
            if code and not (code.isdigit() and len(code) == 6):
                return True
            # 有代码但整行内容太少，说明这一行只读到一两个格子（列错位/半张表）
            if code and sum(1 for c in r if c) < 5:
                return True
    return False


class ThsClient:
    def __init__(self, cfg, selectors_config: dict | None = None):
        self.cfg = cfg
        self.win = ThsWindow(title_re=cfg.client.title_re, exe_path=cfg.client.exe_path)
        self.sel = selectors_config or {}
        self.page_settle = cfg.trading.page_settle_ms / 1000.0
        self.action_timeout = cfg.trading.action_timeout_s
        self._cache: dict[str, Any] = {}

    # ------------------------------------------------------------------ #
    # 就绪检查
    # ------------------------------------------------------------------ #
    def ensure_ready(self) -> None:
        if not self.win.exists():
            if self.cfg.client.auto_launch and self.cfg.client.exe_path:
                import subprocess

                subprocess.Popen([self.cfg.client.exe_path], close_fds=True)
                self.win.find(timeout=self.cfg.client.window_timeout_s)
            else:
                self.win.find(timeout=0.1)
        # 先确认已登录再还原窗口：登录前客户端会有一个隐藏的主窗口
        if not self.win.has_tree():
            raise ClientNotLoggedIn("客户端尚未登录：请先在委托下单窗口完成登录")
        self.assert_no_blocking_dialog()
        if self.cfg.client.restore_window:
            self.win.restore()

    def blocking_dialog(self) -> dict | None:
        return find_blocking_dialog(self._pid())

    def _close_covering_overlays(self) -> None:
        """关掉会盖住表格的浮动窗口（如"收益曲线"图表），否则 OCR 会拍到它们。

        只关"没有确认/取消按钮"的图表类窗口，绝不碰委托确认框。
        """
        import ctypes
        from ctypes import wintypes as wt

        u32 = ctypes.WinDLL("user32")
        pid = self._pid()
        for w in winapi.top_level(lambda x, h: x.cls == "#32770" and x.visible):
            if winapi.pid_of(w.hwnd) != pid:
                continue
            try:
                ui = self._wrap(w)
                texts = [c.window_text() or "" for c in ui.descendants(control_type="Text")]
                btns = [b.window_text() or "" for b in ui.descendants(control_type="Button")]
                if any(b.startswith(("确定", "是", "否", "取消")) for b in btns):
                    continue
                if any("收益曲线" in t for t in texts + btns):
                    u32.PostMessageW(wt.HWND(w.hwnd), 0x0010, 0, 0)  # WM_CLOSE
                    time.sleep(0.25)
            except Exception:  # noqa: BLE001
                continue

    def assert_no_blocking_dialog(self) -> None:
        info = self.blocking_dialog()
        if not info:
            return
        text = info.get("text", "")
        if "验证码" in text and ("拷贝" in text or "复制" in text):
            raise CopyGuardRequired(
                "交易客户端触发复制验证码保护，请在客户端输入验证码后重试", dialog=info
            )
        raise ClientNeedsAttention(f"客户端弹出需要人工处理的对话框：{text[:80]}", dialog=info)

    def _pid(self) -> int:
        return winapi.pid_of(self.win.hwnd)

    # ------------------------------------------------------------------ #
    # 控件定位（win32）
    # ------------------------------------------------------------------ #
    def _cells(self) -> list[winapi.Win]:
        return [
            w
            for w in winapi.children(self.win.hwnd)
            if w.visible and w.width > 0 and w.height > 0
        ]

    def _wrap(self, w: winapi.Win):
        from pywinauto import Desktop

        return Desktop(backend="uia").window(handle=w.hwnd)

    def _windows(self) -> list[winapi.Win]:
        return winapi.children(self.win.hwnd)

    # ------------------------------------------------------------------ #
    # 左侧导航
    # ------------------------------------------------------------------ #
    def _tree(self):
        cached = self._cache.get("tree")
        if cached is not None:
            return self._main_or_raise(), cached
        for w in self._windows():
            if w.cls == "SysTreeView32" and w.visible and w.width > 20:
                tree = self._wrap(w)
                self._cache["tree"] = tree
                return self._main_or_raise(), tree
        raise UiElementNotFound("未找到左侧导航树，客户端可能未登录")

    def _tree_items(self, tree) -> list:
        cached = self._cache.get("tree_items")
        if cached:
            return cached
        items = find_all(tree, control_type="TreeItem")
        self._cache["tree_items"] = items
        return items

    def _find_tree_item(self, tree, name: str):
        want = norm(name)

        def _match():
            for it in self._tree_items(tree):
                try:
                    label = norm(it.window_text())
                except Exception:  # noqa: BLE001
                    continue
                if label == want or (want and want in label):
                    return it
            return None

        item = _match()
        if item is None:
            self._cache.pop("tree_items", None)
            item = _match()
        return item

    def nav(self, *names: str, timeout: float | None = None) -> None:
        """切换到左侧导航节点（如 nav("买入")）。"""
        timeout = timeout or self.action_timeout
        deadline = time.time() + timeout
        name = names[-1]
        last_error: Exception | None = None
        while time.time() < deadline:
            _win, tree = self._tree()
            item = self._find_tree_item(tree, name)
            if item is None:
                raise UiElementNotFound(f"导航树中未找到节点 {name!r}")
            # 已经在该页面：跳过点击，省掉一次 UIA 往返
            try:
                if item.is_selected():
                    time.sleep(0.05)
                    self._cache.pop("widgets", None)
                    return
            except Exception:  # noqa: BLE001
                pass
            try:
                item.select()
            except Exception as exc:  # noqa: BLE001 - 选中成功也可能抛 COM 异常
                last_error = exc
            if self._wait_selected(item, 1.0):
                self._cache.pop("widgets", None)
                return
            try:
                self.win.pin_topmost(True)
                item.click_input()
                self.win.pin_topmost(False)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
            if self._wait_selected(item, 1.5):
                self._cache.pop("widgets", None)
                return
            # 切不过去多半是被模态框挡住了（同花顺的委托确认框没有标题，容易被漏判）
            dlg = self.blocking_dialog()
            if dlg:
                raise ClientNeedsAttention(
                    f"客户端被弹窗挡住，无法切换到「{name}」页：{dlg.get('text', '')[:80]}",
                    dialog=dlg,
                )
            self._cache.pop("tree_items", None)
            time.sleep(0.2)
        raise UiElementNotFound(f"导航失败: {name}", error=repr(last_error))

    @staticmethod
    def _wait_selected(item, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if item.is_selected():
                    time.sleep(0.12)  # 等页面渲染
                    return True
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.05)
        return False

    def _main_or_raise(self):
        try:
            return self.win.wrapper()
        except Exception as exc:  # noqa: BLE001
            raise ClientNotLoggedIn(f"无法连接客户端窗口: {exc}") from None

    # ------------------------------------------------------------------ #
    # 资金 / 持仓 / 委托 / 成交
    # ------------------------------------------------------------------ #
    ACCOUNT_LABELS = {
        "total_asset": ("总资产", "总 资 产", "资产总值"),
        "cash_available": ("可用金额", "可用资金", "资金可用"),
        "cash_withdrawable": ("可取金额", "可取资金"),
        "frozen": ("冻结金额", "冻结资金"),
        "market_value": ("股票市值", "证券市值"),
        "pnl_total": ("持仓盈亏", "浮动盈亏"),
        "pnl_today": ("当日盈亏",),
    }

    def read_account(self) -> dict[str, float]:
        self.ensure_ready()
        self.nav("资金股票")
        self._ensure_fresh()
        return self.read_account_current_page()

    def _ensure_fresh(self, max_age: float | None = None) -> None:
        """页面数据超过 max_age 秒就点一次"刷新"。

        同花顺页面不会自动更新，读到的可能是几分钟前的余额；
        对账/下单前必须保证数据够新（实测：入金后不刷新会一直显示旧余额）。
        """
        max_age = max_age if max_age is not None else getattr(self.cfg.trading, "data_max_age_s", 2.0)
        if max_age <= 0:
            return
        if time.time() - getattr(self, "_last_refresh", 0.0) < max_age:
            return
        try:
            self.refresh(wait=True)
        except Exception:  # noqa: BLE001
            pass

    def read_account_current_page(self) -> dict[str, float]:
        cells = self._cells()
        out: dict[str, float] = {}
        for key, labels in self.ACCOUNT_LABELS.items():
            label = winapi.find_by_label(cells, labels, cls=("Static", "Button", "#32770"))
            if label is None:
                out[key] = 0.0
                continue
            value = winapi.find_right_of(cells, label, cls=("Static", "Edit", "Button"))
            out[key] = to_float(value.text) if value is not None else 0.0
        return out

    def _current_grid(self):
        deadline = time.time() + max(3.0, self.action_timeout)
        while time.time() < deadline:
            for w in self._windows():
                if w.cls == "CVirtualGridCtrl" and w.visible and w.width > 50 and w.height > 30:
                    return self._wrap(w)
            time.sleep(0.15)
        raise UiElementNotFound("未找到数据表格控件")

    def refresh(self, wait: bool = True) -> None:
        cells = self._cells()
        btn = winapi.find(cells, cls="Button", contains="刷新") or winapi.find(cells, cls="Button", contains="查询")
        if btn is not None:
            try:
                activate(self._wrap(btn))
            except Exception:  # noqa: BLE001
                send_key("{F5}")
        else:
            send_key("{F5}")
        if wait:
            time.sleep(max(0.3, self.page_settle))

    def _read_grid(self):
        """读当前表格：固定一条路径——截屏 + Windows OCR（不复制、不导出）。

        重试策略也是固定的：最多重试 3 次，仍是半张表就直接返回，
        由上层（服务层）用 _has_symbol 过滤掉无效行。
        """
        self._current_grid()
        from .ocr_table import read_table, repair_name_cells, repair_symbol_cells

        # 刚切页时表格控件可能还没建出来，等一下再找（最多 2 秒）
        rect = None
        for _ in range(5):
            rect = next(
                (w for w in self._windows() if w.cls == "CVirtualGridCtrl" and w.visible),
                None,
            )
            if rect is not None:
                break
            time.sleep(0.4)
        if rect is None:
            raise UiElementNotFound("未找到表格控件（页面可能还在加载，或当前视图不是表格）")
        from pathlib import Path

        out = Path(getattr(self.cfg.trading, "export_dir", "runtime/export"))
        if not out.is_absolute():
            out = Path(__file__).resolve().parents[2] / out
        self.win.pin_topmost(True)
        try:
            # 关掉会盖住表格的浮动图表窗口，再等页面重绘完成
            self._close_covering_overlays()
            time.sleep(0.45)
            table = read_table((rect.left, rect.top, rect.right, rect.bottom), out_dir=out)
            # 最多重拍 1 次（重拍很贵：每次约 1.5~3 秒）
            for _ in range(1):
                if not _looks_garbled(table.rows):
                    break
                time.sleep(0.5)
                table = read_table((rect.left, rect.top, rect.right, rect.bottom), out_dir=out)
            # 补读要放在重拍之后：否则重拍会整表覆盖，把补读结果丢掉
            # 持仓表里小号彩色中文常被认成乱码（黄金ETF → E±ETF），代码也常把 5 认成 S
            table_rect = (rect.left, rect.top, rect.right, rect.bottom)
            repair_symbol_cells(table, table_rect)
            repair_name_cells(table, table_rect)
        finally:
            self.win.pin_topmost(False)
        return GridData(headers=normalize_headers(table.headers), rows=table.rows, source="ocr")

    def positions(self, refresh: bool = False) -> tuple[list[dict[str, str]], dict[str, float]]:
        self.ensure_ready()
        self.nav("资金股票")
        if refresh:
            self.refresh()
        else:
            self._ensure_fresh()
        account = self.read_account_current_page()
        data = self._read_grid()
        rows = data.dicts()

        def _incomplete(rs: list[dict[str, str]]) -> bool:
            """表格没画完的判据：有持仓却读不到市价（且没有市值列可兜底）。"""
            for r in rs:
                qty = to_int(pick(r, "股票余额", "持仓数量"))
                if qty <= 0:
                    continue
                if to_float(pick(r, "市价", "最新价")) <= 0 and to_float(pick(r, "市值")) <= 0:
                    return True
            # 持仓明细合计 vs 资金页市值（持仓视图常没有"市值"列，用 数量×市价 估）
            est = 0.0
            for r in rs:
                qty = to_int(pick(r, "股票余额", "持仓数量"))
                mv = to_float(pick(r, "市值"))
                if mv <= 0 and qty > 0:
                    mv = qty * to_float(pick(r, "市价", "最新价"))
                est += mv
            return bool(rs) and account.get("market_value", 0) > 0 and est <= 0

        for _ in range(1):
            if not _incomplete(rows):
                break
            time.sleep(0.35)
            self.refresh(wait=True)
            data = self._read_grid()
            rows = data.dicts()
        return rows, account

    def orders(self, refresh: bool = False) -> list[dict[str, str]]:
        self.ensure_ready()
        self.nav("当日委托")
        if refresh:
            self.refresh()
        else:
            self._ensure_fresh()
        return self._read_grid().dicts()

    def trades(self, refresh: bool = False) -> list[dict[str, str]]:
        self.ensure_ready()
        self.nav("当日成交")
        if refresh:
            self.refresh()
        else:
            self._ensure_fresh()
        return self._read_grid().dicts()

    # ------------------------------------------------------------------ #
    # 下单页
    # ------------------------------------------------------------------ #
    def _buy_page_labels(self, side: str = "buy") -> dict[str, Any]:
        """下单页标签。买入页和卖出页的标签不同（买入价格 / 卖出价格）。"""
        key = "sell" if side == "sell" else "buy"
        page = (self.sel.get("pages") or {}).get(key) or {}
        if side == "sell":
            price = page.get("price_labels") or ("卖出价格", "委托价格", "价格")
            qty = page.get("qty_labels") or ("卖出数量", "委托数量", "数量")
            available = page.get("available_labels") or ("可卖", "可卖数量", "最大可卖")
            submit = page.get("submit_buttons") or ("卖出",)
        else:
            price = page.get("price_labels") or ("买入价格", "委托价格", "价格")
            qty = page.get("qty_labels") or ("买入数量", "委托数量", "数量")
            available = page.get("available_labels") or ("可买", "可买数量", "最大可买")
            submit = page.get("submit_buttons") or ("买入",)
        return {
            "side": side,
            "code": page.get("code_labels") or ("证券代码", "代码"),
            "price": price,
            "qty": qty,
            "name": page.get("name_labels") or ("证券名称", "名称"),
            "last": page.get("last_labels") or ("现价", "最新价", "当前价"),
            "available": available,
            "submit": submit,
        }

    def _page_wins(self, labels: dict[str, Sequence[str]]) -> dict[str, winapi.Win | None]:
        cells = self._cells()

        def value_of(key: str, types: tuple[str, ...]) -> winapi.Win | None:
            label = winapi.find_by_label(cells, labels[key], cls=("Static", "Button"))
            if label is None:
                return None
            return winapi.find_right_of(cells, label, cls=types)

        wins = {
            "code": value_of("code", ("Edit", "ComboBox")),
            "name": value_of("name", ("Static", "Button")),
            "price": value_of("price", ("Edit",)),
            "qty": value_of("qty", ("Edit",)),
            "last": value_of("last", ("Static", "Button")),
            "available": value_of("available", ("Static", "Button")),
        }
        # 标签法偶发失效（页面重绘 / 标签文本被截断）时，用固定的控件 ID 兜底：
        # 代码 1032、价格 1033、数量 1034、名称 1036（同花顺下单页固定布局）
        fallback = {"code": 1032, "price": 1033, "qty": 1034, "name": 1036}
        for key, cid in fallback.items():
            if wins.get(key) is None:
                wins[key] = winapi.find(cells, ctrl_id=cid)
        return wins

    def page_widgets(self, side: str = "buy") -> dict[str, Any]:
        """返回下单页控件的 UIA 包装。

        每次都重新枚举（~60ms）：缓存 Win 快照会读到旧文本
        （例如代码清空后"证券名称"仍显示上一次的股票名）。
        """
        labels = self._buy_page_labels(side)
        wins = self._page_wins(labels)
        out: dict[str, Any] = {}
        for key, w in wins.items():
            out[key] = self._wrap(w) if w is not None else None
        out["_wins"] = wins
        return out

    def open_buy_page(self, side: str = "buy") -> None:
        self.nav("买入" if side == "buy" else "卖出")
        self._wait_page_ready(side)

    def _wait_page_ready(self, side: str = "buy", timeout: float = 4.0) -> None:
        deadline = time.time() + timeout
        label = "买入" if side == "buy" else "卖出"
        while time.time() < deadline:
            w = self.page_widgets(side)
            if w.get("code") is not None and w.get("price") is not None:
                return
            time.sleep(0.2)
        raise UiElementNotFound(f"{label}页面未加载完成（找不到代码/价格输入框）")

    def _page_state(self, side: str = "buy") -> dict[str, str]:
        wins = self._page_wins(self._buy_page_labels(side))
        available = wins.get("available").text if wins.get("available") else ""
        # "可买/可卖"是动态绘制的 Static，窗口文本常是 '?'，只能截屏识别
        if wins.get("available") is not None and (not available or available.strip() in ("?", "？")):
            try:
                from .ocr_table import read_number

                w = wins["available"]
                num = read_number((w.left, w.top, w.right, w.bottom))
                available = str(int(num)) if num else ""
            except Exception:  # noqa: BLE001
                available = ""
        return {
            "name": (wins.get("name").text if wins.get("name") else ""),
            "last": (wins.get("last").text if wins.get("last") else ""),
            "available": available,
        }

    def _wait_name(self, prev_name: str, timeout: float, edit=None, symbol: str = "", side: str = "buy") -> str:
        """等待"证券名称"可用（清空后重新输入时，名称会从空变成新值）。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            wins = self._page_wins(self._buy_page_labels(side))
            w = wins.get("name")
            cur = (w.text if w else "").strip()
            if cur and any(ch.isalpha() or "\u4e00" <= ch <= "\u9fff" for ch in cur):
                if cur != prev_name:
                    return cur
                if edit is not None and symbol:
                    try:
                        if text_value(edit).strip() == symbol:
                            return cur
                    except Exception:  # noqa: BLE001
                        pass
            time.sleep(0.12)
        return ""

    def fill_code(self, symbol: str, timeout: float = 3.0, side: str = "buy") -> str:
        """填写证券代码，返回页面识别出的证券名称。

        先清空代码框——客户端会同时清空"证券名称"，这样再输入新代码时，
        名称一定是从空变成新值，不会把上一次的名称当成结果。
        （代码框是自绘控件，读不到文本，所以不能靠回读代码判断。）
        """
        widgets = self.page_widgets(side)
        edit = widgets.get("code")
        if edit is None:
            raise UiElementNotFound("未找到证券代码输入框")

        try:
            set_text(edit, "", verify=False)
        except Exception:  # noqa: BLE001
            set_value(edit, "")
        clear_deadline = time.time() + 1.2
        while time.time() < clear_deadline:
            if not self._page_state(side).get("name"):
                break
            time.sleep(0.1)

        set_text(edit, symbol, verify=False)
        name = self._wait_name("", timeout, edit, symbol, side)
        if not name and set_value(edit, symbol):
            name = self._wait_name("", timeout, edit, symbol, side)
        return name

    def _set_field(self, ctrl, value: str | float | int, label: str = "数值") -> bool:
        """写入价格/数量框，并用 OCR 回读校验；两次仍不一致就中止。

        同花顺这几个编辑框对 Ctrl+A 不支持（会变成"追加"而不是"替换"），
        所以统一用「END + 连续退格」清空，再用 OCR 回读校验。

        回读不一致意味着**框里显示的不是我们要下的价**（最常见：价格超出涨跌停，
        客户端把输入夹到允许值，或干脆保留原来的现价）。这种情况绝不能继续提交，
        否则会按界面上的价格成交。
        """
        text = str(value)
        want = float(text)

        def type_once() -> bool:
            # 真实点击一下，确保键盘焦点在这个框上（set_focus 对自绘编辑框不可靠）
            try:
                self.win.pin_topmost(True)
                click(ctrl)
            except Exception:  # noqa: BLE001
                try:
                    ctrl.set_focus()
                except Exception:  # noqa: BLE001
                    pass
            finally:
                try:
                    self.win.pin_topmost(False)
                except Exception:  # noqa: BLE001
                    pass
            try:
                send_key("{END}")
                for _ in range(12):
                    send_key("{BACKSPACE}")
                send_key(text, pause=0.02)
                time.sleep(0.12)
                return True
            except Exception:  # noqa: BLE001
                try:
                    set_text(ctrl, text, verify=False)
                    return True
                except UiElementNotFound:
                    return False

        got = 0.0
        for _attempt in range(2):
            if not type_once():
                return False
            try:
                from .ocr_table import read_number

                r = ctrl.rectangle()
                got = read_number((r.left, r.top, r.right, r.bottom))
            except Exception:  # noqa: BLE001
                # 读不到（OCR 异常）时不阻断：保持原来的宽松行为
                return True
            if got and abs(got - want) <= 0.002:
                return True

        if got:
            raise OrderRejected(
                f"{label}写入后回读不一致：期望 {want:g}，界面显示 {got:g}；已中止，未提交"
                f"（常见原因：价格超出涨跌停被客户端夹住）"
            )
        return True

    def fill_order(self, side: str, price: float, quantity: int) -> dict[str, Any]:
        """只填价格/数量，不点提交。

        拆出来是为了"休市也把单填好、但不提交"：填单本身没有副作用。
        """
        widgets = self.page_widgets(side)
        # 页面可能正在重绘，价格/数量框会短暂消失；最多试 5 次，第 3 次还不行就重新切页
        for attempt in range(5):
            if widgets.get("price") is not None and widgets.get("qty") is not None:
                break
            if attempt == 2:
                try:
                    self.nav("买入" if side == "buy" else "卖出")
                except Exception:  # noqa: BLE001
                    pass
            time.sleep(0.5)
            widgets = self.page_widgets(side)
        price_edit, qty_edit = widgets.get("price"), widgets.get("qty")
        if price_edit is None or qty_edit is None:
            missing = "价格" if price_edit is None else "数量"
            raise UiElementNotFound(f"未找到{missing}输入框（{ '卖出' if side=='sell' else '买入' }页）")
        if price > 0 and not self._set_field(price_edit, f"{price:.3f}", label="委托价格"):
            raise UiElementNotFound("填写委托价格失败")
        if quantity > 0 and not self._set_field(qty_edit, str(quantity), label="委托数量"):
            raise UiElementNotFound("填写委托数量失败")
        return {"price": price, "quantity": quantity}

    def click_submit(self, side: str) -> None:
        """点「买入 / 卖出」按钮，并处理随后的确认框/提示框。"""
        submit_text = "买入" if side == "buy" else "卖出"
        cells = self._cells()
        btn = winapi.find(cells, cls="Button", text=submit_text)
        if btn is None:
            raise UiElementNotFound(f"未找到 {submit_text} 按钮")
        btn_ctrl = self._wrap(btn)
        if not activate(btn_ctrl):
            self.win.pin_topmost(True)
            try:
                click(btn_ctrl)
            finally:
                self.win.pin_topmost(False)
        time.sleep(0.3)

    def submit_prepared(self, side: str, symbol: str = "", quantity: int = 0) -> dict[str, Any]:
        """价格/数量已填好后，只点提交并处理弹窗。"""
        self.click_submit(side)
        result = self._handle_after_submit()
        # 点过"确定"却没看到结果弹窗 → 回读当日委托确认，避免把成功报成失败
        if not result.get("ok") and result.get("confirm_clicked") and symbol:
            result.update(self._verify_submitted(symbol, quantity))
        return result

    def submit(self, side: str, price: float, quantity: int, symbol: str = "") -> dict[str, Any]:
        """填写价格/数量并提交，处理确认框与结果提示框。"""
        self.fill_order(side, price, quantity)
        return self.submit_prepared(side, symbol, quantity)

    def prepare(self, side: str, symbol: str) -> dict[str, Any]:
        self.ensure_ready()
        self.open_buy_page(side)
        name = self.fill_code(symbol, side=side)
        state = self._page_state(side)
        return {
            "symbol": symbol,
            "name": name,
            "last_price": to_float(state.get("last", "")),
            "available": to_int(state.get("available", "")),
            "raw": state,
        }

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        price: float,
        quantity: int,
        order_type: str = "limit",
        remark: str | None = None,
    ) -> dict[str, Any]:
        if order_type != "limit":
            raise OrderRejected("当前版本仅支持限价委托")
        info = self.prepare(side, symbol)
        result = self.submit(side, price, quantity)
        return {
            "name": info["name"],
            "last_price": info["last_price"],
            "available": info["available"],
            "dialog_texts": result["dialog_texts"],
            "contract_no": result["contract_no"],
            "ok": result["ok"],
            "message": result["message"],
        }

    # ------------------------------------------------------------------ #
    # 对话框
    # ------------------------------------------------------------------ #
    def _dialogs(self) -> list[Any]:
        pid = self._pid()
        out = []
        for w in winapi.top_level(lambda win, h: win.cls == "#32770" and win.visible):
            if winapi.pid_of(w.hwnd) != pid:
                continue
            if "网上股票交易系统" in w.text:
                continue
            out.append(self._wrap(w))
        return out

    def _wait_dialog(self, timeout: float = 5.0, exclude: Iterable[int] = ()) -> DialogResult:
        exclude = set(exclude)

        def _probe():
            for d in self._dialogs():
                if d.handle in exclude:
                    continue
                return d
            return None

        dlg = wait_until(_probe, timeout, what="客户端弹窗")
        text_parts = []
        buttons = []
        for c in dlg.descendants():
            try:
                ctype = c.element_info.control_type
                name = (c.window_text() or "").strip()
                if not name:
                    continue
                if ctype in ("Text", "Image"):
                    text_parts.append(name)
                elif ctype in ("Button", "Hyperlink"):
                    buttons.append(name)
            except Exception:  # noqa: BLE001
                continue
        # 自绘弹窗 UIA 可能读不到文字，用 OCR 兜底
        if not text_parts:
            try:
                from .ocr_table import read_text

                r = dlg.rectangle()
                if r.width() > 60 and r.height() > 40:
                    ocr_text = read_text((r.left, r.top, r.right, r.bottom))
                    if ocr_text:
                        text_parts.append(ocr_text)
            except Exception:  # noqa: BLE001
                pass
        return DialogResult(text="\n".join(text_parts), buttons=buttons, hwnd=dlg.handle)

    def _close_dialog(self, dlg_hwnd: int, prefer: Sequence[str] = ("确定", "是", "关闭", "知道了", "OK")) -> bool:
        for d in self._dialogs():
            if d.handle != dlg_hwnd:
                continue
            for name in prefer:
                btn = None
                for c in d.descendants(control_type="Button"):
                    try:
                        if (c.window_text() or "").strip() == name:
                            btn = c
                            break
                    except Exception:  # noqa: BLE001
                        continue
                if btn is not None:
                    try:
                        if not activate(btn):
                            click(btn)
                    except Exception:  # noqa: BLE001
                        send_key("{ENTER}")
                    time.sleep(0.15)
                    return True
            send_key("{ENTER}")
            return True
        return False

    @staticmethod
    def parse_contract_no(text: str) -> str | None:
        m = re.search(r"(?:合同编号|委托编号|合同号|委托号)\s*[:：]?\s*(\d{4,})", text)
        if m:
            return m.group(1)
        m = re.search(r"\b(\d{8,12})\b", text)
        return m.group(1) if m else None

    @staticmethod
    def judge_dialog(text: str) -> str:
        if any(w in text for w in FAIL_WORDS):
            return "failed"
        if any(w in text for w in SUCCESS_WORDS):
            return "success"
        return "unknown"

    def _handle_after_submit(self, timeout: float = 6.0) -> dict[str, Any]:
        info: dict[str, Any] = {
            "dialog_texts": [],
            "contract_no": None,
            "ok": False,
            "message": "",
            "confirm_clicked": False,
        }
        seen: list[int] = []
        deadline = time.time() + timeout
        confirm_clicks = 0
        while time.time() < deadline:
            try:
                dlg = self._wait_dialog(timeout=max(0.2, deadline - time.time()), exclude=seen)
            except UiTimeout:
                break
            seen.append(dlg.hwnd)
            info["dialog_texts"].append(dlg.text)
            verdict = self.judge_dialog(dlg.text)
            contract = self.parse_contract_no(dlg.text)
            if contract:
                info["contract_no"] = contract
            is_confirm = any("确认" in b for b in dlg.buttons) or "确认" in dlg.text
            # 「参数纠正」类提示：价格小数位不对、超涨跌幅等，点"是"会按客户端规范化后的
            # 价格下单，和策略要的价格不一致 —— 必须拒绝，不能当确认框点掉。
            if any(w in dlg.text for w in ("是否继续", "小数部分", "应为", "不符合", "超出涨跌幅")):
                self._close_dialog(dlg.hwnd, ("否", "取消", "关闭"))
                info["ok"] = False
                info["message"] = f"参数被客户端拒绝: {dlg.text}"
                break
            if self.cfg.trading.fast_confirm or not is_confirm:
                if is_confirm and confirm_clicks == 0:
                    confirm_clicks += 1
                    self._close_dialog(dlg.hwnd, ("确定", "确认", "买入", "卖出", "是"))
                    info["confirm_clicked"] = True  # 已经点过"确定"，委托很可能已提交
                    continue
                self._close_dialog(dlg.hwnd)
                if verdict == "success":
                    info["ok"] = True
                if verdict == "failed":
                    info["ok"] = False
                info["message"] = dlg.text
                if verdict != "unknown":
                    break
            else:
                info["message"] = "等待人工确认"
                break
        return info

    def _verify_submitted(self, symbol: str, quantity: int) -> dict[str, Any]:
        """点过确认框但没看到结果弹窗时，回读"当日委托"确认委托是否落地。"""
        try:
            self.nav("当日委托")
            rows = self._order_rows(self._read_grid())
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "message": f"已提交但回读失败: {exc}"}
        for row in rows:
            if pick(row, "证券代码", "代码") == symbol and to_int(pick(row, "委托数量")) == quantity:
                return {
                    "ok": True,
                    "contract_no": pick(row, "合同编号", "委托编号", "合同号"),
                    "message": "已提交（回读当日委托确认）",
                }
        return {"ok": False, "message": "未在当日委托中找到该笔委托"}

    # ------------------------------------------------------------------ #
    # 撤单
    # ------------------------------------------------------------------ #
    @staticmethod
    def _find_order_row(
        rows: list[dict[str, str]], order_id: str | None, symbol: str | None
    ) -> dict[str, str] | None:
        for row in rows:
            if order_id and pick(row, "合同编号", "委托编号", "合同号") == order_id:
                return row
            if symbol and pick(row, "证券代码", "代码") == symbol:
                return row
        return None

    def _lookup_order(
        self, order_id: str | None, symbol: str | None
    ) -> dict[str, str] | None:
        """到「当日委托」里找这笔委托（包含已成/已撤），找不到返回 None。"""
        try:
            rows = self.orders(refresh=False)
        except Exception:  # noqa: BLE001
            return None
        return self._find_order_row(rows, order_id, symbol)

    def cancel(self, order_id: str | None = None, symbol: str | None = None) -> dict[str, Any]:
        """撤单。

        不复制表格：切到撤单页后用 OCR 找到目标委托所在行 → 点中它 → 点"撤单(Del)"。
        可撤列表里没有这笔委托时，去「当日委托」看它是不是已经成交/已撤——
        这种情况本来就"不需要撤"，按成功返回。
        """
        self.ensure_ready()
        self.nav("撤单")
        time.sleep(0.3)
        if not order_id and not symbol:
            raise CancelFailed("缺少合同编号或证券代码")

        rows = self._order_rows(self._read_grid())
        if not self._find_order_row(rows, order_id, symbol):
            info = self._lookup_order(order_id, symbol)
            if info is None:
                raise OrderNotFound(
                    f"未找到委托 {order_id or symbol}：可撤列表和当日委托里都没有这笔委托"
                )
            status = pick(info, "委托状态", "状态", "备注", "委托备注").lstrip(".·• ")
            if "撤" in status or "已成" in status:
                return {
                    "ok": True,
                    "already": True,
                    "message": f"该委托已是「{status}」，无需撤单",
                    "dialog_texts": [],
                }
            raise CancelFailed(f"该委托当前状态为「{status}」，不在可撤列表中")

        self._select_order_row(order_id or "", symbol or "")

        cells = self._cells()
        btn = winapi.find(cells, cls="Button", text="撤单(Del)") or winapi.find(
            cells, cls="Button", contains="撤单"
        )
        if btn is None:
            raise UiElementNotFound("未找到撤单按钮")
        btn_ctrl = self._wrap(btn)
        if not activate(btn_ctrl):
            self.win.pin_topmost(True)
            try:
                click(btn_ctrl)
            finally:
                self.win.pin_topmost(False)
        time.sleep(0.3)
        result = self._handle_after_submit(timeout=4.0)
        text = " ".join(result["dialog_texts"])
        if result["ok"] or any(w in text for w in ("撤单成功", "已撤", "撤单已提交", "委托已撤")):
            return {"ok": True, "message": text or "撤单成功", "dialog_texts": result["dialog_texts"]}

        # 无弹窗：回读可撤列表，确认该委托已消失
        try:
            self.refresh()
            rows = self._order_rows(self._read_grid())
        except Exception as exc:  # noqa: BLE001
            raise CancelFailed(f"已点撤单，但回读校验失败: {exc}") from None
        still = False
        for row in rows:
            if order_id and pick(row, "合同编号", "委托编号", "合同号") == order_id:
                still = True
            elif symbol and pick(row, "证券代码", "代码") == symbol:
                still = True
        if not still:
            return {"ok": True, "message": "撤单已生效（可撤列表中已不存在）", "dialog_texts": result["dialog_texts"]}
        raise CancelFailed(result["message"] or "撤单失败：委托仍在可撤列表中")

    @staticmethod
    def _order_rows(data) -> list[dict[str, str]]:
        """只保留真实委托行（过滤空表和占位行的 "0"）。"""
        rows = []
        for r in data.dicts():
            sym = pick(r, "证券代码", "代码").strip()
            if sym.isdigit() and len(sym) == 6:
                rows.append(r)
        return rows

    def _select_order_row(self, order_id: str, symbol: str) -> None:
        """用 OCR 找到目标行并点击选中（找不到就报错，绝不乱点）。"""
        from pywinauto import mouse

        from .ocr_table import locate_text

        grid_win = next(
            (w for w in self._windows() if w.cls == "CVirtualGridCtrl" and w.visible),
            None,
        )
        if grid_win is None:
            raise CancelFailed("撤单页表格未找到")
        rect = (grid_win.left, grid_win.top, grid_win.right, grid_win.bottom)

        pos = None
        self.win.pin_topmost(True)
        try:
            for needle in (order_id, symbol):
                if not needle:
                    continue
                pos = locate_text(rect, needle)
                if pos is not None:
                    break
        finally:
            self.win.pin_topmost(False)

        if pos is None:
            raise CancelFailed(
                f"在可撤委托列表中没有找到 {order_id or symbol}（OCR 未能定位该行）"
            )
        self.win.pin_topmost(True)
        try:
            mouse.click(coords=pos)
        finally:
            self.win.pin_topmost(False)
        time.sleep(0.2)

    # ------------------------------------------------------------------ #
    # 健康检查
    # ------------------------------------------------------------------ #
    def warmup(self) -> None:
        """启动预热：缓存导航树节点、OCR 引擎，并把资金页刷一遍。

        实测服务刚启动后的前 1~2 次表格读取容易拍到"还没填数"的表，
        这里先把资金页切换+刷新+读一次，让后续请求直接拿到稳定数据。
        """
        self.ensure_ready()
        try:
            _win, tree = self._tree()
            self._tree_items(tree)
        except Exception:  # noqa: BLE001
            pass
        try:
            from .ocr_table import read_table

            grid = next(
                (w for w in self._windows() if w.cls == "CVirtualGridCtrl" and w.visible),
                None,
            )
            if grid is not None:
                self.win.pin_topmost(True)
                try:
                    read_table((grid.left, grid.top, grid.right, grid.bottom))
                finally:
                    self.win.pin_topmost(False)
        except Exception:  # noqa: BLE001
            pass
        try:
            self.nav("资金股票")
            self.refresh(wait=True)
            self.read_account_current_page()
            self._read_grid()
            time.sleep(0.3)
        except Exception:  # noqa: BLE001
            pass

    def health(self) -> dict[str, Any]:
        info: dict[str, Any] = {"client_running": False, "client_logged_in": False}
        if not self.win.exists():
            return info
        info["client_running"] = True
        if not self.win.has_tree():
            return info
        info["client_logged_in"] = True
        dlg = self.blocking_dialog()
        if dlg:
            info["blocking_dialog"] = dlg
        return info
