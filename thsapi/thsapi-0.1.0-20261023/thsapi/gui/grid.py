"""表格数据读取：优先复制到剪贴板解析 TSV，失败时回退到 UIA 单元格。

同花顺 5.0 的持仓/委托/成交表格是自绘控件（CVirtualGridCtrl），
UIA 不保证暴露每个单元格，因此剪贴板是主通道。
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Iterable

from ..errors import CopyGuardRequired, UiElementNotFound
from . import clipboard
from .controls import click, find_all, send_key, wait_until


def find_blocking_dialog(pid: int):
    """查找客户端当前弹出的、会挡住操作的模态对话框。

    不能只按标题匹配——同花顺的"委托确认"对话框没有窗口标题（标题是画上去的），
    只靠 "提示/警告" 会漏掉它，于是后续点击全部落在对话框上、看起来像"卡住"。
    这里改成：凡是本进程的可见 #32770（且不是主窗口）都算候选。
    """
    import ctypes
    from ctypes import wintypes as wt

    u32 = ctypes.WinDLL("user32")
    hits: list[int] = []
    enum_proc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def _cb(hwnd, _lparam):
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value != pid or not u32.IsWindowVisible(hwnd):
            return True
        cls = ctypes.create_unicode_buffer(64)
        u32.GetClassNameW(hwnd, cls, 64)
        if cls.value != "#32770":
            return True
        n = u32.GetWindowTextLengthW(hwnd)
        title = ctypes.create_unicode_buffer(n + 1)
        u32.GetWindowTextW(hwnd, title, n + 1)
        if "网上股票交易系统" in title.value:
            return True
        r = wt.RECT()
        u32.GetWindowRect(hwnd, ctypes.byref(r))
        if r.right - r.left < 80 or r.bottom - r.top < 40:
            return True
        hits.append(hwnd)
        return True

    try:
        u32.EnumWindows(enum_proc(_cb), 0)
    except Exception:  # pragma: no cover
        return None
    if not hits:
        return None

    from pywinauto import Desktop

    for hwnd in hits:
        try:
            w = Desktop(backend="uia").window(handle=hwnd)
            texts = []
            for c in w.descendants(control_type="Text"):
                t = (c.window_text() or "").strip()
                if t:
                    texts.append(t)
            buttons = []
            for b in w.descendants(control_type="Button"):
                t = (b.window_text() or "").strip()
                if t:
                    buttons.append(t)
            joined = " ".join(texts)
            if not joined and not buttons:
                continue
            # 必须是"真对话框"：至少有一个确认/取消类按钮。
            # 否则会把资金页的"收益曲线"悬浮面板之类误判成阻塞弹窗。
            if not any(
                b.startswith(("确定", "是", "否", "取消", "关闭", "OK", "Cancel"))
                for b in buttons
            ):
                continue
            return {
                "hwnd": hwnd,
                "title": w.window_text() or "对话框",
                "text": joined,
                "buttons": buttons,
            }
        except Exception:  # noqa: BLE001
            continue
    return None


def ensure_no_copy_guard(grid) -> None:
    try:
        pid = grid.element_info.process_id
    except Exception:  # noqa: BLE001
        return
    info = find_blocking_dialog(pid)
    if info and ("验证码" in info["text"] and ("拷贝" in info["text"] or "复制" in info["text"])):
        raise CopyGuardRequired(
            "交易客户端触发了复制验证码保护，请在客户端弹出的提示框中输入验证码并确定后重试",
            dialog=info,
        )


@dataclass
class GridData:
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    source: str = "clipboard"

    @property
    def empty(self) -> bool:
        return not self.rows

    def dicts(self) -> list[dict[str, str]]:
        out = []
        for row in self.rows:
            item = {}
            for i, cell in enumerate(row):
                key = self.headers[i] if i < len(self.headers) else f"col{i}"
                item[key] = cell
            out.append(item)
        return out


def _clean_cell(cell: str) -> str:
    return cell.replace("\r", "").replace("\n", " ").strip().strip('"')


def parse_tsv(text: str) -> GridData:
    lines = [ln for ln in text.replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return GridData()
    table = [[_clean_cell(c) for c in ln.split("\t")] for ln in lines]
    # 有些版本复制出来第一行是标题/空行
    if table and all(not c for c in table[0]):
        table.pop(0)
    if not table:
        return GridData()
    headers = table[0]
    rows = table[1:]
    # 过滤"合计"汇总行与客户端占位的空行（合同编号/代码全空）
    rows = [r for r in rows if any(c for c in r) and r[0] not in ("合计", "总计")]
    return GridData(headers=headers, rows=rows)


def _copy_via_keys(grid, timeout: float) -> str:
    """点一下表格 → 全选 → 复制，返回剪贴板文本（最多重试两次不同位置）。"""
    for offset in ((12, 34), (60, 70)):
        clipboard.clear()
        try:
            grid.set_focus()
        except Exception:  # noqa: BLE001
            pass
        try:
            click(grid, offset=offset)
        except UiElementNotFound:
            pass
        time.sleep(0.06)
        send_key("^a")
        send_key("^c")
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                text = clipboard.read_text()
            except Exception:  # noqa: BLE001
                text = ""
            if text.strip():
                return text
            time.sleep(0.06)
    return ""


def _copy_via_menu(grid, timeout: float) -> str:
    """右键菜单 → 复制（用 win32 找菜单窗口，避免 UIA 全桌面枚举）。"""
    import ctypes

    from . import winapi

    clipboard.clear()
    try:
        grid.click_input(button="right", coords=(60, 40))
    except Exception:  # noqa: BLE001
        return ""
    time.sleep(0.35)
    try:
        pid = grid.element_info.process_id
        menus = [w for w in winapi.top_level(lambda w, h: w.cls == "#32768") if winapi.pid_of(w.hwnd) == pid]
        for m in menus:
            from pywinauto import Desktop

            mw = Desktop(backend="uia").window(handle=m.hwnd)
            for item in mw.descendants(control_type="MenuItem"):
                name = (item.window_text() or "").strip()
                if name in ("复制", "拷贝", "复制表格"):
                    click(item)
                    break
    except Exception:  # noqa: BLE001
        return ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            text = clipboard.read_text()
        except Exception:  # noqa: BLE001
            text = ""
        if text.strip():
            return text
        time.sleep(0.06)
    return ""


def _cells_via_uia(grid) -> list[list[str]]:
    """把 UIA 暴露的单元格按 y 坐标分组成行。"""
    cells = []
    for c in grid.descendants():
        try:
            ctype = c.element_info.control_type
            if ctype not in ("DataItem", "ListItem", "Text"):
                continue
            name = (c.window_text() or "").strip()
            if not name:
                continue
            r = c.rectangle()
            cells.append((r.top, r.left, name))
        except Exception:  # noqa: BLE001
            continue
    if not cells:
        return []
    cells.sort(key=lambda x: (x[0], x[1]))
    rows: list[list[str]] = []
    current: list[tuple[int, int, str]] = []
    last_top = None
    for top, left, name in cells:
        if last_top is None or abs(top - last_top) <= 4:
            current.append((top, left, name))
        else:
            rows.append([c[2] for c in sorted(current, key=lambda x: x[1])])
            current = [(top, left, name)]
        last_top = top
    if current:
        rows.append([c[2] for c in sorted(current, key=lambda x: x[1])])
    return rows


def read_grid(grid, *, timeout: float = 1.4, allow_uia: bool = True) -> GridData:
    """读取表格。

    * 有数据：Ctrl+A / Ctrl+C 复制整表，解析 TSV；
    * 空表：剪贴板只得到一个单元格文本 → 直接返回空表（不做昂贵的回退）；
    * 剪贴板为空：回退到右键菜单"复制" → 再回退到 UIA 单元格。

    若同花顺弹出"复制验证码"保护框，抛 CopyGuardRequired。
    """
    ensure_no_copy_guard(grid)
    saved = clipboard.snapshot()
    try:
        text = _copy_via_keys(grid, timeout)
        guard = find_blocking_dialog(grid.element_info.process_id)
        if guard and "验证码" in guard["text"]:
            raise CopyGuardRequired(
                "交易客户端触发了复制验证码保护，请在客户端弹出的提示框中输入验证码并确定后重试",
                dialog=guard,
            )
        if text and ("\t" in text or "\n" in text):
            return parse_tsv(text)
        if text:
            # 只有一个单元格 → 表格为空（同花顺空表会提示"当前没有可撤委托单"之类）
            return GridData(headers=[], rows=[], source="clipboard-empty")
        # 剪贴板为空：可能是空表，也可能是复制失败。只有表格暴露了子元素才值得回退，
        # 否则回退也拿不到数据，白白多花几秒。
        try:
            has_children = bool(grid.children())
        except Exception:  # noqa: BLE001
            has_children = False
        if has_children:
            text = _copy_via_menu(grid, timeout)
            if text and ("\t" in text or "\n" in text):
                return parse_tsv(text)
            if allow_uia:
                rows = _cells_via_uia(grid)
                if rows:
                    return GridData(headers=rows[0], rows=rows[1:], source="uia")
        return GridData(source="empty")
    finally:
        clipboard.restore(saved)


def _decode_table(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("gbk", "utf-8", "utf-16", "utf-8-sig"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("gbk", errors="replace")


def export_grid(grid, target: Path, *, timeout: float = 8.0) -> GridData | None:
    """右键 → 保存(S)... → 另存为 → 读文件。

    同花顺对"复制"启用了验证码保护，但"保存"走的是另一条路径，不会触发。
    导出的 .xls 实际是 GBK 编码的 TSV 文本，直接解析即可。
    失败返回 None，由调用方决定是否回退到剪贴板。
    """
    import uuid

    from pywinauto import Desktop, keyboard

    from . import winapi
    from .controls import activate

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / f"{target.stem}_{uuid.uuid4().hex[:8]}{target.suffix}"

    try:
        pid = grid.element_info.process_id
    except Exception:  # noqa: BLE001
        return None

    # 1) 右键表格数据区
    try:
        grid.click_input(button="right", coords=(120, 60))
    except Exception:  # noqa: BLE001
        try:
            grid.click_input(button="right", coords=(40, 40))
        except Exception:  # noqa: BLE001
            return None
    time.sleep(0.35)

    # 2) 菜单里点"保存(S)..."（持仓表的"保存"藏在"更多操作"子菜单里）
    def _menu_items() -> list[tuple[str, object]]:
        items: list[tuple[str, object]] = []
        for w in winapi.top_level(lambda win, h: win.cls in ("#32768",)):
            if winapi.pid_of(w.hwnd) != pid:
                continue
            try:
                mw = Desktop(backend="uia").window(handle=w.hwnd)
                for it in mw.descendants(control_type="MenuItem"):
                    t = (it.window_text() or "").strip()
                    if t:
                        items.append((t, it))
            except Exception:  # noqa: BLE001
                continue
        return items

    def _find_save(items):
        return next((it for t, it in items if t.startswith("保存")), None)

    save_item = _find_save(_menu_items())
    if save_item is None:
        more = next((it for t, it in _menu_items() if "更多操作" in t or t == "更多"), None)
        if more is not None:
            try:
                if not activate(more):
                    more.click_input()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.5)
            save_item = _find_save(_menu_items())

    if save_item is None:
        try:
            keyboard.send_keys("{ESC}")
        except Exception:  # noqa: BLE001
            pass
        return None

    try:
        if not activate(save_item):
            save_item.click_input()
    except Exception:  # noqa: BLE001
        return None

    # 3) 另存为对话框
    dlg_win = None
    deadline = time.time() + timeout
    while time.time() < deadline:
        for w in winapi.top_level(lambda win, h: win.cls == "#32770" and win.visible):
            if "另存为" in w.text or "Save As" in w.text:
                dlg_win = w
                break
        if dlg_win is not None:
            break
        time.sleep(0.2)
    if dlg_win is None:
        return None

    try:
        dlg = Desktop(backend="uia").window(handle=dlg_win.hwnd)
        edits = dlg.descendants(control_type="Edit")
        name_edit = next((e for e in edits if e.automation_id() == "1001"), edits[-1] if edits else None)
        if name_edit is None:
            return None
        name_edit.set_focus()
        name_edit.set_edit_text(str(tmp))
        time.sleep(0.25)
        btns = {b.window_text().strip(): b for b in dlg.descendants(control_type="Button")}
        btn = btns.get("保存(S)") or btns.get("保存") or btns.get("Save")
        if btn is None:
            for key in ("取消",):
                if key in btns:
                    btns[key].click_input()
            return None
        btn.click_input()

        # 4) 等文件落盘
        deadline = time.time() + timeout
        while time.time() < deadline:
            if tmp.exists() and tmp.stat().st_size > 0:
                time.sleep(0.15)
                text = _decode_table(tmp)
                data = parse_tsv(text)
                data.source = "export"
                return data
            time.sleep(0.2)
        return None
    except Exception:  # noqa: BLE001
        return None
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:  # noqa: BLE001
            pass


def find_grid(container, *, automation_id: str | None = None, index: int = 0):
    """定位表格控件（同花顺的 CVirtualGridCtrl 在 UIA 里是 Pane/Custom 类型）。"""
    candidates = []
    for cls in ("CVirtualGridCtrl", "CGridCtrl", "SysListView32", "DataGridCtrl"):
        candidates.extend(find_all(container, class_name=cls))
    if automation_id:
        candidates.extend(find_all(container, automation_id=automation_id))
    visible = []
    seen = set()
    for c in candidates:
        try:
            key = c.element_info.runtime_id
        except Exception:  # noqa: BLE001
            continue
        if key in seen:
            continue
        seen.add(key)
        try:
            if not c.is_visible():
                continue
        except Exception:  # noqa: BLE001
            continue
        visible.append(c)
    if not visible:
        return None
    if automation_id:
        for c in visible:
            try:
                if str(c.element_info.automation_id) == str(automation_id):
                    return c
            except Exception:  # noqa: BLE001
                continue
    return visible[min(index, len(visible) - 1)]


# --------------------------------------------------------------------------- #
# 表头归一化（OCR 会认错个别字，如 合同编号→台同编号、价格→伯格）
# --------------------------------------------------------------------------- #
HEADER_VOCAB = [
    "委托时间", "证券代码", "证券名称", "操作", "备注", "委托数量", "成交数量",
    "委托价格", "成交均价", "撤销数量", "合同编号", "交易市场", "股票余额",
    "可用余额", "冻结数量", "成本价", "市价", "盈亏", "盈亏比", "当日盈亏",
    "当日盈亏比", "市值", "仓位占比", "序号", "成交时间", "成交金额", "成交编号",
    "委托状态", "状态", "买卖标志",
]


HEADER_FIXES = {
    "市伯": "市价",
    "成本伯": "成本价",
    "委托里": "委托数量",
    "成交里": "成交数量",
    "撒消里": "撤销数量",
    "撤消里": "撤销数量",
    "台同编号": "合同编号",
    "东结里": "冻结数量",
    "冻结里": "冻结数量",
    "备": "备注",
    "证券代码": "证券代码",
}


def normalize_headers(headers: list[str], threshold: float = 0.6) -> list[str]:
    """把 OCR 认错的表头拉回已知词表。

    先查人工整理的"高频误读表"（市伯→市价），再用编辑距离兜底；
    短词（≤3 字）允许更宽的阈值，否则"市伯/市价"这种 2 字词永远过不了。
    同一名称不重复占用。
    """
    import difflib

    used: set[str] = set()
    out: list[str] = []
    for h in headers:
        name = (h or "").strip()
        if not name:
            out.append("")
            continue
        fixed = HEADER_FIXES.get(name)
        if fixed and fixed not in used:
            used.add(fixed)
            out.append(fixed)
            continue
        if name in HEADER_VOCAB and name not in used:
            used.add(name)
            out.append(name)
            continue
        best, score = name, 0.0
        for vocab in HEADER_VOCAB:
            if vocab in used:
                continue
            r = difflib.SequenceMatcher(None, name, vocab).ratio()
            if r > score:
                best, score = vocab, r
        ok = score >= threshold or (len(name) <= 3 and score >= 0.5 and best[:1] == name[:1])
        if ok and best not in used:
            used.add(best)
            out.append(best)
        else:
            out.append(name)
    return out

_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def to_float(value: str, default: float = 0.0) -> float:
    if value is None:
        return default
    s = str(value).strip().replace(",", "").replace("%", "").replace("元", "")
    if not s or s in ("-", "--", "—"):
        return default
    m = _NUM_RE.search(s)
    if not m:
        return default
    try:
        return float(m.group())
    except ValueError:  # pragma: no cover
        return default


def to_int(value: str, default: int = 0) -> int:
    return int(to_float(value, default))


def pick(row: dict[str, str], *names: str, default: str = "") -> str:
    """按候选表头名取单元格（容忍表头空格/换行/近义词）。

    匹配顺序：去空白后完全相等 → 前缀包含 → 前两字与末字相同
    （用于兼容"合同编号"/"合同号"、"成交金额"/"成交额"这类写法差异）。
    """
    norm = {k.replace(" ", "").replace("\n", ""): v for k, v in row.items()}
    keys = list(norm)

    def _find(name: str) -> str | None:
        key = name.replace(" ", "").replace("\n", "")
        if key in norm:
            return norm[key]
        for k in keys:
            if key in k:
                return norm[k]
        if len(key) >= 2:
            for k in keys:
                if len(k) >= 2 and k[0] == key[0] and k[1] == key[1] and k[-1] == key[-1]:
                    return norm[k]
        return None

    for name in names:
        got = _find(name)
        if got is not None:
            return got
    return default
