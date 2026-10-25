# 情绪锚 · 本地服务启停脚本
#
# 用法（在仓库根目录或任意位置执行都可以，脚本会自己定位仓库根）：
#   powershell -ExecutionPolicy Bypass -File scripts\services.ps1 status
#   powershell -ExecutionPolicy Bypass -File scripts\services.ps1 start
#   powershell -ExecutionPolicy Bypass -File scripts\services.ps1 stop
#
# 管三件事：
#   1) 前端 Vite    5173
#   2) 后端 API     8787
#   3) thsapi 适配器 8888（若 thsapi 目录与 .venv 存在才管）
#
# 日志统一写到 data\run\ 下（该目录已在 .gitignore 中）。
param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$run = Join-Path $root 'data\run'
New-Item -ItemType Directory -Force -Path $run | Out-Null

# thsapi 目录名带版本号，这里自动查找（取第一个含 config.yaml 的 thsapi-* 目录）
$ths = $null
$thsParent = Join-Path $root 'thsapi'
if (Test-Path $thsParent) {
  $ths = Get-ChildItem $thsParent -Directory -Filter 'thsapi-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'config.yaml') } |
    Select-Object -First 1 -ExpandProperty FullName
}
$py = if ($ths) { Join-Path $ths '.venv\Scripts\python.exe' } else { $null }
$nodeDir = 'C:\Program Files\nodejs'

function Get-PortOwner([int]$port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess } else { return 0 }
}

function Test-Up([int]$port) { return (Get-PortOwner $port) -ne 0 }

function Show-Status {
  foreach ($p in @(
      @{ Port = 8787; Name = '后端 API' },
      @{ Port = 5173; Name = '前端 Vite' },
      @{ Port = 8888; Name = 'thsapi 适配器' })) {
    $ownerPid = Get-PortOwner $p.Port
    if ($ownerPid) { '{0,-14} :{1} 运行中 (PID {2})' -f $p.Name, $p.Port, $ownerPid }
    else { '{0,-14} :{1} 未运行' -f $p.Name, $p.Port }
  }
}

switch ($Action) {
  'start' {
    if ((Test-Up 8787) -and (Test-Up 5173)) { '前端/后端已在运行' }
    else {
      # 让官方 node.exe 排在 DSH/其它 node.cmd 垫片之前：
      # 垫片的隐藏控制台重启动会吞掉 pnpm 传给 concurrently 的参数。
      Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden `
        -RedirectStandardOutput "$run\dev.out.log" -RedirectStandardError "$run\dev.err.log" `
        -ArgumentList '/c',
        "set `"PATH=$nodeDir;%PATH%`" && cd /d `"$root`" && pnpm dev > `"$run\dev.log`" 2>&1"
      '已启动 前端(5173) + 后端(8787)'
    }
    if (-not $py -or -not (Test-Path $py)) {
      '跳过 thsapi：未找到 thsapi 目录或其中的 .venv（先按 docs/DEPLOYMENT.md 建虚拟环境）'
    }
    elseif (Test-Up 8888) { 'thsapi 已在运行' }
    else {
      Start-Process -FilePath $py -WorkingDirectory $ths -WindowStyle Hidden `
        -RedirectStandardOutput "$run\thsapi.out.log" -RedirectStandardError "$run\thsapi.err.log" `
        -ArgumentList '-m', 'thsapi', 'serve'
      '已启动 thsapi(8888)'
    }
    Start-Sleep -Seconds 8
    Show-Status
  }
  'stop' {
    $targets = Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and $_.CommandLine -like "*$root*" -and
      ($_.CommandLine -match 'cli\.mjs|vite\.js|concurrently|thsapi|server/index\.ts')
    }
    foreach ($t in $targets) {
      try { Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop; "已停止 PID $($t.ProcessId) ($($t.Name))" } catch { }
    }
    Start-Sleep -Seconds 2
    Show-Status
  }
  'status' { Show-Status }
}
