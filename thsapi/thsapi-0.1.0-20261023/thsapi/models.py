"""API 数据模型（Pydantic v2）。"""
from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"

    @property
    def cn(self) -> str:
        return "买入" if self is Side.BUY else "卖出"


class OrderType(str, Enum):
    LIMIT = "limit"
    """限价（A 股默认）。"""
    MARKET = "market"
    """市价（同花顺"市价委托"下拉框选择）。"""


class OrderStatus(str, Enum):
    PENDING = "pending"
    """已提交，等待客户端回执。"""
    ACCEPTED = "accepted"
    """已受理（已报）。"""
    PARTIAL = "partially_filled"
    FILLED = "filled"
    CANCELED = "canceled"
    REJECTED = "rejected"
    UNKNOWN = "unknown"


class OrderRequest(BaseModel):
    symbol: str = Field(..., description="证券代码，如 600000 / 000001 / 510300 / 688981")
    side: Side
    price: float = Field(..., gt=0, description="限价；市价单可填 0 或参考价")
    quantity: int = Field(..., gt=0, description="股数，A 股整手 100 的倍数（科创板 200 起）")
    order_type: OrderType = OrderType.LIMIT
    ref_price: float | None = Field(
        default=None,
        description="调用方参考价（行情系统最新价），用于价格偏离校验；不填则跳过偏离检查",
    )
    client_order_id: str | None = Field(
        default=None, max_length=64, description="调用方幂等 ID；重复提交会返回 409 或原结果"
    )
    remark: str | None = Field(default=None, max_length=64)

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, v: str) -> str:
        v = str(v).strip().upper()
        v = re.sub(r"^(SH|SZ|BJ)\.?", "", v)
        if not re.fullmatch(r"\d{6}", v):
            raise ValueError("证券代码必须是 6 位数字")
        return v

    @field_validator("price")
    @classmethod
    def _price(cls, v: float) -> float:
        return round(float(v), 3)

    @model_validator(mode="after")
    def _market_price(self) -> "OrderRequest":
        if self.order_type is OrderType.MARKET and self.price <= 0:
            self.price = 0.0
        return self

    @property
    def amount(self) -> float:
        return round(self.price * self.quantity, 2)


class OrderResult(BaseModel):
    ok: bool = True
    order_id: str | None = Field(default=None, description="券商合同编号")
    order_key: str = ""
    """对账单号：日期-HHMMSS-合同编号，例如 20261023-093015-12345"""
    client_order_id: str | None = None
    symbol: str | None = None
    side: Side | None = None
    price: float | None = None
    quantity: int | None = None
    status: OrderStatus = OrderStatus.UNKNOWN
    verified: bool = False
    """是否已通过查询接口（当日委托）核实"""
    verify_note: str = ""
    """核实依据/失败原因"""
    message: str = ""
    submitted_at: datetime | None = None
    elapsed_ms: int | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class Position(BaseModel):
    symbol: str
    name: str = ""
    quantity: int = 0
    available: int = 0
    cost_price: float = 0.0
    last_price: float = 0.0
    market_value: float = 0.0
    pnl: float = 0.0
    pnl_pct: float = 0.0
    raw: dict[str, str] = Field(default_factory=dict, exclude=True)


class Account(BaseModel):
    total_asset: float = 0.0
    cash_available: float = 0.0
    cash_withdrawable: float = 0.0
    frozen: float = 0.0
    market_value: float = 0.0
    pnl_today: float = 0.0
    pnl_total: float = 0.0
    currency: str = "CNY"
    updated_at: datetime | None = None
    raw: dict[str, str] = Field(default_factory=dict, exclude=True)


class OrderInfo(BaseModel):
    order_id: str = ""
    symbol: str = ""
    name: str = ""
    side: str = ""
    price: float = 0.0
    quantity: int = 0
    filled: int = 0
    status: str = ""
    time: str = ""
    raw: dict[str, str] = Field(default_factory=dict, exclude=True)


class TradeInfo(BaseModel):
    trade_id: str = ""
    order_id: str = ""
    symbol: str = ""
    name: str = ""
    side: str = ""
    price: float = 0.0
    quantity: int = 0
    amount: float = 0.0
    time: str = ""
    raw: dict[str, str] = Field(default_factory=dict, exclude=True)


class CancelRequest(BaseModel):
    order_id: str | None = Field(default=None, description="合同编号")
    symbol: str | None = Field(default=None, description="按代码撤单（撤该代码全部可撤委托）")

    @model_validator(mode="after")
    def _need_one(self) -> "CancelRequest":
        if not self.order_id and not self.symbol:
            raise ValueError("order_id 与 symbol 至少提供一个")
        return self


class HealthResponse(BaseModel):
    ok: bool
    client_running: bool
    client_logged_in: bool
    broker: str
    mode: str
    version: str
    now: datetime
    last_order_at: datetime | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
