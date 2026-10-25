# 安装与部署

本文档说明如何在一台全新的 Windows 机器上把本接口跑起来。整套东西只依赖**本机上的交易客户端**，不需要券商 API、不需要外网。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 10 / 11（64 位） | 需要 Windows 自带 OCR（`Windows.Media.Ocr`） |
| Python | **3.12（64 位）** | 32 位 Python 与 64 位客户端混用会读不到控件 |
| 交易客户端 | 网上股票交易系统 5.0（`xiadan.exe`） | 已安装、已能人工登录下单 |
| 屏幕 | 分辨率 ≥ 1280×800，缩放 100% | 表格是按像素截屏识别的，缩放会改变坐标 |
| 语言包 | 简体中文（`zh-Hans-CN`） | OCR 引擎按这个语言识别表格数字 |

> **重要**：本接口不做登录、不碰账号密码。客户端必须**由人工启动并登录**，接口只在已登录的界面上做查询/下单/撤单。

---

## 2. 安装步骤

### 2.1 装 Python

到 <https://www.python.org/downloads/windows/> 下载 **Windows installer (64-bit)** 的 3.12.x，安装时勾选：

- ☑ Add python.exe to PATH
- ☑ Install for all users（可选）

验证：

```bat
python -V
:: 应输出 Python 3.12.x
python -c "import struct; print(struct.calcsize('P')*8, 'bit')"
:: 应输出 64 bit
```

### 2.2 确认 OCR 语言包

```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'Language.OCR*'
```

需要 `Language.OCR~~~zh-CN~0.0.1.0` 处于 **Installed**。没有就装：

```powershell
Add-WindowsCapability -Online -Name "Language.OCR~~~zh-CN~0.0.1.0"
```

（`Add-WindowsCapability` 需要管理员权限，且可能要联网。）

### 2.3 解压程序并装依赖

把压缩包解压到任意目录，例如 `D:\jyauto`，然后：

```bat
cd /d D:\jyauto
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

:: 配置：仓库只提供模板，真实配置含 API Key/本机路径，不入库
copy config.example.yaml config.yaml
```

依赖说明：

| 包 | 用途 |
| --- | --- |
| `pywinauto` / `comtypes` / `pywin32` | 操作客户端窗口、控件 |
| `fastapi` / `uvicorn` / `pydantic` | 本地 HTTP 接口 |
| `PyYAML` | 读 `config.yaml`、`selectors.yaml` |
| `rapidocr-onnxruntime` | **主 OCR 引擎**（离线，模型随包分发）。小字号中文准确率远高于系统引擎 |
| `winsdk` | Windows 自带 OCR，作为 RapidOCR 不可用时的兜底 |
| `pillow` / `numpy` | 截屏与图像处理 |
| `pytest` / `httpx` | 跑自带测试 |

> `rapidocr-onnxruntime` 会连带安装 `onnxruntime` 与 `opencv-python`，总体约 75MB。
> 未安装时程序自动回退到 Windows 自带 OCR（`winsdk`），仍可运行，但持仓表的名称、价格容易被认错。
> 也可用环境变量 `THSAPI_OCR_ENGINE=rapid|windows|auto` 强制指定引擎（默认 auto）。

> 装 `winsdk` 如果报编译错误，先装 Microsoft Visual C++ Build Tools，或直接装 `pip install winsdk==1.0.0b10`。

### 2.4 自检

```bat
cd /d D:\jyauto
python -m pytest tests -q
```

期望结果：`22 passed`。这一步不需要客户端。

---

## 3. 启动客户端

1. 打开 **网上股票交易系统 5.0**（`xiadan.exe`）；
2. 用资金账号登录，进到主界面（左侧能看到「买入/卖出/撤单/查询」导航树）；
3. **窗口保持打开，不要最小化到托盘**（接口要截屏识别表格）；
4. 关掉无关的浮动窗口（如「收益曲线」图表会挡住表格）。

接口启动时会自动检查：客户端没运行 → `client_not_running`；没登录 → `client_not_logged_in`。

---

## 4. 配置

编辑 `config.yaml`。下面是最关键的几项：

```yaml
server:
  host: 127.0.0.1      # 只给本机量化程序用就填 127.0.0.1；局域网访问填 0.0.0.0
  port: 8888
  api_key: ""          # 留空=不鉴权（仅限内网！）；要鉴权就填一串随机字符
  request_timeout_s: 18   # 查询类接口总超时
  order_timeout_s: 30     # 下单/撤单总超时
  serialize: true         # 串行保护：同一时刻只跑一个接口

trading:
  broker: ths
  mode: dry_run        # ★ 默认演练模式：只走到填单，不点提交
  grid_read: ocr

client:
  title_re: ".*网上股票交易系统.*"
  exe_path: "C:\\同花顺软件\\同花顺\\xiadan.exe"   # 改成你自己的安装路径

safety:
  allow_out_of_hours: false
  max_order_amount: 2000        # 单笔金额上限（元），建议先设小
  max_daily_orders: 50
  allowed_symbols: []           # 空=不限；建议填 ["513xxx","159xxx"] 之类的白名单
```

**第一次跑务必保持 `mode: dry_run`**，确认查询数据、填单动作都正确后，再改成 `live`。

---

## 5. 启动与验证

### 5.1 一键安装（推荐）

```bat
D:\jyauto\deploy\install.bat
```

它会：创建虚拟环境 `.venv` → 装 `requirements.txt` → 跑环境自检（Python 位数 / 依赖 / OCR 语言包 / 端口 / 客户端进程）。

### 5.2 启动

```bat
D:\jyauto\deploy\start.bat
```

日志同时输出到控制台和 `logs\api.log`。也可以手工启动：

```bat
cd /d D:\jyauto
python -m thsapi serve
```

看到这行就成功了：

```
thsapi 已启动: http://0.0.0.0:8888/docs  (broker=ths, mode=dry_run)
```

### 5.3 停止

```bat
D:\jyauto\deploy\stop.bat          :: 停 8888
D:\jyauto\deploy\stop.bat 8899     :: 指定端口
```

### 5.4 验证

```bat
curl http://127.0.0.1:8888/api/v1/health
```

正常返回：

```json
{"ok": true, "client_running": true, "client_logged_in": true,
 "mode": "dry_run",
 "detail": {"request_timeout_s": 18.0, "order_timeout_s": 30.0, "serialize": true, "busy": false}}
```

接口文档页：<http://127.0.0.1:8888/>（中文说明 + 参数 + 截图 + 试一下）
Swagger：<http://127.0.0.1:8888/docs>

### 5.5 长期部署（开机自启、防火墙、备份、升级）

见 [`deploy/DEPLOY.md`](deploy/DEPLOY.md)，包含：

- 生产目录布局
- 管理员权限注册开机自启（`deploy\install_autostart.bat`）
- 局域网放行（`deploy\open_firewall.bat`）
- 日志位置与归档、台账备份
- 升级/回滚步骤、日常巡检清单、故障应急表

---

## 6. 首次校准（客户端版本不同时）

如果接口报 `ui_element_not_found`，说明控件位置/标签对不上，需要重新校准：

```bat
python tools\calibrate.py
```

它会把当前页面的控件树 dump 到 `runtime/`，对照 `selectors.yaml` 修改标签或 automation_id。

OCR 识别不准时（数字读错、列错位）：

```bat
python tools\calibrate_ocr.py
```

---

## 7. 目录说明

```
D:\jyauto
├─ thsapi\             主程序
│  ├─ api.py           HTTP 接口（6 个）
│  ├─ service.py       服务层：风控、幂等台账、串行保护、超时
│  ├─ guard.py         风控规则（整手/金额/价格偏离/交易时段）
│  ├─ journal.py       SQLite 台账（client_order_id ↔ 合同编号 ↔ order_key）
│  ├─ models.py        数据结构
│  ├─ webdocs.py       文档页
│  └─ gui\             客户端操作层
│     ├─ ths.py        切页、填单、下单、撤单
│     ├─ ocr_table.py  截屏 + Windows OCR 读表格
│     ├─ grid.py       表头归一化、数值解析
│     └─ window.py / winapi.py / controls.py
├─ tools\              运维工具（校准、对账、压测）
├─ deploy\             部署脚本（安装/启动/停止/自启/防火墙）+ DEPLOY.md
├─ tests\              单元测试
├─ examples\           量化侧调用示例（quant_client.py）
├─ docs\API.md         接口详细文档
├─ static\shots\       文档页用的界面截图
├─ data\orders.db      运行后自动生成的台账
├─ config.yaml         配置
├─ selectors.yaml      控件定位校准
├─ requirements.txt    依赖
├─ run_api.bat         一键启动
└─ INSTALL.md          本文件
```

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `client_not_running` | 客户端没开 | 打开并登录客户端 |
| `client_not_logged_in` | 没登录 / 停在登录框 | 人工登录到主界面 |
| `client_needs_attention` | 客户端有弹窗挡着 | 到客户端点掉弹窗；返回里带弹窗按钮名 |
| `ui_element_not_found` | 客户端版本变了，控件对不上 | 跑 `tools\calibrate.py` 重新校准 |
| 查询返回全 0 / 空 | 页面没刷新，或被浮动窗口挡住 | 关掉「收益曲线」等浮窗；接口会自动重试一次 |
| `ui_timeout` | 界面 18 秒（下单 30 秒）没完成 | 看客户端是否卡在弹窗；必要时重启客户端 |
| OCR 数字读错 | 屏幕缩放不是 100% / 字体改过 | 恢复 100% 缩放；跑 `tools\calibrate_ocr.py` |
| 端口被占用 | 8888 已被别的程序用 | 改 `server.port` |
| `pip install winsdk` 失败 | 缺编译工具 | 装 VC++ Build Tools，或用预编译 wheel |

日志在控制台输出；需要落盘可以重定向：

```bat
python -m thsapi serve > logs\api.log 2>&1
```

---

## 9. 安全须知

1. **默认 `dry_run`**：只填单不提交，可以放心测；
2. 改 `live` 前，先把 `safety.max_order_amount` 调小（如 2000 元）、配上 `allowed_symbols` 白名单；
3. `server.api_key` 留空等于**任何能访问到这个端口的人都能下单**，只建议在 `host: 127.0.0.1` 下这样用；
4. 接口**不做登录**，也不会保存账号密码；
5. 下单/撤单都会回读「当日委托」核实，核实不到会返回 `order_result_unknown`（502），**此时委托可能已经成交，必须人工核对**。

---

## 10. 卸载

```bat
:: 1. 停掉服务（Ctrl+C 或关窗口）
:: 2. 删除目录即可，不写注册表
rmdir /s /q D:\jyauto
```

如果装过依赖想清理：

```bat
python -m pip uninstall -y pywinauto comtypes pywin32 fastapi uvicorn pydantic PyYAML winsdk pillow numpy
```

---

## 11. 版本

- 程序版本：`0.1.0`
- 打包日期：2026-10-23
- 适用客户端：网上股票交易系统 5.0（2026 年版本界面）
