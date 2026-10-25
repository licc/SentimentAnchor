@echo off
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
