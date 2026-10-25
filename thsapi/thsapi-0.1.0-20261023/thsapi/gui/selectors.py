"""控件定位策略。

原则：优先用"标签 + 邻近控件"的几何定位，而不是写死 automation id
（客户端升级后 id 可能变化，标签文字相对稳定）。selectors.yaml 可覆盖。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from ..errors import UiElementNotFound
from .controls import describe, find_all, is_visible


def norm(text: str) -> str:
    """归一化标签文字：去空白/冒号/星号，去掉括号里的单位说明（如 "可买(股)"）。"""
    text = re.sub(r"[（(][^)）]*[)）]", "", text or "")
    return re.sub(r"[\s:：*＊]", "", text)


@dataclass
class ElementSpec:
    """一个控件的定位规则。"""

    label: str | None = None
    """邻近标签文字（如 "证券代码"）。"""
    text: str | None = None
    """控件自身文字（按钮）。"""
    automation_id: str | None = None
    control_type: str | None = None
    index: int = 0

    @classmethod
    def from_dict(cls, data: dict | str | None) -> "ElementSpec":
        if data is None:
            return cls()
        if isinstance(data, str):
            return cls(text=data)
        return cls(**data)


def _visible(ctrl) -> bool:
    try:
        return is_visible(ctrl)
    except Exception:  # noqa: BLE001
        return False


def _center(rect) -> tuple[float, float]:
    return ((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)


def _iter_visible(container, control_types: Sequence[str] | None = None):
    try:
        items = container.descendants()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for c in items:
        try:
            ctype = c.element_info.control_type
        except Exception:  # noqa: BLE001
            continue
        if control_types and ctype not in control_types:
            continue
        if not _visible(c):
            continue
        out.append(c)
    return out


def find_label(container, labels: Iterable[str]):
    want = {norm(x) for x in labels}
    for c in _iter_visible(container, ("Text", "Image", "Static")):
        try:
            if norm(c.window_text()) in want:
                return c
        except Exception:  # noqa: BLE001
            continue
    return None


def find_value_right_of(container, labels: Iterable[str], *, types=("Edit", "Text", "Pane", "ComboBox", "Document")):
    """找到标签右侧（同一行）最近的可读控件。"""
    label = find_label(container, labels)
    if label is None:
        return None
    lr = label.rectangle()
    ly = (lr.top + lr.bottom) / 2
    best = None
    best_score = None
    for c in _iter_visible(container, types):
        try:
            r = c.rectangle()
        except Exception:  # noqa: BLE001
            continue
        if r.left < lr.right - 2:
            continue
        cy = (r.top + r.bottom) / 2
        dy = abs(cy - ly)
        if dy > max(12, (lr.bottom - lr.top)):
            continue
        dx = max(0, r.left - lr.right)
        score = (dy, dx)
        if best_score is None or score < best_score:
            best, best_score = c, score
    return best


def find_edit(container, labels: Iterable[str]):
    return find_value_right_of(container, labels, types=("Edit",))


def find_text_value(container, labels: Iterable[str]):
    return find_value_right_of(container, labels, types=("Text", "Pane", "Image"))


def find_button(container, texts: Iterable[str]):
    want = {norm(t) for t in texts}
    for c in _iter_visible(container, ("Button", "Hyperlink", "SplitButton")):
        try:
            if norm(c.window_text()) in want:
                return c
        except Exception:  # noqa: BLE001
            continue
    return None


def find_all_buttons(container, texts: Iterable[str]):
    want = {norm(t) for t in texts}
    out = []
    for c in _iter_visible(container, ("Button",)):
        try:
            if norm(c.window_text()) in want:
                out.append(c)
        except Exception:  # noqa: BLE001
            continue
    return out


def resolve(container, spec: ElementSpec):
    """按 ElementSpec 的顺序尝试：automation_id → 标签邻近 → 文字。"""
    if spec.automation_id:
        got = find_all(container, automation_id=spec.automation_id, control_type=spec.control_type)
        got = [c for c in got if _visible(c)]
        if got:
            return got[min(spec.index, len(got) - 1)]
    if spec.label:
        got = find_value_right_of(container, [spec.label], types=(spec.control_type,) if spec.control_type else None)
        if got is not None:
            return got
        got = find_edit(container, [spec.label])
        if got is not None:
            return got
    if spec.text:
        got = find_button(container, [spec.text])
        if got is not None:
            return got
    raise UiElementNotFound(
        f"未找到控件 {spec}",
        label=spec.label,
        text=spec.text,
        automation_id=spec.automation_id,
    )
