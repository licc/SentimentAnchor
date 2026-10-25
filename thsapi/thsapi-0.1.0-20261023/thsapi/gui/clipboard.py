"""剪贴板读写（带重试，Windows 剪贴板可能被其他进程短暂占用）。"""
from __future__ import annotations

import time
from typing import Any

try:
    import win32clipboard as _clip
    import win32con as _con
except ImportError:  # pragma: no cover
    _clip = None
    _con = None


class ClipboardError(RuntimeError):
    pass


def _require() -> None:
    if _clip is None:
        raise ClipboardError("需要 pywin32 才能访问剪贴板")


def read_text(retries: int = 10, delay: float = 0.02) -> str:
    _require()
    for _ in range(retries):
        try:
            _clip.OpenClipboard()
            try:
                if _clip.IsClipboardFormatAvailable(_con.CF_UNICODETEXT):
                    return _clip.GetClipboardData(_con.CF_UNICODETEXT)
                if _clip.IsClipboardFormatAvailable(_con.CF_TEXT):
                    data = _clip.GetClipboardData(_con.CF_TEXT)
                    return data.decode("gbk", errors="replace")
                return ""
            finally:
                _clip.CloseClipboard()
        except Exception:  # noqa: BLE001
            time.sleep(delay)
    raise ClipboardError("读取剪贴板失败（被占用）")


def write_text(text: str, retries: int = 10, delay: float = 0.02) -> None:
    _require()
    for _ in range(retries):
        try:
            _clip.OpenClipboard()
            try:
                _clip.EmptyClipboard()
                _clip.SetClipboardData(_con.CF_UNICODETEXT, text)
                return
            finally:
                _clip.CloseClipboard()
        except Exception:  # noqa: BLE001
            time.sleep(delay)
    raise ClipboardError("写入剪贴板失败（被占用）")


def clear(retries: int = 5) -> None:
    _require()
    for _ in range(retries):
        try:
            _clip.OpenClipboard()
            try:
                _clip.EmptyClipboard()
                return
            finally:
                _clip.CloseClipboard()
        except Exception:  # noqa: BLE001
            time.sleep(0.02)


def snapshot() -> Any:
    """尽力保存当前文本内容，用于操作后恢复。"""
    try:
        return read_text()
    except Exception:  # noqa: BLE001
        return None


def restore(value: Any) -> None:
    if value:
        try:
            write_text(value)
        except Exception:  # noqa: BLE001
            pass
