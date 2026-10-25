@echo off
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
