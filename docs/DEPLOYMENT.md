# 部署与操作指引

面向「按步骤把它跑起来」的文档。想了解设计看 [ARCHITECTURE.md](ARCHITECTURE.md)，
想看接口清单看 [API.md](API.md)，适配器自身的安装细节看
[thsapi/INSTALL.md](../thsapi/thsapi-0.1.0-20261023/INSTALL.md)。

---

## 1. 这套东西由什么组成

| 组件 | 端口 | 技术栈 | 作用 | 是否必需 |
| --- | --- | --- | --- | --- |
| 前端 | 5173 | Vite + React | 看板界面，开发模式下由 Vite 提供并代理 `/api` | 必需 |
| 后端 API | 8787 | Node + Express | 行情采集、情绪评分、策略、风控、券商队列 | 必需 |
| thsapi 适配器 | 8888 | Python + FastAPI | 通过 GUI 自动化操控同花顺下单客户端 | 只有真实交易需要 |
| 同花顺交易客户端 | — | 网上股票交易系统 5.0 | 由 thsapi 驱动；**必须人工启动并登录** | 只有真实交易需要 |

只做行情看板（不下单）时，**只需启动 1 + 2**，thsapi 可以不装。

---

## 2. 前置条件

| 项 | 要求 | 检查命令 |
| --- | --- | --- |
| 操作系统 | Windows 10/11 64 位 | `[Environment]::Is64BitOperatingSystem` |
| Node.js | ≥ 20.10（建议 22/24 LTS） | `node -v` |
| pnpm | ≥ 11 | `pnpm -v` |
| Python（仅 thsapi） | **3.12，64 位** | `python -V` / `python -c "import struct;print(struct.calcsize('P')*8)"` |
| 同花顺客户端（仅交易） | 已安装、能人工登录下单 | 客户端窗口标题含「网上股票交易系统」 |
| 显示设置（仅交易） | 缩放 100%，分辨率 ≥ 1280×800 | 设置 → 显示 → 缩放 |
| OCR 语言包（仅 thsapi） | `Language.OCR~~~zh-CN` 已安装 | `Get-WindowsCapability -Online \| ? Name -like 'Language.OCR*zh-CN*'` |

> thsapi 会驱动图形界面，**必须在已登录的桌面会话里运行**，不能当 Windows 服务跑在 Session 0。

---

## 3. 首次部署（照着做）

```powershell
# 1) 取代码
cd E:\
git clone https://github.com/licc/SentimentAnchor.git
cd SentimentAnchor

# 2) 装前端/后端依赖（Node 必须先就绪）
pnpm install

# 3) 生成配置文件
copy .env.example .env
notepad .env      # 至少确认 HOST / PORT；需要局域网访问见第 6 节
```

```powershell
# 4) thsapi：建虚拟环境并装依赖（Python 3.12 64 位）
cd thsapi\thsapi-0.1.0-20261023
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest tests -q      # 期望 22 passed

# 5) 改适配器配置：exe_path 指向你的客户端，首次务必保持 dry_run
notepad config.yaml
#   client.exe_path : "D:\\同花顺软件\\同花顺\\xiadan.exe"（按实际路径）
#   trading.mode    : dry_run
#   server.host     : 127.0.0.1（只本机用）；局域网见第 6 节
#   server.api_key  : 留空=不鉴权；对外暴露必须填写
```

```powershell
# 6) 启动全部（前端 + 后端 + thsapi）
cd E:\SentimentAnchor
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 start

# 7) 验收
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 status
powershell -ExecutionPolicy Bypass -File scripts\api.ps1 health
```

打开 <http://127.0.0.1:5173> 应看到看板；<http://127.0.0.1:8888/api/v1/health> 应返回 `"ok": true`。

---

## 4. 日常启停与日志

```powershell
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 start    # 启动
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 stop     # 停止
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 status   # 看端口与 PID
```

| 日志 | 位置 |
| --- | --- |
| 前端 + 后端（含 `[stream]`/`[market]`/`[security]` 打点） | `data\run\dev.log` |
| 启动脚本自身的 stderr | `data\run\dev.err.log` |
| thsapi | `data\run\thsapi.out.log` / `thsapi.err.log` |

`data\` 已加入 `.gitignore`，日志与运行时文件不会被提交。

> 需要开机自启：thsapi 自带 `deploy\install_autostart.bat`（计划任务，需管理员）。
> 前端/后端建议用「任务计划程序 → 登录时运行」指向 `scripts\services.ps1 start`。

---

## 5. 验收清单（每次改动后跑一遍）

```powershell
# 后端健康 + 数据源状态（期望 ok=True，sources 里 live 数量≥7）
(Invoke-WebRequest http://127.0.0.1:8787/api/health -UseBasicParsing).Content

# 前端可访问
(Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing).StatusCode   # 200

# thsapi 健康（ok=true / client_logged_in=true / mode=dry_run）
powershell -ExecutionPolicy Bypass -File scripts\api.ps1 health

# 持仓读取（重点看 symbol 是 6 位数字、last_price 量级正常、name 是中文）
powershell -ExecutionPolicy Bypass -File scripts\api.ps1 portfolio
```

`/api/health` 里的 `sseClients` 表示当前挂着推流的浏览器数：页面打开时应 ≥ 1，
为 0 说明页面没订阅上（见第 7 节第一条）。

---

## 6. 局域网访问

三个端口都要放开，缺一个就会出现「页面能开但数据不刷新」之类的半通状态。

```powershell
# 1) 后端监听地址
notepad .env                       # HOST=0.0.0.0
# 2) 前端监听地址（两处都要改，命令行会覆盖配置）
#    package.json  dev:web  → vite --host 0.0.0.0 --port 5173
#    vite.config.ts server.host → '0.0.0.0'
# 3) thsapi（可选）
#    thsapi\...\config.yaml  server.host: 0.0.0.0 且务必设置 server.api_key
```

```powershell
# 4) 防火墙放行（管理员；建议只开本地子网）
New-NetFirewallRule -DisplayName 'sentiment-anchor 5173 (LAN)' -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'sentiment-anchor 8787 (LAN)' -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'thsapi 8888 (LAN)'           -Direction Inbound -Protocol TCP -LocalPort 8888 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

**安全三件套（对外暴露前必做）**

| 项 | 做法 | 不做的后果 |
| --- | --- | --- |
| 前端/后端登录口令 | `.env` 里设 `APP_TOKEN=<长随机串>`，前端会变登录页 | 同网段任何人能看看板、点交易台 |
| thsapi 访问口令 | `config.yaml` 的 `server.api_key`，调用方带 `X-API-Key` | 任何人可查询账户、下单 |
| 交易模式 | 首次务必 `trading.mode: dry_run` | `live` 下点一下就是真钱 |

想让 SentimentAnchor 后端连到带 Key 的 thsapi：`.env` 里同时设 `ETF_BROKER_KEY=<同一把 key>`。

---

## 7. 故障排查

| 症状 | 根因 | 处理 |
| --- | --- | --- |
| 页面数字不动、`sseClients` 为 0 | `EventSource` 收到过合法的非 200（如后端重启瞬间代理报 502），按规范**永久放弃重连** | 已在新版本自建重连；旧页面 `Ctrl+F5` 强刷一次即可恢复 |
| 本机进度环正常、远程不转 | 倒计时依赖 `nextRefreshAt − 设备本地时钟`，远程设备时钟偏差会让它恒为 0 | 新版本改为本地计时；强刷远程页面 |
| 页面能开但接口 404/502 | 只放行了 5173，没放行 8787，而 `/api` 由 Vite 代理转发 | 见第 6 节，三个端口一起放行 |
| `pnpm dev` 报「无效字符」「Windows Script Host」 | `.js` 被系统关联到 WScript（JScript 引擎），不是 Node | 安装官方 Node.js，把 `.js` 关联到 `node.exe`；并确保 PATH 中真 `node.exe` 在其它垫片之前 |
| `pywin32` 导入 `win32ui` 失败 | 缺少 MFC 运行时 `mfc140u.dll` | 安装 VC++ 运行库（vc_redist.x64），或运行 `python -m pywin32_postinstall -install` |
| `/api/v1/*` 返回 401 | 请求头缺 `X-API-Key` 或值不对（注意不要用改之前的旧 Key） | `scripts\api.ps1` 会自动读 `config.yaml`；浏览器里 Swagger 要先点 **Authorize** |
| thsapi 返回 503 `client_not_logged_in` | 客户端掉线/没登录 | 人工重新登录同花顺 |
| thsapi 返回 503 `client_needs_attention` | 客户端弹了需要人工处理的框（提示/验证码/升级） | 去点掉弹窗 |
| 下单返回 502 `order_result_unknown` | 已提交但回读失败，**委托可能已成交** | 先 `GET /api/v1/orders` 核实，再决定是否重试 |
| 持仓 `name` 乱码、`last_price` 放大 1000 倍 | 系统 OCR 在 12px 字高下误识；价格小数点被认成逗号 | 确认已装 `rapidocr-onnxruntime`（新版默认主引擎）；仍异常看 `thsapi.err.log` |
| 顶部「数据降级」长期存在 | `em-window` 依赖的 `push2his.eastmoney.com` 在部分网络下 TLS 被重置 | 程序已降级用缓存；不影响核心行情，可忽略或换网络 |
| 前端显示 `RECONNECTING` | SSE 连接断开（断网、休眠、后端重启） | 新版本会指数退避自动重连；持续不恢复查 `data\run\dev.log` |

---

## 8. 不能进 Git 的文件

| 文件 | 原因 |
| --- | --- |
| `.env` | 含 `APP_TOKEN`、`ETF_BROKER_KEY` 等口令（已在 `.gitignore`） |
| `data/` | 运行日志、台账、临时脚本（已在 `.gitignore`） |
| `data/sentiment.db` | 情绪温度归档（SQLite）。**衍生数据**，丢了可用 `POST /api/sentiment/backfill?days=30` 重新算，不必备份 |
| `thsapi/.../config.yaml` 的本地改动 | 含 `api_key`、本机 `exe_path`、本机监听地址；仓库内保持默认模板即可 |

提交前自查：

```powershell
git status --porcelain
git diff --cached | Select-String 'api_key|APP_TOKEN|X-API-Key|192\.168\.|C:\\Users'
```

---

## 9. 升级与回滚

```powershell
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 stop
git pull
pnpm install                                            # 依赖可能变化
cd thsapi\thsapi-0.1.0-20261023
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest tests -q           # 期望 22 passed
cd ..\..
powershell -ExecutionPolicy Bypass -File scripts\services.ps1 start
```

回滚：`git log --oneline` 找到上一个提交 → `git checkout <sha> -- .` 或 `git revert <sha>`，再重启服务。
适配器的台账 `data\orders.db`（thsapi 目录下）是**唯一能和券商对账的凭据**，升级前务必单独备份。
