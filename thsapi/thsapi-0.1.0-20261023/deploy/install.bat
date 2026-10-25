@echo off
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
