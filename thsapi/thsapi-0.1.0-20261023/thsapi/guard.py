"""风控与交易规则校验。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any, Callable

from .errors import RiskRejected
from .models import OrderRequest, Side

SH_OPEN_AM = time(9, 15)
SH_CLOSE_AM = time(11, 30)
SH_OPEN_PM = time(13, 0)
SH_CLOSE_PM = time(15, 0)


def board_of(symbol: str) -> str:
    if symbol.startswith("688") or symbol.startswith("689"):
        return "star"
    if symbol.startswith(("300", "301")):
        return "chinext"
    if symbol.startswith(("8", "4", "9")):
        return "bse"
    if symbol.startswith("5"):
        return "fund"
    return "main"


def lot_rule(symbol: str) -> tuple[int, int]:
    """返回 (最小股数, 递增单位)。"""
    board = board_of(symbol)
    if board == "star":
        return 200, 1
    if board == "bse":
        return 100, 1
    return 100, 100


def is_trading_time(now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if now.weekday() >= 5:
        return False
    t = now.time()
    return (SH_OPEN_AM <= t <= SH_CLOSE_AM) or (SH_OPEN_PM <= t <= SH_CLOSE_PM)


@dataclass
class GuardContext:
    """风控所需的外部信息（来自下单页面或行情）。"""

    name: str = ""
    last_price: float = 0.0
    available: int = 0


class RiskGuard:
    def __init__(self, cfg, trading_cfg=None):
        self.cfg = cfg
        self.trading_cfg = trading_cfg

    # ------------------------------------------------------------------ #
    # 静态校验（不访问 GUI）
    # ------------------------------------------------------------------ #
    def validate_request(self, req: OrderRequest) -> None:
        cfg = self.cfg
        if not cfg.symbol_allowed(req.symbol):
            raise RiskRejected(f"证券 {req.symbol} 不在允许交易范围（白名单/黑名单）")
        min_qty, step = lot_rule(req.symbol)
        if req.quantity < min_qty:
            raise RiskRejected(f"{req.symbol} 最小委托数量为 {min_qty} 股")
        if step > 1 and req.quantity % step != 0:
            raise RiskRejected(f"{req.symbol} 委托数量必须是 {step} 的整数倍")
        if req.quantity > cfg.max_quantity:
            raise RiskRejected(f"委托数量 {req.quantity} 超过上限 {cfg.max_quantity}")
        if req.order_type.value == "limit" and req.price <= 0:
            raise RiskRejected("限价委托必须给出价格")
        amount = req.amount
        if cfg.max_order_amount and amount > cfg.max_order_amount:
            raise RiskRejected(
                f"单笔委托金额 {amount:,.2f} 超过上限 {cfg.max_order_amount:,.2f}"
            )

    def check_submit_window(self) -> None:
        """提交前置检查：是否在交易时段。

        放在"填单完成、点提交之前"调用——休市时前面的填单步骤照样会执行，
        这样接口能明确告诉调用方"单已填好，只是没提交"。
        """
        if not self.cfg.allow_out_of_hours and not is_trading_time():
            raise RiskRejected(
                "当前不在交易时段（委托单已按要求填好，但未提交；如需放开请设置 safety.allow_out_of_hours=true）"
            )

    # ------------------------------------------------------------------ #
    # 动态校验（拿到现价/可用数量后）
    # ------------------------------------------------------------------ #
    def validate_context(
        self, req: OrderRequest, ctx: GuardContext, *, daily_orders: int = 0, daily_amount: float = 0.0
    ) -> None:
        cfg = self.cfg
        if cfg.reject_st and ("ST" in ctx.name.upper() or "退" in ctx.name):
            raise RiskRejected(f"{req.symbol} {ctx.name} 属于 ST/退市风险股，已拒绝")
        # 价格偏离校验：优先用调用方给的参考价，其次用下单页面的现价
        ref = req.ref_price if req.ref_price and req.ref_price > 0 else ctx.last_price
        if (
            ref > 0
            and self.trading_cfg
            and self.trading_cfg.price_check
            and self.trading_cfg.max_price_deviation_pct
        ):
            dev = abs(req.price - ref) / ref * 100
            if dev > self.trading_cfg.max_price_deviation_pct:
                raise RiskRejected(
                    f"委托价 {req.price} 偏离参考价 {ref:g} {dev:.2f}%，"
                    f"超过阈值 {self.trading_cfg.max_price_deviation_pct}%"
                )
        if req.side is Side.SELL and ctx.available and req.quantity > ctx.available:
            raise RiskRejected(
                f"卖出数量 {req.quantity} 超过可用持仓 {ctx.available}（{req.symbol} {ctx.name}）"
            )
        if cfg.max_daily_orders and daily_orders >= cfg.max_daily_orders:
            raise RiskRejected(f"当日委托笔数已达上限 {cfg.max_daily_orders}")
        if cfg.max_daily_amount and daily_amount + req.amount > cfg.max_daily_amount:
            raise RiskRejected(
                f"当日委托金额将达 {daily_amount + req.amount:,.2f}，超过上限 {cfg.max_daily_amount:,.2f}"
            )
