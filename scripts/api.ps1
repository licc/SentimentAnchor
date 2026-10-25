# thsapi 只读接口速查助手
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\api.ps1 health
#   powershell -ExecutionPolicy Bypass -File scripts\api.ps1 portfolio
#   powershell -ExecutionPolicy Bypass -File scripts\api.ps1 orders|trades|journal [-Limit 20]
#   powershell -ExecutionPolicy Bypass -File scripts\api.ps1 docs
#
# API Key 取自 thsapi 的 config.yaml（server.api_key），也可用 -Key 覆盖。
param(
  [Parameter(Position = 0)]
  [ValidateSet('health', 'portfolio', 'orders', 'trades', 'journal', 'docs')]
  [string]$Cmd = 'health',
  [int]$Limit = 20,
  [string]$Base = 'http://127.0.0.1:8888',
  [string]$Key = ''
)

$root = Split-Path -Parent $PSScriptRoot

if (-not $Key) {
  # 1) 从 config.yaml 读；2) 回退到 data\run\thsapi-apikey.txt
  $cfg = Get-ChildItem (Join-Path $root 'thsapi') -Directory -Filter 'thsapi-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'config.yaml' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($cfg) {
    $m = Select-String -Path $cfg -Pattern '^\s*api_key:\s*"([^"]*)"' | Select-Object -First 1
    if ($m) { $Key = $m.Matches[0].Groups[1].Value }
  }
  if (-not $Key) {
    $f = Join-Path $root 'data\run\thsapi-apikey.txt'
    if (Test-Path $f) { $Key = (Get-Content $f -Raw).Trim() }
  }
}

if ($Cmd -eq 'docs') {
  "内置文档页: $Base/"
  "Swagger   : $Base/docs （先点 Authorize 填 X-API-Key）"
  return
}

$path = switch ($Cmd) {
  'health' { '/api/v1/health' }
  'portfolio' { '/api/v1/portfolio' }
  'orders' { '/api/v1/orders' }
  'trades' { '/api/v1/trades' }
  'journal' { "/api/v1/journal?limit=$Limit" }
}

$headers = @{}
if ($Key) { $headers['X-API-Key'] = $Key }

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $r = Invoke-WebRequest "$Base$path" -Headers $headers -UseBasicParsing -TimeoutSec 120
  $sw.Stop()
  "HTTP $($r.StatusCode) · $($sw.ElapsedMilliseconds) ms · $path"
  $txt = $r.Content.Trim()
  # 数组（如空委托列表）原样输出，避免 ConvertFrom-Json 包成 {"value":[],"Count":0}
  if ($txt.StartsWith('[')) { $txt } else { try { $txt | ConvertFrom-Json | ConvertTo-Json -Depth 8 } catch { $txt } }
} catch {
  $sw.Stop()
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  "失败 · HTTP $code · $path"
  if ($_.Exception.Response) {
    $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    $sr.ReadToEnd()
  } else { $_.Exception.Message }
}
