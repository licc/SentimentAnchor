"""把根目录 run_api.bat 改成 GBK 编码的转发脚本（统一走 deploy\\start.bat）。"""
from pathlib import Path

BAT = r"""@echo off
chcp 936 >nul
cd /d "%~dp0"
echo [thsapi] 转交 deploy\start.bat 启动 ...
call deploy\start.bat
"""

p = Path(r"D:\jyauto\run_api.bat")
p.write_bytes(BAT.replace("\n", "\r\n").encode("gbk"))
print("run_api.bat", p.stat().st_size, "bytes gbk/crlf")
