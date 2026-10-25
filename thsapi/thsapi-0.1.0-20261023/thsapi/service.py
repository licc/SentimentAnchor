"""交易服务层：GUI 线程隔离、风控、幂等台账、结果回读。"""
from __future__ import annotations

import contextlib
import logging
import re
import queue
import threading
import time
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .config import AppConfig, load_config
from .errors import (
    CancelFailed,
    ClientNotLoggedIn,
    ClientNotRunning,
    DuplicateOrder,
    OrderRejected,
    OrderUnknown,
    RiskRejected,
    ThsError,
    UiTimeout,
)
from .guard import GuardContext, RiskGuard
from .gui.grid import pick, to_float, to_int
from .gui.ths import ThsClient
from .journal import Journal
from .models import (
    Account,
    HealthResponse,
    OrderInfo,
    OrderRequest,
    OrderResult,
    OrderStatus,
    Position,
    Side,
    TradeInfo,
)

log = logging.getLogger("thsapi.service")
VERSION = "0.1.0"


def _co_init() -> None:
    """占位：COM 由 pywinauto/comtypes 自行初始化。"""
    return None


class MainThreadRunner:
    """把 GUI 操作调度到主线程执行。

    同花顺是 32 位 MFC 程序，UIA 的 IUIAutomation COM 对象是 STA，
    在其他线程调用会阻塞甚至死锁（实测 read_account 会永久挂起），
    因此所有 UIA 调用必须回到创建 COM 对象的主线程。
    """

    def __init__(self) -> None:
        self._q: "queue.Queue[tuple[Callable[[], Any], Future]]" = queue.Queue()
        self._main_ident = threading.main_thread().ident
        self._stopped = threading.Event()

    def run(self, fn: Callable[[], Any], timeout: float = 60.0, what: str = "GUI 操作") -> Any:
        if threading.get_ident() == self._main_ident:
            return fn()
        fut: Future = Future()
        self._q.put((fn, fut))
        try:
            return fut.result(timeout=timeout)
        except FutureTimeout:
            raise UiTimeout(f"{what}超时({timeout:.0f}s)，客户端可能被占用或卡住") from None

    def pump(self, duration: float = 0.05) -> None:
        try:
            fn, fut = self._q.get(timeout=duration)
        except queue.Empty:
            return
        if fut.set_running_or_notify_cancel():
            try:
                fut.set_result(fn())
            except BaseException as exc:  # noqa: BLE001
                fut.set_exception(exc)

    def loop_forever(self) -> None:
        log.info("GUI 主线程调度器已启动")
        while not self._stopped.is_set():
            self.pump(0.1)

    def stop(self) -> None:
        self._stopped.set()


class TradingService:
    def __init__(self, cfg: AppConfig | None = None):
        self.cfg = cfg or load_config()
        self.guard = RiskGuard(self.cfg.safety, self.cfg.trading)
        self.journal = Journal(self.cfg.journal.path) if self.cfg.journal.enabled else None
        self.runner = MainThreadRunner()
        self._client: ThsClient | None = None
        self._selectors = self._load_selectors()
        self._order_lock = threading.Lock()
        self._serial = threading.RLock()
        self._tls = threading.local()
        self._last_submit_ts = 0.0
        self._result_cache: dict[str, tuple[float, Any]] = {}
        self._started_at = datetime.now()
        self._mock_state = _MockState() if self.cfg.trading.broker == "mock" else None

    # ------------------------------------------------------------------ #
    # 基础设施
    # ------------------------------------------------------------------ #
    def _load_selectors(self) -> dict:
        path = Path(self.cfg.selectors_path)
        if not path.exists():
            return {}
        try:
            import yaml

            with open(path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except Exception as exc:  # noqa: BLE001
            log.warning("selectors.yaml 读取失败: %s", exc)
            return {}

    def _get_client(self) -> ThsClient:
        if self._client is None:
            self._client = ThsClient(self.cfg, self._selectors)
        return self._client

    @contextlib.contextmanager
    def _serial_slot(self, limit: float | None = None):
        """串行保护 + 单接口总超时。

        * serialize=True：同一时刻只允许一个接口操作界面，其余排队等锁；
        * 先设截止时间，`_run` 按剩余预算给每次 GUI 操作分配超时，
          整体超过上限就抛 UiTimeout，不再无限等待；
        * limit 可单独指定（下单/撤单用 order_timeout_s，查询用 request_timeout_s）。
        """
        limit = float(limit or self.cfg.server.request_timeout_s or 18.0)
        depth = getattr(self._tls, "depth", 0)
        if depth == 0:
            if self.cfg.server.serialize and not self._serial.acquire(timeout=limit):
                raise UiBusy(f"另一个接口正在执行，等待 {limit:.0f}s 仍未轮到")
            self._tls.start = time.time()
            self._tls.limit = limit
        self._tls.depth = depth + 1
        try:
            yield
        finally:
            self._tls.depth = depth
            if depth == 0 and self.cfg.server.serialize:
                self._serial.release()

    def _is_busy(self) -> bool:
        """当前是否已有接口占着串行槽（health 用，不阻塞）。"""
        if not self.cfg.server.serialize:
            return False
        if self._serial.acquire(blocking=False):
            self._serial.release()
            return False
        return True

    def _remaining_budget(self) -> float:
        limit = float(
            getattr(self._tls, "limit", None) or self.cfg.server.request_timeout_s or 18.0
        )
        # 没有进入串行槽（例如 health）就是全新预算，不受上一个请求影响
        if getattr(self._tls, "depth", 0) == 0:
            return limit
        start = getattr(self._tls, "start", None)
        if start is None:
            return limit
        return limit - (time.time() - start)

    def _run(self, fn: Callable[[ThsClient], Any], *, timeout: float | None = None) -> Any:
        """在主线程执行 GUI 操作（见 MainThreadRunner 说明）。"""
        if self._mock_state is not None:
            return fn(None)  # type: ignore[arg-type]
        timeout = timeout or max(30.0, self.cfg.trading.action_timeout_s * 6)
        budget = self._remaining_budget()
        if budget <= 0.2:
            raise UiTimeout(f"接口执行超过 {self.cfg.server.request_timeout_s:.0f}s 上限")
        timeout = min(timeout, budget)
        return self.runner.run(lambda: self._guarded_call(fn), timeout=timeout)

    def _cached(self, key: str, fn: Callable[[], Any], ttl: float | None = None) -> Any:
        """短 TTL 缓存：策略每秒轮询时不必每次都切页 + OCR。"""
        if ttl is None:
            ttl = getattr(self.cfg.trading, "cache_ttl_s", 0.0)
        if not ttl or ttl <= 0:
            return fn()
        now = time.time()
        hit = self._result_cache.get(key)
        if hit is not None and now - hit[0] < ttl:
            return hit[1]
        value = fn()
        # 时间戳要在调用结束后记录，否则耗时超过 TTL 的请求会"一存就过期"
        self._result_cache[key] = (time.time(), value)
        return value

    def invalidate_cache(self) -> None:
        self._result_cache.clear()

    def _guarded_call(self, fn: Callable[[ThsClient], Any]) -> Any:
        client = self._get_client()
        try:
            return fn(client)
        except ThsError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("GUI 操作异常")
            raise ThsError(f"界面操作失败: {exc}") from exc

    def shutdown(self) -> None:
        self.runner.stop()

    def warmup(self) -> None:
        """服务启动时预热 GUI 侧缓存（导航树、OCR 引擎、列边界）。"""
        if self._mock_state is not None:
            return
        try:
            self._run(lambda c: c.warmup(), timeout=30)
        except Exception as exc:  # noqa: BLE001
            log.warning("预热失败（不影响启动）: %s", exc)

    # ------------------------------------------------------------------ #
    # 只读接口
    # ------------------------------------------------------------------ #
    def health(self) -> HealthResponse:
        if self._mock_state is not None:
            return HealthResponse(
                ok=True,
                client_running=True,
                client_logged_in=True,
                broker="mock",
                mode=self.cfg.trading.mode,
                version=VERSION,
                now=datetime.now(),
                last_order_at=self.journal.last_order_at() if self.journal else None,
            )
        detail: dict[str, Any] = {}
        running = logged = False
        try:
            info = self._run(lambda c: c.health(), timeout=20)
            running = bool(info.get("client_running"))
            logged = bool(info.get("client_logged_in"))
            detail = info
        except Exception as exc:  # noqa: BLE001
            detail = {"error": str(exc)}
        detail = dict(detail or {})
        detail.update(
            {
                "request_timeout_s": self.cfg.server.request_timeout_s,
                "order_timeout_s": self.cfg.server.order_timeout_s,
                "serialize": self.cfg.server.serialize,
                "busy": self._is_busy(),
            }
        )
        return HealthResponse(
            ok=running and logged,
            client_running=running,
            client_logged_in=logged,
            broker="gui",
            mode=self.cfg.trading.mode,
            version=VERSION,
            now=datetime.now(),
            last_order_at=self.journal.last_order_at() if self.journal else None,
            detail=detail,
        )

    def portfolio(self, fresh: bool = True) -> dict[str, Any]:
        """资金 + 持仓：两者都在「资金股票」页，一次切页全部读回。"""
        with self._serial_slot():
            if fresh:
                self._result_cache.pop("portfolio", None)
            if self._mock_state is not None:
                return {
                    "account": self._mock_state.account().model_dump(mode="json", exclude={"raw"}),
                    "positions": [
                        p.model_dump(mode="json", exclude={"raw"})
                        for p in self._mock_state.positions()
                    ],
                }
            positions, account = self._cached(
                "portfolio", self._positions_live, ttl=0 if fresh else 1.0
            )
            return {
                "account": account.model_dump(mode="json", exclude={"raw"}),
                "positions": [p.model_dump(mode="json", exclude={"raw"}) for p in positions],
            }

    def account(self, fresh: bool = True) -> Account:
        if self._mock_state is not None:
            return self._mock_state.account()
        if fresh:
            self._result_cache.pop("account", None)
        return self._cached("account", self._account_live, ttl=0.4 if not fresh else 0)

    def _account_live(self) -> Account:
        raw = self._run(lambda c: c.read_account())
        return _to_account(raw)

    def positions(self, fresh: bool = False) -> tuple[list[Position], Account]:
        if fresh:
            self._result_cache.pop("positions", None)
        if self._mock_state is not None:
            return self._mock_state.positions(), self._mock_state.account()
        return self._cached("positions", self._positions_live)

    def _positions_live(self) -> tuple[list[Position], Account]:
        rows, account_raw = self._run(lambda c: c.positions())
        rows = [r for r in rows if _has_symbol(r)]
        positions = [_to_position(r) for r in rows]
        # 清仓后表格里会留一行数量为 0 的占位行，过滤掉
        positions = [p for p in positions if p.quantity > 0]
        return positions, _to_account(account_raw)

    def orders(self, refresh: bool = False, fresh: bool = False) -> list[OrderInfo]:
        with self._serial_slot():
            if fresh:
                self._result_cache.pop("orders", None)
            if self._mock_state is not None:
                return self._mock_state.orders()
            if refresh:
                self._result_cache.pop("orders", None)
                return self._orders_live(refresh=True)
            return self._cached("orders", lambda: self._orders_live(refresh=False))

    def _orders_live(self, refresh: bool) -> list[OrderInfo]:
        rows = self._run(lambda c: c.orders(refresh=refresh), timeout=60)
        return [_to_order(r) for r in rows if _has_symbol(r)]

    def trades(self, fresh: bool = False) -> list[TradeInfo]:
        with self._serial_slot():
            if fresh:
                self._result_cache.pop("trades", None)
            if self._mock_state is not None:
                return self._mock_state.trades()
            return self._cached("trades", self._trades_live)

    def _trades_live(self) -> list[TradeInfo]:
        rows = self._run(lambda c: c.trades(), timeout=60)
        return [_to_trade(r) for r in rows if _has_symbol(r)]

    def cancel(self, order_id: str | None, symbol: str | None) -> dict[str, Any]:
        with self._serial_slot(self.cfg.server.order_timeout_s):
            if self._mock_state is not None:
                return self._mock_state.cancel(order_id, symbol)
            with self._order_lock:
                result = self._run(
                    lambda c: c.cancel(order_id=order_id, symbol=symbol), timeout=60
                )
            self.invalidate_cache()
            # 操作接口一律用查询接口核实
            verified, note = self._verify_cancelled(order_id, symbol)
            result = dict(result or {})
            result.update({"ok": bool(verified), "verified": verified, "verify_note": note})
            if not verified:
                raise CancelFailed(f"撤单未通过查询核实：{note}")
            return result

    def _verify_cancelled(self, order_id: str | None, symbol: str | None) -> tuple[bool, str]:
        """查询"当日委托"，确认目标委托已经不在（或已成交/已撤，即已不是待撤状态）。"""
        try:
            rows = self.orders(fresh=True)
        except Exception as exc:  # noqa: BLE001
            return False, f"回读当日委托失败: {exc}"
        hits = []
        for r in rows:
            if order_id and r.order_id == order_id:
                hits.append(r)
            elif symbol and r.symbol == symbol:
                hits.append(r)
        if not hits:
            return True, "当日委托中已无该笔委托"
        # 只要不是"还能撤"的状态，就算撤单目标已达成
        alive = [
            r
            for r in hits
            if not any(w in r.status for w in ("已成", "已撤", "废单", "已废"))
        ]
        if not alive:
            return True, f"委托已终结（{hits[0].status}），无需撤单"
        return False, f"委托仍为「{alive[0].status}」"

    # ------------------------------------------------------------------ #
    # 下单
    # ------------------------------------------------------------------ #
    def place_order(self, req: OrderRequest) -> OrderResult:
        """下单入口：串行保护 + 下单专用超时（order_timeout_s）。"""
        with self._serial_slot(self.cfg.server.order_timeout_s):
            return self._place_order_inner(req)

    def _place_order_inner(self, req: OrderRequest) -> OrderResult:
        started = time.time()
        cid = req.client_order_id or _gen_cid()
        req.client_order_id = cid

        # 1) 幂等：只有"确实下出去了"的记录才直接重放
        if self.journal is not None:
            prev = self.journal.get(cid)
            if prev:
                if prev["status"] in ("pending",):
                    raise DuplicateOrder(f"client_order_id={cid} 正在处理中，请勿重复提交")
                if prev["status"] == "accepted":
                    return _replay(prev)
                if prev["status"] == "unknown":
                    # 上次"提交了但没核实到"：先查当日委托，确认是否其实已经下出去
                    verified, note, row = self._verify_placed(req, prev.get("broker_order_id"), started)
                    if verified and row is not None:
                        self.journal.record(
                            client_order_id=cid,
                            symbol=req.symbol,
                            side=req.side.value,
                            price=req.price,
                            quantity=req.quantity,
                            order_type=req.order_type.value,
                            status="accepted",
                            broker_order_id=row.order_id,
                            message=f"补核实成功：{note}",
                            name=req.symbol,
                        )
                        return _replay(self.journal.get(cid) or prev)
                    log.warning("client_order_id=%s 上次状态 unknown 且当日委托中查不到，允许重新下单", cid)
                # rejected / dry_run：什么都没提交，允许用同一个 id 重试
                log.info("client_order_id=%s 上次状态 %s，允许重试", cid, prev["status"])

        # 2) 静态风控
        self.guard.validate_request(req)

        if self._mock_state is not None:
            result = self._mock_state.place(req, started)
            if self.journal is not None:
                self.journal.record(
                    client_order_id=cid,
                    symbol=req.symbol,
                    side=req.side.value,
                    price=req.price,
                    quantity=req.quantity,
                    order_type=req.order_type.value,
                    status="accepted",
                    broker_order_id=result.order_id,
                    message=result.message,
                    name="",
                )
            return result

        return self._live_order(req, cid, started)

    def _live_order(self, req: OrderRequest, cid: str, started: float) -> OrderResult:
        side = req.side.value
        self.invalidate_cache()

        # 卖出前先用查询接口核对可用持仓（页面上的"可卖"读不到，不能只靠页面）
        if req.side is Side.SELL:
            try:
                positions, _acc = self.positions(fresh=True)
                held = next((p for p in positions if p.symbol == req.symbol), None)
                avail = held.available if held else 0
                # 只有"明确读到可卖数量且不够"才拦；读到 0 / 没读到交给客户端兜底
                if avail > 0 and req.quantity > avail:
                    raise RiskRejected(
                        f"可用持仓不足：{req.symbol} 可卖 {avail} 股，请求卖出 {req.quantity} 股"
                    )
                if avail <= 0:
                    log.warning("卖出前未读到 %s 的可用持仓（OCR 可能未就绪），交由客户端校验", req.symbol)
            except RiskRejected:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("卖出前查持仓失败（继续）: %s", exc)

        if self.journal is not None:
            self.journal.record(
                client_order_id=cid,
                symbol=req.symbol,
                side=side,
                price=req.price,
                quantity=req.quantity,
                order_type=req.order_type.value,
                status="pending",
                message="已提交至客户端",
                name="",
            )

        ctx: GuardContext | None = None
        try:
            info = self._run(lambda c: c.prepare(side, req.symbol), timeout=45)
            ctx = GuardContext(
                name=info.get("name", ""),
                last_price=float(info.get("last_price") or 0),
                available=int(info.get("available") or 0),
            )
            daily_orders, daily_amount = self.journal.daily_stats() if self.journal else (0, 0.0)
            self.guard.validate_context(req, ctx, daily_orders=daily_orders, daily_amount=daily_amount)

            # 先把价格/数量真正填进页面（填单本身没有副作用）
            self._run(lambda c: c.fill_order(side, req.price, req.quantity), timeout=30)

            # 交易时段检查放在"填好单之后、点提交之前"：
            # 休市时前面所有步骤照常执行，能确认链路是通的，同时绝不误提交。
            self.guard.check_submit_window()

            if self.cfg.trading.mode == "dry_run":
                result = OrderResult(
                    ok=True,
                    order_id=None,
                    client_order_id=cid,
                    symbol=req.symbol,
                    side=req.side,
                    price=req.price,
                    quantity=req.quantity,
                    status=OrderStatus.ACCEPTED,
                    message="dry_run：未真实下单",
                    raw={"name": ctx.name, "last_price": ctx.last_price},
                )
                self._journal_update(cid, "accepted", None, result.message, ctx.name, result.raw)
                return result

            # 节流
            gap = self.cfg.safety.min_interval_ms / 1000.0
            wait = gap - (time.time() - self._last_submit_ts)
            if wait > 0:
                time.sleep(wait)

            with self._order_lock:
                self._last_submit_ts = time.time()
                raw = self._run(
                    lambda c: c.submit_prepared(side, req.symbol, req.quantity), timeout=90
                )
        except RiskRejected as exc:
            self._journal_update(cid, "rejected", None, exc.message, ctx.name if ctx else "", {})
            raise
        except OrderRejected as exc:
            self._journal_update(cid, "rejected", None, exc.message, ctx.name if ctx else "", {})
            raise
        except Exception as exc:  # noqa: BLE001
            # 提交过程中异常：结果未知，必须人工核对
            self._journal_update(cid, "unknown", None, str(exc), ctx.name if ctx else "", {})
            if isinstance(exc, (ClientNotRunning, ClientNotLoggedIn)):
                raise
            if isinstance(exc, UiTimeout):
                raise OrderUnknown(
                    f"接口超时（上限 {self.cfg.server.request_timeout_s:.0f}s）：委托可能已提交，"
                    "请先用 GET /orders 核实，再决定是否重试",
                    detail={"client_order_id": cid},
                ) from exc
            raise OrderUnknown(f"下单结果未知，请人工核对: {exc}") from exc

        ok = bool(raw.get("ok"))
        contract = raw.get("contract_no")
        message = (raw.get("message") or "").replace("\n", " ").strip()

        raw_info = {
            "name": ctx.name if ctx else "",
            "last_price": ctx.last_price if ctx else 0,
            "available": ctx.available if ctx else 0,
            "dialogs": raw.get("dialog_texts", []),
        }

        # 操作接口不自己下结论：只要提交过（看到成功提示，或点过确认框），
        # 一律用查询接口（当日委托）核实。
        verified = False
        verify_note = "未提交，无需核实"
        row: OrderInfo | None = None
        if ok or raw.get("confirm_clicked"):
            verified, verify_note, row = self._verify_placed(req, contract, started)
        raw_info["verify"] = verify_note
        if row is not None:
            raw_info["order_row"] = row.model_dump(mode="json", exclude={"raw"})

        if verified and row is not None:
            status = _status_from_cn(row.status) if row.status else OrderStatus.ACCEPTED
        elif ok and not verified:
            status = OrderStatus.UNKNOWN
        else:
            status = OrderStatus.REJECTED

        order_key = _make_order_key(
            datetime.now().strftime("%Y%m%d"),
            row.time if row else "",
            result_order_id := (contract or (row.order_id if row else None)),
        )

        result = OrderResult(
            ok=bool(ok or verified),
            order_id=result_order_id,
            order_key=order_key,
            client_order_id=cid,
            symbol=req.symbol,
            side=req.side,
            price=req.price,
            quantity=req.quantity,
            status=status,
            verified=verified,
            verify_note=verify_note,
            message=message or ("委托成功" if ok else "委托被拒绝"),
            submitted_at=datetime.now(),
            elapsed_ms=int((time.time() - started) * 1000),
            raw=raw_info,
        )
        self._journal_update(
            cid,
            "accepted" if verified else ("unknown" if ok else "rejected"),
            result.order_id,
            f"{message} | 核实: {verify_note}",
            ctx.name if ctx else "",
            result.raw,
            order_key=order_key,
        )
        if not ok and not verified:
            raise OrderRejected(message or "客户端拒绝委托", raw=raw_info)
        if not verified:
            raise OrderUnknown(
                f"委托已提交但未核实到：{verify_note}",
                detail={"order_id": result.order_id, "raw": raw_info},
            )
        return result

    def _verify_placed(
        self, req: OrderRequest, contract: str | None, started: float | None = None
    ) -> tuple[bool, str, OrderInfo | None]:
        """用查询接口核实"这笔委托到底有没有下出去"。

        只认「合同编号匹配」或「代码+数量+方向匹配且委托时间是刚下的」，
        否则会把早上同代码同数量的旧委托误当成这一笔。
        """
        try:
            rows = self.orders(fresh=True)
        except Exception as exc:  # noqa: BLE001
            return False, f"回读当日委托失败: {exc}", None

        def _fresh(row: OrderInfo) -> bool:
            if started is None or not row.time:
                return True
            try:
                hh, mm, ss = (int(x) for x in row.time.replace("：", ":").split(":")[:3])
                t = datetime.now().replace(hour=hh, minute=mm, second=ss, microsecond=0)
                return abs((t - datetime.fromtimestamp(started)).total_seconds()) <= 180
            except Exception:  # noqa: BLE001
                return True

        if contract:
            for r in rows:
                if r.order_id == contract:
                    return True, f"回读命中合同编号 {contract}（{r.status}）", r
        for r in rows:
            if (
                r.symbol == req.symbol
                and r.quantity == req.quantity
                and r.side == req.side.cn
                and _fresh(r)
            ):
                return True, f"回读命中 {r.symbol} {r.quantity} 股 {r.side} @{r.time}（{r.status}）", r
        return False, "当日委托中未找到该笔委托", None

    def _journal_update(
        self,
        cid: str,
        status: str,
        contract: str | None,
        message: str,
        name: str,
        raw: dict,
        order_key: str | None = None,
    ) -> None:
        if self.journal is None:
            return
        prev = self.journal.get(cid) or {}
        self.journal.record(
            client_order_id=cid,
            symbol=prev.get("symbol", ""),
            side=prev.get("side", ""),
            price=float(prev.get("price", 0) or 0),
            quantity=int(prev.get("quantity", 0) or 0),
            order_type=prev.get("order_type", "limit"),
            status=status,
            broker_order_id=contract,
            order_key=order_key,
            message=message,
            name=name,
            raw=raw,
        )


# --------------------------------------------------------------------------- #
# 转换
# --------------------------------------------------------------------------- #
def _has_symbol(row: dict[str, str]) -> bool:
    """过滤客户端表格里的占位空行（代码为空或 0）。"""
    sym = pick(row, "证券代码", "代码", "股票代码").strip()
    return bool(sym) and sym not in ("0", "000000", "-")


def _to_account(raw: dict[str, float]) -> Account:
    return Account(
        total_asset=raw.get("total_asset", 0.0),
        cash_available=raw.get("cash_available", 0.0),
        cash_withdrawable=raw.get("cash_withdrawable", 0.0),
        frozen=raw.get("frozen", 0.0),
        market_value=raw.get("market_value", 0.0),
        pnl_today=raw.get("pnl_today", 0.0),
        pnl_total=raw.get("pnl_total", 0.0),
        updated_at=datetime.now(),
        raw={k: str(v) for k, v in raw.items()},
    )


def _to_price(value: str) -> float:
    """价格专用解析：OCR 常把小数点认成逗号（8.199 → 8,199）。

    价格单元格里出现"只有逗号、没有点"的形态时，逗号是小数点而不是千分位；
    千分位在价格上不会单独出现（同花顺价格一律带三位小数），所以这样判断是安全的。
    """
    s = str(value or "").strip()
    if re.fullmatch(r"-?\d{1,6},\d{1,3}", s):
        s = s.replace(",", ".")
    return to_float(s)


def _to_position(row: dict[str, str]) -> Position:
    qty = to_int(pick(row, "股票余额", "当前持仓", "持仓数量", "数量", "证券数量"))
    avail = to_int(pick(row, "可用余额", "可用数量", "可卖数量", "可用股数", default=str(qty)))
    cost = _to_price(pick(row, "参考成本价", "成本价", "持仓成本", "摊薄成本价"))
    last = _to_price(pick(row, "市价", "最新价", "现价", "当前价"))
    mv = to_float(pick(row, "市值", "参考市值", "最新市值"))
    pnl = to_float(pick(row, "盈亏", "浮动盈亏", "参考盈亏"))
    pct = to_float(pick(row, "盈亏比例", "盈亏比", "盈亏率"))

    # 市值列常在右侧屏幕外，或 OCR 把负号/小数认错；用持仓×市价自算，更可靠
    if qty > 0 and last > 0 and mv <= 0:
        mv = round(qty * last, 2)
    # 反过来：市价没读到时用 市值/持仓 反推；读到了但明显失真（如 8.199 被认成 8199）时，
    # 同样以「市值/持股数」为准 —— 市值列是整块数字，出错概率远低于逐字符的价格。
    if qty > 0 and mv > 0:
        implied = mv / qty
        if last <= 0 or abs(last - implied) > max(0.02, abs(implied) * 0.2):
            last = round(implied, 3)
    if qty > 0 and cost > 0 and last > 0:
        calc_pnl = round((last - cost) * qty, 2)
        # 读到的盈亏明显不合理（与自算差太多）时以自算为准
        if abs(pnl - calc_pnl) > max(1.0, abs(calc_pnl) * 0.3):
            pnl = calc_pnl
        calc_pct = round((last / cost - 1) * 100, 2)
        if abs(pct - calc_pct) > max(0.5, abs(calc_pct) * 0.3):
            pct = calc_pct

    return Position(
        symbol=pick(row, "证券代码", "代码"),
        name=pick(row, "证券名称", "名称"),
        quantity=qty,
        available=avail,
        cost_price=cost,
        last_price=last,
        market_value=mv,
        pnl=pnl,
        pnl_pct=pct,
        raw=row,
    )


def _norm_side(text: str) -> str:
    """OCR 常把「买入」读成「买.」「买 」，统一成标准写法。"""
    t = (text or "").strip()
    if t.startswith("买"):
        return "买入"
    if t.startswith("卖"):
        return "卖出"
    return t


def _make_order_key(trade_date: str, hhmmss: str, contract: str | None) -> str:
    """用「交易日期 + 委托时间 + 合同编号」拼出对账单号，例如 20261023-093015-12345。

    合同编号跨日会重复（同一 client_order_id 也可能多日出现），带上日期+时间才能唯一定位。
    """
    if not contract:
        return ""
    d = re.sub(r"\D", "", trade_date or "") or datetime.now().strftime("%Y%m%d")
    t = re.sub(r"\D", "", hhmmss or "")
    if t:
        t = t.zfill(6)  # 9:3 → 090300，保证 HHMMSS 定长
    return f"{d}-{t}-{contract}" if t else f"{d}-{contract}"


def _to_order(row: dict[str, str]) -> OrderInfo:
    return OrderInfo(
        order_id=pick(row, "合同编号", "委托编号", "合同号"),
        symbol=pick(row, "证券代码", "代码"),
        name=pick(row, "证券名称", "名称"),
        side=_norm_side(pick(row, "买卖标志", "操作", "委托类别", "买卖方向")),
        price=to_float(pick(row, "委托价格", "价格", "委托价")),
        quantity=to_int(pick(row, "委托数量", "委托量", "数量")),
        filled=to_int(pick(row, "成交数量", "已成交数量", "成交量")),
        status=pick(row, "委托状态", "状态", "备注", "委托备注").lstrip(".·• "),
        time=pick(row, "委托时间", "时间", "申报时间"),
        raw=row,
    )


def _to_trade(row: dict[str, str]) -> TradeInfo:
    return TradeInfo(
        trade_id=re.sub(r"\D", "", pick(row, "成交编号", "编号")),
        order_id=pick(row, "合同编号", "委托编号", "合同号"),
        symbol=pick(row, "证券代码", "代码"),
        name=pick(row, "证券名称", "名称"),
        side=_norm_side(pick(row, "买卖标志", "操作", "买卖方向")),
        price=to_float(pick(row, "成交价格", "成交价", "价格")),
        quantity=to_int(pick(row, "成交数量", "成交量", "数量")),
        amount=to_float(pick(row, "成交金额", "金额")),
        time=pick(row, "成交时间", "时间", "成交日期"),
        raw=row,
    )


def _status_from_cn(text: str) -> OrderStatus:
    t = (text or "").strip()
    if any(w in t for w in ("全部成交", "已成", "已成交")):
        return OrderStatus.FILLED
    if any(w in t for w in ("部成", "部分成交")):
        return OrderStatus.PARTIAL
    if any(w in t for w in ("已撤", "撤单")):
        return OrderStatus.CANCELED
    if any(w in t for w in ("废单", "拒绝", "失败")):
        return OrderStatus.REJECTED
    if any(w in t for w in ("已报", "待报", "已受理")):
        return OrderStatus.ACCEPTED
    return OrderStatus.UNKNOWN


def _replay(prev: dict[str, Any]) -> OrderResult:
    status = OrderStatus.ACCEPTED if prev["status"] == "accepted" else OrderStatus.REJECTED
    return OrderResult(
        ok=prev["status"] == "accepted",
        order_id=prev.get("broker_order_id"),
        client_order_id=prev["client_order_id"],
        symbol=prev.get("symbol"),
        side=Side(prev["side"]) if prev.get("side") in ("buy", "sell") else None,
        price=float(prev.get("price") or 0),
        quantity=int(prev.get("quantity") or 0),
        status=status,
        message=f"[幂等重放] {prev.get('message') or ''}",
        raw={"journal": {k: prev[k] for k in ("created_at", "updated_at", "status")}},
    )


def _gen_cid() -> str:
    return "ths-" + datetime.now().strftime("%Y%m%d%H%M%S-") + f"{int(time.time() * 1000) % 1000:03d}"


# --------------------------------------------------------------------------- #
# Mock 后端（无客户端时用于联调 / 单元测试）
# --------------------------------------------------------------------------- #
class _MockState:
    def __init__(self) -> None:
        self._orders: list[OrderInfo] = []
        self._seq = 100000
        self._lock = threading.Lock()
        self._cash = 1_000_000.0
        self._positions = [
            Position(symbol="513100", name="纳指ETF", quantity=1000, available=1000,
                     cost_price=1.8, last_price=1.85, market_value=1850, pnl=50, pnl_pct=2.78),
        ]

    def account(self) -> Account:
        mv = sum(p.market_value for p in self._positions)
        return Account(
            total_asset=self._cash + mv,
            cash_available=self._cash,
            cash_withdrawable=self._cash,
            market_value=mv,
            updated_at=datetime.now(),
        )

    def positions(self) -> list[Position]:
        return list(self._positions)

    def orders(self) -> list[OrderInfo]:
        return list(self._orders)

    def trades(self, fresh: bool = False) -> list[TradeInfo]:
        return []

    def place(self, req: OrderRequest, started: float) -> OrderResult:
        with self._lock:
            self._seq += 1
            oid = str(self._seq)
            info = OrderInfo(
                order_id=oid,
                symbol=req.symbol,
                name="模拟",
                side=req.side.cn,
                price=req.price,
                quantity=req.quantity,
                status="已报",
                time=datetime.now().strftime("%H:%M:%S"),
            )
            self._orders.append(info)
            if req.side is Side.BUY:
                self._cash -= req.amount
        return OrderResult(
            ok=True,
            order_id=oid,
            client_order_id=req.client_order_id,
            symbol=req.symbol,
            side=req.side,
            price=req.price,
            quantity=req.quantity,
            status=OrderStatus.ACCEPTED,
            message="模拟委托成功",
            submitted_at=datetime.now(),
            elapsed_ms=int((time.time() - started) * 1000),
        )

    def cancel(self, order_id: str | None, symbol: str | None) -> dict[str, Any]:
        with self._lock:
            for o in self._orders:
                if (order_id and o.order_id == order_id) or (symbol and o.symbol == symbol):
                    if "已报" in o.status:
                        o.status = "已撤"
                        return {"ok": True, "message": f"已撤单 {o.order_id}"}
            return {"ok": False, "message": "没有可撤委托"}

    def cancel_all(self) -> dict[str, Any]:
        with self._lock:
            n = 0
            for o in self._orders:
                if "已报" in o.status:
                    o.status = "已撤"
                    n += 1
            return {"ok": True, "message": f"已撤 {n} 笔"}
