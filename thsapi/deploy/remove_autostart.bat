@echo off
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
