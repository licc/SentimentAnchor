@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0.."

set PORT=%1
if "%PORT%"=="" set PORT=8888

echo [thsapi] 停止监听 %PORT% 端口的服务 ...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $p = $c.OwningProcess; Write-Host ('  进程 PID ' + $p); Stop-Process -Id $p -Force; Start-Sleep -Milliseconds 500; Write-Host '  已停止' } else { Write-Host '  没有在运行' }"
echo.
pause
