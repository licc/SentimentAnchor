"""FastAPI 应用：本机量化系统调用的 HTTP 接口。"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from fastapi import Body, Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import webdocs
from .config import PROJECT_ROOT, AppConfig, load_config
from .errors import AuthError, ThsError
from .models import (
    Account,
    CancelRequest,
    HealthResponse,
    OrderInfo,
    OrderRequest,
    OrderResult,
    Position,
    TradeInfo,
)
from .service import VERSION, TradingService

log = logging.getLogger("thsapi.api")


def create_app(cfg: AppConfig | None = None, service: TradingService | None = None) -> FastAPI:
    cfg = cfg or load_config()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service = service or TradingService(cfg)
        log.info("thsapi %s 启动: broker=%s mode=%s", VERSION, cfg.trading.broker, cfg.trading.mode)
        try:
            yield
        finally:
            app.state.service.shutdown()

    app = FastAPI(
        title="交易接口 (Trading API)",
        version=VERSION,
        description=(
            "基于 GUI 自动化的交易客户端接口，仅监听本机回环地址，"
            "供量化交易系统调用。"
        ),
        docs_url="/docs" if cfg.server.docs_enabled else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    if cfg.server.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cfg.server.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # 文档页里每个接口的"操作现场"截图
    shots_dir = PROJECT_ROOT / "static" / "shots"
    if shots_dir.exists():
        app.mount("/shots", StaticFiles(directory=str(shots_dir)), name="shots")

    def get_service(request: Request) -> TradingService:
        return request.app.state.service

    def auth(
        x_api_key: str | None = Header(default=None),
        authorization: str | None = Header(default=None),
    ) -> None:
        expected = cfg.server.api_key
        if not expected:
            return
        token = x_api_key
        if not token and authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:]
        if token != expected:
            raise AuthError("API Key 无效，请在请求头 X-API-Key 中提供")

    # ------------------------------------------------------------------ #
    @app.exception_handler(ThsError)
    async def _ths_error_handler(_request: Request, exc: ThsError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=exc.to_dict())

    @app.middleware("http")
    async def _timing(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        cost = (time.perf_counter() - start) * 1000
        response.headers["X-Elapsed-Ms"] = f"{cost:.0f}"
        if request.url.path.startswith("/api/"):
            log.info("%s %s -> %s (%.0fms)", request.method, request.url.path, response.status_code, cost)
        return response

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def root() -> HTMLResponse:
        return HTMLResponse(
            webdocs.render(VERSION, cfg.trading.mode, cfg.server.port, auth_required=bool(cfg.server.api_key))
        )

    @app.get("/api", include_in_schema=False)
    def api_info() -> dict[str, Any]:
        return {
            "name": "thsapi",
            "version": VERSION,
            "mode": cfg.trading.mode,
            "broker": cfg.trading.broker,
            "docs": "/",
            "swagger": "/docs" if cfg.server.docs_enabled else None,
        }

    api = "/api/v1"

    @app.get(f"{api}/health", response_model=HealthResponse, dependencies=[Depends(auth)])
    def health(svc: TradingService = Depends(get_service)) -> HealthResponse:
        return svc.health()

    @app.get(f"{api}/portfolio", dependencies=[Depends(auth)])
    def portfolio(fresh: bool = True, svc: TradingService = Depends(get_service)) -> dict[str, Any]:
        """资金 + 持仓：都在「资金股票」这一页，一次读回。"""
        return svc.portfolio(fresh=fresh)

    @app.get(f"{api}/orders", response_model=list[OrderInfo], dependencies=[Depends(auth)])
    def orders(
        refresh: bool = False, fresh: bool = False, svc: TradingService = Depends(get_service)
    ) -> list[OrderInfo]:
        return svc.orders(refresh=refresh, fresh=fresh)

    @app.get(f"{api}/trades", response_model=list[TradeInfo], dependencies=[Depends(auth)])
    def trades(fresh: bool = False, svc: TradingService = Depends(get_service)) -> list[TradeInfo]:
        return svc.trades(fresh=fresh)

    @app.post(f"{api}/orders", response_model=OrderResult, dependencies=[Depends(auth)])
    def place_order(
        req: OrderRequest = Body(...), svc: TradingService = Depends(get_service)
    ) -> OrderResult:
        return svc.place_order(req)

    @app.post(f"{api}/cancel", dependencies=[Depends(auth)])
    def cancel(
        req: CancelRequest = Body(...), svc: TradingService = Depends(get_service)
    ) -> dict[str, Any]:
        return svc.cancel(req.order_id, req.symbol)

    @app.get(f"{api}/journal", dependencies=[Depends(auth)])
    def journal(limit: int = 50, svc: TradingService = Depends(get_service)) -> list[dict[str, Any]]:
        """本地委托台账：含未成功请求，供量化系统对账。"""
        if svc.journal is None:
            return []
        return svc.journal.recent(limit=max(1, min(500, int(limit))))

    @app.post(f"{api}/cancel-all", dependencies=[Depends(auth)])
    def cancel_all(svc: TradingService = Depends(get_service)) -> dict[str, Any]:
        """兼容旧客户端的全部撤单入口；逐个撤掉仍可撤的委托。"""
        orders = svc.orders(fresh=True)
        targets = [
            o for o in orders
            if not any(word in o.status for word in ("已成", "已撤", "废单", "已废"))
        ]
        canceled = 0
        failed: list[dict[str, str]] = []
        for order in targets:
            try:
                svc.cancel(order.order_id, None)
                canceled += 1
            except Exception as exc:  # noqa: BLE001
                failed.append({"order_id": order.order_id, "error": str(exc)})
        return {"ok": not failed, "canceled": canceled, "failed": failed}

    @app.get(f"{api}/time", include_in_schema=False)
    def server_time() -> dict[str, str]:
        return {"now": datetime.now().isoformat(timespec="seconds")}

    return app
