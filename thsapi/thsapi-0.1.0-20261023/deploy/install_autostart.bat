@echo off
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
