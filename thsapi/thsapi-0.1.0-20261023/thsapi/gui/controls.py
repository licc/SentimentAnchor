"""UIA 控件操作封装：查找、点击、输入、读取。"""
from __future__ import annotations

import io
import re
import sys
import time
from typing import Callable, Iterable, Sequence

from pywinauto import keyboard
from pywinauto.uia_defines import NoPatternInterfaceError

from ..errors import UiElementNotFound, UiTimeout

TEXT_LIKE = {"Text", "Image", "Static"}


def _safe_name(ctrl) -> str:
    try:
        return ctrl.window_text() or ""
    except Exception:  # pragma: no cover
        return ""


def _safe_rect(ctrl):
    try:
        return ctrl.rectangle()
    except Exception:  # pragma: no cover
        return None


def describe(ctrl) -> str:
    info = ctrl.element_info
    return (
        f"<{info.control_type} cls={info.class_name!r} "
        f"name={_safe_name(ctrl)!r} auto={info.automation_id!r}>"
    )


def find_all(
    container,
    *,
    control_type: str | None = None,
    automation_id: str | None = None,
    name: str | None = None,
    name_re: str | None = None,
    class_name: str | None = None,
    depth: int | None = None,
) -> list:
    kwargs = {}
    if control_type:
        kwargs["control_type"] = control_type
    if automation_id:
        kwargs["automation_id"] = automation_id
    if name:
        kwargs["title"] = name
    if class_name:
        kwargs["class_name"] = class_name
    if depth is not None:
        kwargs["depth"] = depth
    try:
        items = container.descendants(**kwargs)
    except Exception:
        return []
    if name_re:
        pat = re.compile(name_re)
        items = [c for c in items if pat.search(_safe_name(c))]
    return items


def find_one(container, **kwargs) -> object | None:
    items = find_all(container, **kwargs)
    return items[0] if items else None


def wait_until(
    predicate: Callable[[], object],
    timeout: float,
    interval: float = 0.1,
    what: str = "条件",
):
    """轮询直到 predicate 返回真值；超时抛 UiTimeout。"""
    deadline = time.time() + timeout
    last_exc: Exception | None = None
    while time.time() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:  # noqa: BLE001 - UI 元素在刷新过程中会瞬时失效
            last_exc = exc
        time.sleep(interval)
    msg = f"等待{what}超时({timeout}s)"
    if last_exc:
        msg += f"，最后一次异常: {last_exc!r}"
    raise UiTimeout(msg)


def wait_for_control(container, timeout: float = 3.0, **kwargs):
    def _probe():
        ctrl = find_one(container, **kwargs)
        if ctrl is not None:
            try:
                if ctrl.is_visible() or ctrl.exists():
                    return ctrl
            except Exception:
                return ctrl
        return None

    try:
        return wait_until(_probe, timeout, what=f"控件 {kwargs}")
    except UiTimeout as exc:
        raise UiElementNotFound(exc.message) from None


def is_visible(ctrl) -> bool:
    try:
        return bool(ctrl.is_visible())
    except Exception:  # pragma: no cover
        return False


def raw_click(x: float, y: float, *, double: bool = False) -> None:
    """原生鼠标点击（绕开 pywinauto click_input 偶发的内部异常）。"""
    import ctypes

    u32 = ctypes.windll.user32
    u32.SetCursorPos(int(x), int(y))
    time.sleep(0.06)
    u32.mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    time.sleep(0.03)
    u32.mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP
    if double:
        time.sleep(0.05)
        u32.mouse_event(0x0002, 0, 0, 0, 0)
        time.sleep(0.03)
        u32.mouse_event(0x0004, 0, 0, 0, 0)


def click(ctrl, *, double: bool = False, retries: int = 2, offset: tuple[int, int] | None = None) -> None:
    """真实鼠标点击（MFC 控件对 UIA Invoke 支持不稳定）。"""
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            ctrl.click_input(double=double, coords=offset)
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt == retries:
                # 最后一次改用原生鼠标事件（pywinauto 的 click_input 在部分环境会抛
                # TypeError: 'NoneType' object is not iterable）
                try:
                    r = ctrl.rectangle()
                    cx = r.left + (offset[0] if offset else r.width() / 2)
                    cy = r.top + (offset[1] if offset else r.height() / 2)
                    raw_click(cx, cy, double=double)
                    return
                except Exception as exc2:  # noqa: BLE001
                    last = exc2
            time.sleep(0.2)
    raise UiElementNotFound(f"点击控件失败: {describe(ctrl)} ({last!r})")


def send_key(keys: str, pause: float = 0.02) -> None:
    keyboard.send_keys(keys, pause=pause)


def activate(ctrl) -> bool:
    """优先用 UIA 模式激活控件（不依赖前台窗口/鼠标坐标）。

    同花顺的 MFC 控件大多支持 Invoke/SelectionItem，因此即使窗口被遮挡也能操作。
    返回 True 表示已通过 UIA 模式触发。
    """
    try:
        ctype = ctrl.element_info.control_type
    except Exception:  # noqa: BLE001
        ctype = ""
    try:
        if ctype in ("TreeItem", "ListItem", "TabItem"):
            ctrl.select()
            return True
        if ctype in ("Button", "MenuItem", "Hyperlink", "SplitButton", "CheckBox", "RadioButton"):
            ctrl.invoke()
            return True
    except Exception:  # noqa: BLE001
        return False
    return False


def click_or_activate(ctrl, tick=None) -> None:
    """先试 UIA 模式，失败再真实点击（tick 用于点击前临时置顶）。"""
    if activate(ctrl):
        return
    if tick:
        tick()
    click(ctrl)


def set_text(ctrl, text: str, *, clear: bool = True, verify: bool = True) -> None:
    """清空并键入文本，模拟人工输入（会触发 EN_CHANGE 联动）。

    优先用 set_focus() 把键盘焦点放到控件上再输键盘（不依赖鼠标坐标，
    窗口被部分遮挡也能用）；set_focus 失败时才退回真实鼠标点击。
    """
    focused = False
    try:
        ctrl.set_focus()
        focused = True
    except Exception:  # noqa: BLE001
        focused = False
    if not focused:
        click(ctrl)
    time.sleep(0.05)
    if clear:
        send_key("^a")
        send_key("{BACKSPACE}")
    if text:
        send_key(text, pause=0.01)
    if verify:
        deadline = time.time() + 1.5
        while time.time() < deadline:
            if text_value(ctrl).replace(" ", "") == text.replace(" ", ""):
                return
            time.sleep(0.05)
        # 不抛异常：部分控件（如代码框）会格式化内容


def set_value(ctrl, text: str) -> bool:
    """通过 UIA ValuePattern 直接写入（不依赖鼠标坐标，窗口被遮挡也能用）。

    注意：某些控件写入后不会触发应用的 EN_CHANGE 逻辑（例如代码联动名称），
    因此调用方仍需回读确认。返回是否写入成功。
    """
    try:
        ctrl.iface_value.SetValue(text)
        return True
    except Exception:  # noqa: BLE001
        pass
    try:
        ctrl.set_edit_text(text)
        return True
    except Exception:  # noqa: BLE001
        return False


def text_value(ctrl) -> str:
    """读取编辑框/文本控件内容。"""
    try:
        return ctrl.get_value()
    except Exception:
        pass
    try:
        return ctrl.window_text()
    except Exception:  # pragma: no cover
        return ""


def invoke(ctrl) -> None:
    try:
        ctrl.invoke()
    except (NoPatternInterfaceError, Exception):  # noqa: BLE001
        click(ctrl)


def dump_controls(container, limit: int = 3000) -> str:
    """把控件树导出为文本，便于校准 selectors.yaml。"""
    rows = []
    try:
        items = container.descendants()
    except Exception:  # pragma: no cover
        items = []
    for c in items[:limit]:
        info = c.element_info
        name = _safe_name(c)
        rect = _safe_rect(c)
        r = f"({rect.left},{rect.top},{rect.right},{rect.bottom})" if rect else "?"
        try:
            vis = "V" if c.is_visible() else "-"
        except Exception:  # pragma: no cover
            vis = "?"
        rows.append(
            f"{vis} {info.control_type:<12} cls={info.class_name!r:<24} auto={info.automation_id!r:<8} "
            f"name={name!r:<30} rect={r}"
        )
    return "\n".join(rows)
