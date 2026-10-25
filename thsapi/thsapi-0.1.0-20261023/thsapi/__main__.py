"""命令行入口：serve / probe / selftest。"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .config import load_config, PROJECT_ROOT


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in ("pywinauto", "comtypes", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def cmd_serve(args) -> int:
    import threading

    import uvicorn

    from .api import create_app
    from .service import TradingService

    cfg = load_config(args.config)
    setup_logging(cfg.server.log_level)

    if cfg.trading.grid_read == "ocr":
        from .gui.ocr_table import warmup

        setup_logging(cfg.server.log_level)
        print("预热 OCR 引擎 ...", flush=True)
        warmup()

    svc = TradingService(cfg)
    print("预热客户端缓存 ...", flush=True)
    svc.warmup()
    app = create_app(cfg, svc)
    config = uvicorn.Config(
        app,
        host=cfg.server.host,
        port=cfg.server.port or args.port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)

    # HTTP 服务跑在子线程；主线程留给 GUI 自动化（UIA COM 必须在其创建的线程上调用）
    http_thread = threading.Thread(target=server.run, name="thsapi-http", daemon=True)
    http_thread.start()
    print(f"thsapi 已启动: http://{cfg.server.host}:{cfg.server.port or args.port}/docs  "
          f"(broker={cfg.trading.broker}, mode={cfg.trading.mode})", flush=True)
    try:
        svc.runner.loop_forever()
    except KeyboardInterrupt:
        print("正在退出 ...", flush=True)
    finally:
        server.should_exit = True
        svc.shutdown()
        http_thread.join(timeout=5)
    return 0


def cmd_probe(args) -> int:
    """导出当前页面控件树，用于校准 selectors.yaml。"""
    from .gui.controls import dump_controls
    from .gui.ths import ThsClient

    setup_logging("INFO")
    cfg = load_config(args.config)
    client = ThsClient(cfg)
    client.ensure_ready()
    out_dir = Path(args.out_dir or PROJECT_ROOT / "runtime")
    out_dir.mkdir(parents=True, exist_ok=True)

    win = client.win.wrapper()
    path = out_dir / "controls_main.txt"
    path.write_text(dump_controls(win), encoding="utf-8")
    print(f"已导出主窗口控件: {path}")

    if args.nav:
        for name in args.nav:
            client.nav(name)
            page = out_dir / f"controls_{name}.txt"
            page.write_text(dump_controls(client.win.wrapper()), encoding="utf-8")
            print(f"已导出页面控件: {page}")
    return 0


def cmd_selftest(args) -> int:
    from .service import TradingService

    setup_logging("INFO")
    cfg = load_config(args.config)
    if args.mock:
        cfg.trading.broker = "mock"
    svc = TradingService(cfg)
    try:
        health = svc.health()
        print(json.dumps(health.model_dump(mode="json"), ensure_ascii=False, indent=2))
        if not health.ok:
            print("客户端未就绪，跳过后续检查", file=sys.stderr)
            return 2
        account = svc.account()
        print("账户:", json.dumps(account.model_dump(mode="json", exclude={"raw"}), ensure_ascii=False))
        positions, _ = svc.positions()
        print(f"持仓 {len(positions)} 条")
        for p in positions[:10]:
            print(f"  {p.symbol} {p.name} qty={p.quantity} avail={p.available} cost={p.cost_price} last={p.last_price}")
        orders = svc.orders()
        print(f"当日委托 {len(orders)} 条")
        for o in orders[:10]:
            print(f"  {o.order_id} {o.symbol} {o.side} {o.price} x {o.quantity} {o.status}")
        return 0
    finally:
        svc.shutdown()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="thsapi", description="交易接口")
    parser.add_argument("--config", default=None, help="配置文件路径")
    sub = parser.add_subparsers(dest="cmd")

    p_serve = sub.add_parser("serve", help="启动 HTTP 服务")
    p_serve.add_argument("--port", type=int, default=0)
    p_serve.set_defaults(func=cmd_serve)

    p_probe = sub.add_parser("probe", help="导出控件树用于校准")
    p_probe.add_argument("--out-dir", default=None)
    p_probe.add_argument("--nav", nargs="*", default=None, help="依次点击的导航节点")
    p_probe.set_defaults(func=cmd_probe)

    p_test = sub.add_parser("selftest", help="自检：健康检查/账户/持仓/委托")
    p_test.add_argument("--mock", action="store_true")
    p_test.set_defaults(func=cmd_selftest)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
