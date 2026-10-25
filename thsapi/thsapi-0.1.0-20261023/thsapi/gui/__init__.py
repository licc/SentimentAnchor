"""GUI 自动化基础层（同花顺下单客户端，MFC 32 位程序）。

注意：目标进程是 32 位 MFC 程序，跨进程 SendMessage 传指针（如 TVM_GETITEM）
会导致目标崩溃。因此本层统一使用 UI Automation(pywinauto uia 后端) 与
键盘/剪贴板，不向目标进程发送带指针的自定义消息。
"""
from .window import ThsWindow  # noqa: F401
