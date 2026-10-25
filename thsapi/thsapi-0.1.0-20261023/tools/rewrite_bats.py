"""把 deploy 下的 .bat 统一重写成 GBK（cp936）编码。

原因：cmd.exe 默认按系统 OEM 代码页（中文 Windows = 936）解析批处理文件，
UTF-8 无 BOM 的中文批处理会被拆成乱码命令（'r' 不是内部命令 之类）。
"""
from __future__ import annotations

from pathlib import Path

DEPLOY = Path(r"D:\jyauto\deploy")

START = r"""@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

if not exist "logs" mkdir "logs"

set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe

echo [thsapi] 启动中，日志同时写入 logs\api.log
echo [thsapi] 请确认交易客户端已打开并登录
echo.

powershell -NoProfile -Command "& '%PY%' -m thsapi serve 2>&1 | Tee-Object -FilePath 'logs\api.log' -Append"

if errorlevel 1 (
    echo.
    echo [thsapi] 启动失败，排查顺序：
    echo   1. 客户端是否已打开并登录
    echo   2. 端口是否被占用（config.yaml 的 server.port）
    echo   3. 运行 deploy\check_env.py 检查环境
    pause
)
"""

INSTALL = r"""@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0.."

echo ============================================
echo   安装依赖（虚拟环境 .venv + requirements.txt）
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 找不到 python.exe，请先安装 Python 3.12 64 位并加入 PATH
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/4] 创建虚拟环境 .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败
        pause
        exit /b 1
    )
) else (
    echo [1/4] 虚拟环境已存在，跳过创建
)

echo [2/4] 升级 pip ...
".venv\Scripts\python.exe" -m pip install --upgrade pip -q

echo [3/4] 安装依赖 ...
".venv\Scripts\python.exe" -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo [错误] 依赖安装失败。可换国内镜像重试：
    echo   ".venv\Scripts\python.exe" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    pause
    exit /b 1
)

echo [4/4] 环境自检 ...
".venv\Scripts\python.exe" deploy\check_env.py
if errorlevel 1 (
    echo.
    echo [提示] 自检未全部通过，请先处理上面的 FAIL 项
)

echo.
echo 安装完成。启动服务：deploy\start.bat
pause
"""

STOP = r"""@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0.."

set PORT=%1
if "%PORT%"=="" set PORT=8888

echo [thsapi] 停止监听 %PORT% 端口的服务 ...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $p = $c.OwningProcess; Write-Host ('  进程 PID ' + $p); Stop-Process -Id $p -Force; Start-Sleep -Milliseconds 500; Write-Host '  已停止' } else { Write-Host '  没有在运行' }"
echo.
pause
"""

AUTOSTART = r"""@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0.."

set TASK=thsapi-trading
set RUN=%CD%

echo [thsapi] 注册开机自启任务：%TASK%
echo          启动脚本：%RUN%\deploy\start.bat

schtasks /Create /TN "%TASK%" /TR "\"%RUN%\deploy\start.bat\"" /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (
    echo.
    echo [错误] 创建任务失败，请用“管理员身份”运行本脚本
    pause
    exit /b 1
)

echo.
echo 已创建。登录 Windows 后自动启动服务。
echo   立即启动一次： schtasks /Run /TN "%TASK%"
echo   取消自启：     deploy\remove_autostart.bat
pause
"""

REMOVE = r"""@echo off
chcp 936 >nul
setlocal

set TASK=thsapi-trading

echo [thsapi] 删除开机自启任务：%TASK%
schtasks /Delete /TN "%TASK%" /F
if errorlevel 1 (
    echo 任务不存在或删除失败（可能需要管理员权限）
) else (
    echo 已删除
)
pause
"""

FIREWALL = r"""@echo off
chcp 936 >nul
setlocal

set PORT=%1
if "%PORT%"=="" set PORT=8888
set RULE=thsapi-%PORT%

echo [thsapi] 添加入站放行规则：%RULE%（TCP %PORT%）
netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=%PORT% >nul
if errorlevel 1 (
    echo [错误] 添加失败，请用管理员身份运行
) else (
    echo 已添加。删除规则： netsh advfirewall firewall delete rule name="%RULE%"
)
pause
"""

FILES = {
    "start.bat": START,
    "install.bat": INSTALL,
    "stop.bat": STOP,
    "install_autostart.bat": AUTOSTART,
    "remove_autostart.bat": REMOVE,
    "open_firewall.bat": FIREWALL,
}

for name, text in FILES.items():
    p = DEPLOY / name
    # 统一 LF→CRLF，GBK 编码（中文 Windows 的 cmd 默认代码页）
    p.write_bytes(text.replace("\n", "\r\n").encode("gbk"))
    print(f"{name:26s} {p.stat().st_size:5d} bytes  gbk/crlf")
