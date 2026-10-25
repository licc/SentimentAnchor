"""配置加载：config.yaml + 环境变量覆盖。

配置文件结构见 config.example.yaml。
环境变量前缀 THSAPI_，支持嵌套（双下划线分隔），例如：
    THSAPI_SERVER__PORT=8902
    THSAPI_TRADING__MODE=live
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator

PROJECT_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# 子配置
# --------------------------------------------------------------------------- #
class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8901
    api_key: str = ""
    """为空表示不校验（仅建议在本机回环地址下使用）。"""
    log_level: str = "INFO"
    docs_enabled: bool = True
    cors_origins: list[str] = Field(default_factory=list)
    request_timeout_s: float = 18.0
    """单个接口的总超时（秒）；超过返回 504，不无限等待。"""
    order_timeout_s: float = 30.0
    """下单/撤单类接口的总超时（秒）。GUI 填单+提交本身就要 10~15 秒，给足余量。"""
    serialize: bool = True
    """串行保护：同一时刻只允许一个接口操作界面，其余排队。"""


class ClientConfig(BaseModel):
    """同花顺下单客户端（xiadan.exe）定位参数。"""

    title_re: str = ".*网上股票交易系统.*"
    exe_path: str = r"C:\同花顺软件\同花顺\xiadan.exe"
    auto_launch: bool = True
    """客户端未运行时是否自动启动（自动启动后仍需人工登录）。"""
    window_timeout_s: float = 15.0
    restore_window: bool = True
    """每次操作前是否把客户端窗口还原并置前（GUI 自动化的必要条件）。"""
    minimize_after_op: bool = False


class TradingConfig(BaseModel):
    mode: Literal["live", "dry_run"] = "live"
    broker: Literal["ths", "mock"] = "ths"
    fast_confirm: bool = True
    """True: 下单后自动确认弹窗；False: 停在确认框等待人工确认。"""
    price_check: bool = True
    """下单前用页面上的"现价"做价格偏离校验。"""
    max_price_deviation_pct: float = 10.0
    verify_after_order: bool = True
    """下单后回读"当日委托"确认委托是否落地。"""
    page_settle_ms: int = 350
    action_timeout_s: float = 8.0
    cache_ttl_s: float = 3.0
    data_max_age_s: float = 2.0
    """页面数据超过这么多秒就先点一次刷新（0=不刷新）。"""
    """查询结果缓存秒数（0=不缓存）。策略高频轮询时能显著降低延迟。"""
    grid_read: Literal["ocr", "export", "clipboard"] = "ocr"
    """表格读取方式：ocr=截屏+系统OCR（不触发验证码，推荐）；export=右键保存；clipboard=Ctrl+C。"""
    grid_fallback_clipboard: bool = False
    """导出失败时是否回退到剪贴板（会触发同花顺复制验证码，建议保持 False）。"""
    export_dir: str = "runtime/export"


class SafetyConfig(BaseModel):
    max_order_amount: float = 100_000.0
    """单笔委托金额上限（元），0 表示不限制。"""
    max_daily_orders: int = 200
    max_daily_amount: float = 500_000.0
    min_interval_ms: int = 300
    """两次委托之间的最小间隔。"""
    allowed_symbols: list[str] = Field(default_factory=list)
    """白名单，空=不限制。支持 600000 与 600xxx 前缀写法。"""
    blocked_symbols: list[str] = Field(default_factory=list)
    allow_out_of_hours: bool = False
    reject_st: bool = True
    max_quantity: int = 1_000_000

    def symbol_allowed(self, symbol: str) -> bool:
        def match(pat: str) -> bool:
            pat = pat.strip().upper()
            if not pat:
                return False
            if pat.endswith("X") or "*" in pat:
                prefix = re.sub(r"[X*]+$", "", pat)
                return symbol.upper().startswith(prefix)
            return symbol.upper() == pat

        if any(match(p) for p in self.blocked_symbols):
            return False
        if not self.allowed_symbols:
            return True
        return any(match(p) for p in self.allowed_symbols)


class JournalConfig(BaseModel):
    enabled: bool = True
    path: str = "data/orders.db"


class AppConfig(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    client: ClientConfig = Field(default_factory=ClientConfig)
    trading: TradingConfig = Field(default_factory=TradingConfig)
    safety: SafetyConfig = Field(default_factory=SafetyConfig)
    journal: JournalConfig = Field(default_factory=JournalConfig)
    selectors_path: str = "selectors.yaml"

    @field_validator("selectors_path")
    @classmethod
    def _v(cls, v: str) -> str:
        return v


# --------------------------------------------------------------------------- #
# 加载
# --------------------------------------------------------------------------- #
def _deep_merge(base: dict, extra: dict) -> dict:
    out = dict(base)
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _coerce(text: str) -> Any:
    low = text.strip().lower()
    if low in ("true", "yes", "on", "1"):
        return True
    if low in ("false", "no", "off", "0"):
        return False
    if low in ("none", "null", ""):
        return None
    try:
        if re.fullmatch(r"-?\d+", text.strip()):
            return int(text)
        if re.fullmatch(r"-?\d*\.\d+", text.strip()):
            return float(text)
    except ValueError:  # pragma: no cover
        pass
    return text


def _apply_env(cfg: dict) -> dict:
    for key, raw in os.environ.items():
        if not key.upper().startswith("THSAPI_"):
            continue
        path = key[len("THSAPI_"):].lower().split("__")
        node = cfg
        for part in path[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):  # pragma: no cover
                break
        else:
            node[path[-1]] = _coerce(raw)
    return cfg


def load_config(path: str | os.PathLike[str] | None = None) -> AppConfig:
    """加载配置；文件缺失时使用默认值。"""
    cfg_path = Path(path) if path else PROJECT_ROOT / "config.yaml"
    if not cfg_path.is_absolute():
        cfg_path = PROJECT_ROOT / cfg_path
    data: dict = {}
    if cfg_path.exists():
        with open(cfg_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    data = _apply_env(data)
    # 路径类字段统一转绝对路径
    journal = data.setdefault("journal", {})
    journal["path"] = str(_abs(journal.get("path", JournalConfig().path)))
    data["selectors_path"] = str(_abs(data.get("selectors_path", AppConfig().selectors_path)))
    return AppConfig.model_validate(data)


def _abs(p: str | os.PathLike[str]) -> Path:
    path = Path(p)
    return path if path.is_absolute() else (PROJECT_ROOT / path)
