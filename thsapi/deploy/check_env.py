"""环境自检：Python 位数、依赖、OCR 语言包、端口占用、配置可读性。

用法：python deploy\\check_env.py
返回码 0 表示全部通过，1 表示有必须处理的问题。
"""
from __future__ import annotations

import os
import socket
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

ok = True
warn = 0


def good(msg: str) -> None:
    print(f"  [OK]   {msg}")


def bad(msg: str) -> None:
    global ok
    ok = False
    print(f"  [FAIL] {msg}")


def note(msg: str) -> None:
    global warn
    warn += 1
    print(f"  [WARN] {msg}")


print("1) Python")
v = sys.version_info
print(f"     版本 {v.major}.{v.minor}.{v.micro}  位数 {struct.calcsize('P') * 8}")
if v < (3, 11):
    bad("需要 Python 3.11+（推荐 3.12）")
elif struct.calcsize("P") * 8 != 64:
    bad("必须是 64 位 Python，否则读不到 64 位客户端控件")
else:
    good("Python 版本与位数正确")

print("\n2) 依赖包")
mods = {
    "pywinauto": "pywinauto",
    "comtypes": "comtypes",
    "win32api": "pywin32",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "pydantic": "pydantic",
    "yaml": "PyYAML",
    "PIL": "pillow",
    "numpy": "numpy",
    "winsdk": "winsdk",
}
missing = []
for mod, pkg in mods.items():
    try:
        __import__(mod)
        good(pkg)
    except Exception as exc:  # noqa: BLE001
        missing.append(pkg)
        bad(f"{pkg} 未安装（{exc.__class__.__name__}）")
if missing:
    print(f"     → 执行: python -m pip install -r requirements.txt")

print("\n3) OCR 引擎与中文语言包")
try:
    import asyncio

    from winsdk.windows.globalization import Language
    from winsdk.windows.media.ocr import OcrEngine

    engine = OcrEngine.try_create_from_language(Language("zh-Hans-CN"))
    if engine is None:
        bad("系统没有 zh-Hans-CN 的 OCR 语言包，请安装“简体中文”语言包")
        print('     → Add-WindowsCapability -Online -Name "Language.OCR~~~zh-CN~0.0.1.0"')
    else:
        good(f"OCR 可用，语言 = {engine.recognizer_language.language_tag}")
except Exception as exc:  # noqa: BLE001
    bad(f"OCR 初始化失败: {exc}")

print("\n4) 配置")
try:
    from thsapi.config import load_config

    cfg = load_config()
    good(f"config.yaml 可读：mode={cfg.trading.mode} broker={cfg.trading.broker}")
    exe = Path(cfg.client.exe_path)
    if exe.exists():
        good(f"客户端路径存在：{exe}")
    else:
        note(f"客户端路径不存在：{exe}（改成自己机器上的 xiadan.exe 路径）")
    if cfg.trading.mode == "live":
        note("当前是 live 实盘模式，下单会真实提交")
    if cfg.server.host == "0.0.0.0" and not cfg.server.api_key:
        note("监听 0.0.0.0 且未设 api_key：同网段任何人都能下单")
except Exception as exc:  # noqa: BLE001
    bad(f"config.yaml 读取失败: {exc}")

print("\n5) 端口")
try:
    port = load_config().server.port  # type: ignore[possibly-undefined]
    s = socket.socket()
    s.settimeout(0.5)
    busy = s.connect_ex(("127.0.0.1", port)) == 0
    s.close()
    if busy:
        note(f"端口 {port} 已有程序在用（可能服务已在运行）")
    else:
        good(f"端口 {port} 空闲")
except Exception as exc:  # noqa: BLE001
    note(f"端口检查跳过: {exc}")

print("\n6) 客户端进程")
try:
    import psutil  # type: ignore

    running = any("xiadan" in (p.name() or "").lower() for p in psutil.process_iter(["name"]))
    if running:
        good("检测到 xiadan.exe 在运行")
    else:
        note("没检测到 xiadan.exe（启动服务前请先打开并登录客户端）")
except Exception:
    import subprocess

    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq xiadan.exe"],
            capture_output=True,
            text=True,
            encoding="gbk",
            errors="replace",
        ).stdout
        if "xiadan.exe" in out.lower():
            good("检测到 xiadan.exe 在运行")
        else:
            note("没检测到 xiadan.exe（启动服务前请先打开并登录客户端）")
    except Exception as exc:  # noqa: BLE001
        note(f"进程检查跳过: {exc}")

print("\n" + "=" * 46)
if ok:
    print(f"自检通过{f'（{warn} 条提醒）' if warn else ''}，可以启动服务")
    print("  python -m thsapi serve")
else:
    print("自检未通过，请按上面的 FAIL 逐项处理")

# winsdk 的 OCR/COM 对象在解释器正常退出时会触发 access violation（0xC0000005），
# 这里跳过清理阶段直接退出，避免把一个"通过"的自检显示成崩溃。
sys.stdout.flush()
os._exit(0 if ok else 1)
