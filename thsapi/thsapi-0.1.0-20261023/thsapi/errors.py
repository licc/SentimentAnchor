"""异常体系：GUI 层异常 → 交易层异常 → HTTP 状态码映射。"""
from __future__ import annotations


class ThsError(Exception):
    """所有自定义异常基类。"""

    http_status = 500
    code = "internal_error"

    def __init__(self, message: str = "", **detail):
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        return {"ok": False, "code": self.code, "message": self.message, "detail": self.detail}


class ClientNotRunning(ThsError):
    http_status = 503
    code = "client_not_running"


class ClientNotLoggedIn(ThsError):
    http_status = 503
    code = "client_not_logged_in"


class UiElementNotFound(ThsError):
    http_status = 504
    code = "ui_element_not_found"


class UiTimeout(ThsError):
    http_status = 504
    code = "ui_timeout"


class UiBusy(ThsError):
    http_status = 429
    code = "ui_busy"


class CopyGuardRequired(ThsError):
    """同花顺对表格复制启用了验证码保护，需要人工在客户端输入验证码。"""

    http_status = 503
    code = "copy_guard_required"


class ClientNeedsAttention(ThsError):
    """客户端弹出需要人工处理的对话框（提示/验证码/升级等）。"""

    http_status = 503
    code = "client_needs_attention"


class OrderRejected(ThsError):
    http_status = 400
    code = "order_rejected"


class RiskRejected(ThsError):
    # 用 400 而不是 422：422 会被 FastAPI 用作请求体校验错误，客户端无法区分
    http_status = 400
    code = "risk_rejected"


class OrderUnknown(ThsError):
    """委托已提交但结果不明（例如回读失败），需要人工确认。"""

    http_status = 502
    code = "order_result_unknown"


class DuplicateOrder(ThsError):
    http_status = 409
    code = "duplicate_client_order_id"


class CancelFailed(ThsError):
    http_status = 400
    code = "cancel_failed"


class OrderNotFound(ThsError):
    """可撤列表和当日委托里都找不到这笔委托（编号错误 / 隔日单）。"""

    http_status = 404
    code = "order_not_found"


class AuthError(ThsError):
    http_status = 401
    code = "unauthorized"
