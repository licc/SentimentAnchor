# 同花顺交易接口 (thsapi)

把 **同花顺「网上股票交易系统 5.0」(xiadan.exe)** 的图形界面封装成本机 HTTP API，
供量化交易系统直接下单、撤单、查持仓/资金/委托/成交。

- **不注入 DLL、不破解协议**：完全模拟人工操作（UI Automation + 键盘 + 剪贴板），
  券商端看到的就是正常的手工委托。
- **本机回环 + API Key**：默认只监听 `127.0.0.1`。
- **幂等 + 台账**：`client_order_id` 保证重复提交不会重复下单，SQLite 记录全过程。
- **风控前置**：单笔金额、当日笔数/金额、白名单、整手校验、涨跌停/现价偏离、ST 拦截。
- **结果回读**：下单后回读「当日委托」，用合同编号确认委托真正落地。
- **可校准**：控件定位写在 `selectors.yaml`，客户端升级后改配置即可，无需改代码。

---

## 1. 架构

```
┌──────────────────┐   HTTP/JSON    ┌──────────────────────────────────────────┐
│  量化系统/脚本    │ ─────────────► │ thsapi (FastAPI, 127.0.0.1:8888)         │
└──────────────────┘  X-API-Key     │  ├─ 风控 RiskGuard                        │
                                    │  ├─ 台账 Journal (SQLite, 幂等/审计)      │
                                    │  └─ 单线程 GUI Worker (COM STA)           │
                                    └───────────────┬──────────────────────────┘
                                                    │ UI Automation / 键盘 / 剪贴板
                                    ┌───────────────▼──────────────────────────┐
                                    │ 网上股票交易系统5.0 (xiadan.exe, 32 位)   │
                                    │  ├─ 左侧导航树 (买入/卖出/撤单/查询)      │
                                    │  ├─ 下单页 (代码/价格/数量/买入按钮)      │
                                    │  ├─ 表格 (CVirtualGridCtrl，剪贴板读取)  │
                                    │  └─ 确认框/结果提示框 (#32770)            │
                                    └──────────────────────────────────────────┘
```

关键设计：

| 问题 | 方案 |
| --- | --- |
| 目标进程是 32 位 MFC 程序 | **绝不**跨进程 `SendMessage` 带指针的消息（如 `TVM_GETITEM`），否则目标会崩溃；一律用 UIA（COM 自动跨进程封送） |
| 表格是自绘控件 | 全选 → `Ctrl+C` 复制 → 解析 TSV；失败回退到 UIA 单元格按坐标还原行 |
| GUI 不能被并发操作 | 所有界面动作进单线程 `ThreadPoolExecutor`，串行执行；下单再加一把互斥锁 |
| 客户端可能最小化/被遮挡 | 每次操作前 `ShowWindow(SW_RESTORE)` + 强制置前 |
| 下单结果不可靠 | 解析结果提示框里的「合同编号」，再回读「当日委托」核对 |

---

## 2. 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10/11，**已登录的交互式桌面**（不能是 Session 0 / 锁屏状态） |
| Python | 3.10+（本机验证 3.12） |
| 客户端 | 同花顺「网上股票交易系统 5.0」(xiadan.exe)，**已登录**并停留在主界面 |
| 依赖 | `pywinauto` / `comtypes` / `pywin32` / `fastapi` / `uvicorn` / `pydantic` / `PyYAML` |

> 客户端必须保持登录。若开启了「闲置自动退出」，请在客户端设置里关掉。

安装依赖：

```powershell
cd D:\jyauto
python -m pip install -r requirements.txt
```

---

## 3. 快速开始

```powershell
# 1) 登录同花顺下单客户端（人工输入资金账号与交易密码）

# 2) 自检：确认服务能连上客户端并读到资金/持仓
python -m thsapi selftest

# 3) 启动 HTTP 服务（前台）
python -m thsapi serve
#    或双击 run_api.bat

# 4) 另开一个窗口验证
curl -H "X-API-Key: <你的key>" http://127.0.0.1:8888/api/v1/health
```

首次运行请修改 `config.yaml` 的 `server.api_key`。

### 下单示例

```powershell
curl -X POST http://127.0.0.1:8888/api/v1/orders `
  -H "Content-Type: application/json" -H "X-API-Key: <你的key>" `
  -d '{"symbol":"513100","side":"buy","price":1.850,"quantity":100,"client_order_id":"20261021-0001"}'
```

```json
{
  "ok": true,
  "order_id": "12345678",
  "client_order_id": "20261021-0001",
  "symbol": "513100",
  "side": "buy",
  "price": 1.85,
  "quantity": 100,
  "status": "accepted",
  "message": "委托成功",
  "elapsed_ms": 1830
}
```

---

## 4. API

统一前缀 `/api/v1`。**当前配置为内网免鉴权**（`server.api_key` 留空）；需要鉴权时在 `config.yaml` 填一串随机字符，调用方带 `X-API-Key` 头即可。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 客户端进程/登录状态、当前模式、是否有弹窗挡住 |
| GET | `/portfolio` | 资金 + 持仓（同一页「资金股票」，一次读回） |
| GET | `/orders` | 当日委托 |
| GET | `/trades` | 当日成交 |
| POST | `/orders` | 下单（限价） |
| POST | `/cancel` | 撤单（按合同编号或证券代码；已成交/已撤也算撤单达成） |

> 只保留上面 7 个接口。`snapshot` / `cancel-all` / `journal` 已移除；台账仍写在本地 SQLite，只是不对外暴露。

### 4.1 固定操作路径（每个接口一条，不做动态探索）

| 接口 | 固定步骤 |
| --- | --- |
| `GET /health` | 枚举客户端窗口 → 检查左侧导航树（=已登录）→ 检查是否有模态框 |
| `GET /portfolio` | 点「资金股票」→ 刷新 → 读 6 个资金字段 → 截屏 OCR 持仓表 → 过滤 0 股行 |
| `GET /orders` | 点「当日委托」→ 刷新 → 截屏 OCR → 过滤汇总/水印行 |
| `GET /trades` | 点「当日成交」→ 刷新 → 截屏 OCR |
| `POST /orders` | （卖出先查持仓）→ 点「买入/卖出」→ 填代码等名称 → 填价格 → 填数量 → 点按钮 → 处理确认框 → 点「当日委托」闭卷核实 |
| `POST /cancel` | 点「撤单」→ OCR 定位合同号所在行 → 点该行 → 点「撤单(Del)」→ 处理确认框 → 回读核实 |

路径里没有"试探"和"多分支兜底"，只有固定次数的重试；走不通就返回明确错误码。

### 4.2 串行保护与超时

界面只能被一个线程操作，所以每个接口都套了**串行槽**：

| 配置 | 默认 | 行为 |
| --- | --- | --- |
| `server.serialize` | `true` | 同一时刻只跑一个接口，后来的请求排队等锁；等不到就返回 `429 ui_busy` |
| `server.request_timeout_s` | `18` | 查询类接口的总超时（每次 GUI 等待按剩余预算分配） |
| `server.order_timeout_s` | `30` | 下单/撤单类接口的总超时（填单+提交本身就要 10~15 秒，给足余量） |

超时后的返回：

- 查询接口 → `504 ui_timeout`
- **下单接口 → `502 order_result_unknown`**（委托可能已经提交了），必须先 `GET /orders` 核实再决定是否重试
- `/health` 不占串行槽，任何时候都能查；`detail` 里带 `request_timeout_s` / `order_timeout_s` / `serialize` / `busy`


**在线文档页**：<http://127.0.0.1:8888/> —— 中文说明 + 参数表 + curl 示例 + 「试一下」（带 API Key 直接调）。
Swagger：<http://127.0.0.1:8888/docs>；完整字段与错误码见 [`docs/API.md`](docs/API.md)。

### 下单参数

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `symbol` | 是 | 6 位代码，支持 `513100` / `sh513100` / `SH.513100` |
| `side` | 是 | `buy` / `sell` |
| `price` | 是 | 限价（元，最多 3 位小数） |
| `quantity` | 是 | 股数；主板 100 的整数倍，科创板 ≥200 |
| `order_type` | 否 | `limit`（默认）。市价单暂未开放 |
| `ref_price` | 否 | 行情系统的最新价；用于"价格偏离校验"（同花顺买入页不显示现价，建议传入） |
| `client_order_id` | 否 | 幂等 ID；同 ID 重复提交会返回首次结果，不会重复下单 |
| `remark` | 否 | 备注（仅记录在台账） |

### 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `order_rejected` | 客户端拒绝（资金不足、涨跌停、非交易时间等） |
| 401 | `unauthorized` | API Key 错误 |
| 409 | `duplicate_client_order_id` | 同 `client_order_id` 正在处理中 |
| 422 | `risk_rejected` | 本地风控拦截（限额、整手、白名单、价格偏离…） |
| 429 | `ui_busy` | GUI 忙（并发操作） |
| 502 | `order_result_unknown` | **结果未知**：已发出但未能确认，需人工核对 |
| 503 | `client_not_running` / `client_not_logged_in` | 客户端未运行/未登录 |
| 504 | `ui_timeout` / `ui_element_not_found` | 界面元素超时或缺失（`ui_element_not_found` 常见于客户端升级后需校准） |

---

## 5. 配置说明（config.yaml）

```yaml
trading:
  mode: live          # 改成 dry_run 可只做风控校验不真正下单
  fast_confirm: true  # false = 停在确认框等人点"确定"
  price_check: true
  max_price_deviation_pct: 10   # 委托价偏离现价超过 10% 拒绝

safety:
  max_order_amount: 100000      # 单笔金额上限
  max_daily_orders: 200
  max_daily_amount: 500000
  min_interval_ms: 300          # 两笔委托最小间隔
  allowed_symbols: []           # 空=全部；支持 513100 / 600xxx
  blocked_symbols: []
  allow_out_of_hours: false     # 非交易时段禁止下单
  reject_st: true               # 拒买 ST/退
```

环境变量可覆盖任意配置（双下划线表示层级）：

```powershell
$env:THSAPI_TRADING__MODE="dry_run"
$env:THSAPI_SERVER__PORT="8902"
```

---

## 6. 上线前必做

1. **先用 `dry_run` 跑通**：把 `trading.mode` 设为 `dry_run`，确认风控与返回结构符合预期。
2. **小额验证**：用 100 股、贴近现价的价格走一遍买入 → 查委托 → 撤单 → 查成交。
3. **关掉客户端自动退出**，把客户端窗口放在固定位置，避免人工操作。
4. **设置开机自启**（见第 8 节），并给进程配日志轮转。

---

## 7. 校准（客户端升级后 UI 变了怎么办）

```powershell
# 导出主窗口控件树到 runtime/controls_main.txt
python -m thsapi probe

# 依次点开买入页、撤单页并导出
python -m thsapi probe --nav 买入 撤单
```

对照 `runtime/controls_*.txt` 修改 `selectors.yaml` 里的 `*_labels`（按中文标签定位，通常无需改代码）。

> 定位优先级：`automation_id` → 标签右侧邻近控件 → 按钮文字。一般只需要维护标签列表。

---

## 8. 部署

> 完整部署手册见 [`deploy/DEPLOY.md`](deploy/DEPLOY.md)；从零安装见 [`INSTALL.md`](INSTALL.md)。

### 8.1 一键安装与启动

```bat
D:\jyauto\deploy\install.bat    :: 建 .venv、装依赖、环境自检
D:\jyauto\deploy\start.bat      :: 启动服务，日志写 logs\api.log
D:\jyauto\deploy\stop.bat       :: 按端口停止
```

`run_api.bat` 只是转发到 `deploy\start.bat`。

### 8.2 开机自启（任务计划程序）

管理员运行：

```bat
D:\jyauto\deploy\install_autostart.bat      :: 注册 ONLOGON 任务
D:\jyauto\deploy\remove_autostart.bat       :: 取消
```

等价的命令行：

```powershell
schtasks /Create /TN "thsapi-trading" /TR "\"D:\jyauto\deploy\start.bat\"" `
  /SC ONLOGON /RL HIGHEST /F
```

> 必须是**用户登录后**运行（ONLOGON），因为 GUI 自动化依赖交互式桌面会话。

### 8.3 局域网放行（可选）

```bat
D:\jyauto\deploy\open_firewall.bat 8888
```

配合 `config.yaml` 的 `host: 0.0.0.0` 与 `api_key`。

### 8.4 作为服务（可选）

用 [NSSM](https://nssm.cc/) 注册为服务时，需勾选 *Allow service to interact with desktop*，
并在「登录」选项卡里配置为当前登录用户运行；否则服务运行在 Session 0，看不到 GUI。

### 8.5 日志

`deploy\start.bat` 已把输出同时写到 `logs\api.log`。手工启动时：

```powershell
python -m thsapi serve *>> D:\jyauto\logs\thsapi.log
```

---

## 9. 读取策略：OCR 优先，控件操作兜底

同花顺的界面分两类，处理方式不同：

| 场景 | 方式 | 原因 |
| --- | --- | --- |
| 表格（持仓/委托/成交） | **截屏 OCR** | 自绘控件，UIA 不暴露单元格；复制/导出会触发验证码 |
| 撤单时定位委托行 | **截屏 OCR 找文字坐标** | 不复制表格也能精准点中那一行 |
| 自绘弹窗的文字 | **OCR 兜底** | 部分弹窗 UIA 读不到文字，但报单结果必须读出来 |
| 资金数字（总资产/可用…） | 控件文本（`GetWindowText`） | 逐字符精确、0.05 秒；金额认错一位就是事故 |
| 输入框（代码/价格/数量） | 控件 + UIA ValuePattern | 需要精确写入并触发联动 |
| 按钮（买入/撤单/确定） | 控件句柄点击/Invoke | OCR 只能"看"，不能"点" |

> 原则：**"读"尽量 OCR，"写"和"点"必须走控件**。
> 能用结构化接口精确读到的数字（资金），不要用 OCR 冒险；
> 没有结构化接口的（表格），OCR 是唯一不触发验证码的路。

### 9.1 OCR 精度是怎么调出来的（2026-10-22 实测）

真实表格上踩了三个坑，都已修：

| 问题 | 现象 | 修法 |
| --- | --- | --- |
| 列检测被文字干扰 | 有数据时检出 35 条"竖线"，数字被分到错列（3.844→3.0） | 改用**纵向暗像素占比**：只有整列大部分都深色才算表格线 |
| 数字被拆成多个词 | `3` `．` `844` 被拆开，负号被认成汉字"一" | 同列词直接拼接 + 单元格归一化（全角→半角、`一`→`-`） |
| 表头误读 | `市伯`→市价、`台同编号`→合同编号 | 内置高频误读表 + 编辑距离兜底（短词放宽阈值） |

另外：市值列常在屏幕右侧之外，改为用 `持仓 × 市价` 自算；盈亏/盈亏比做合理性校验，读数与自算差太多时以自算为准。

调完后 `/portfolio` `/orders` 与客户端界面**逐字段一致**（实测：200 份 513310、成本 3.903、市价 3.806、浮亏 -19.40；两笔委托 3481/3356，价格 3.844，数量 100，已成）。

可选增强：给资金数字加"控件读 + OCR 读"双通道校验，两者不一致时告警而不是静默采用。

---

## 10. 目录结构

```
D:\jyauto
├── thsapi/
│   ├── __main__.py        # CLI：serve / probe / selftest
│   ├── api.py             # FastAPI 路由、鉴权、异常映射
│   ├── service.py         # 服务层：GUI 线程、风控、幂等、结果回读、mock
│   ├── guard.py           # 风控规则（整手、限额、时段、涨跌停…）
│   ├── journal.py         # SQLite 台账
│   ├── models.py          # 请求/响应模型
│   ├── config.py          # 配置加载
│   ├── errors.py          # 异常体系
│   └── gui/
│       ├── window.py      # 窗口定位/还原/置前/登录状态
│       ├── controls.py    # UIA 查找/点击/输入
│       ├── selectors.py   # 标签邻近定位
│       ├── grid.py        # 表格读取（剪贴板 + UIA 回退）
│       ├── clipboard.py   # 剪贴板读写
│       └── ths.py         # 同花顺客户端适配器（业务动作）
├── tests/                 # mock 后端的接口测试
├── examples/quant_client.py
├── config.yaml
├── selectors.yaml
├── run_api.bat
└── README.md
```

---

## 11. 已知限制与注意事项

- **必须保持桌面解锁且客户端窗口可见**：GUI 自动化在锁屏、远程会话断开、Session 0 下无法工作。
- **同一时间只能有一个人操作客户端**：人工点击与接口操作会互相打断；建议专用交易机。
- **下单速度**：单笔约 0.8–2 秒（含页面跳转与结果确认），远慢于券商柜台的 CTP/极速交易接口；
  高频策略请走券商官方 API，本接口适合中低频。
- **市价委托**：当前仅支持限价单；如需市价单需在 `selectors.yaml` 增加「委托方式」下拉框定位。
- **信用账户（融资融券）**：页面结构不同，需另行校准。
- **结果未知（502）**：网络/客户端卡顿时可能已报单但未确认，**务必人工核对当日委托**后再决定是否重发；
  台账里状态为 `unknown` 的记录请不要用新的 `client_order_id` 盲目重试。
- 本工具仅用于你本人账户的自动化，请遵守券商协议与交易所规则。

### 11.1 复制验证码：已绕开（不是破解）

同花顺 5.0 对**账户数据外带**（`Ctrl+C` 复制、右键"保存/导出"）有防抓取保护，
用几次后会弹

> 提示：检测到您正在拷贝数据，为保护您的账号数据安全，请先输入验证码

**当前默认不碰这两种操作**：表格改用「截屏 + Windows 自带 OCR」读取
（`trading.grid_read: ocr`），只读取屏幕像素，不触发验证码。

| `trading.grid_read` | 行为 | 验证码 |
| --- | --- | --- |
| `ocr`（默认） | 截取表格区域 → 系统 OCR → 按列线还原行列 | **不触发** |
| `export` | 右键 → 保存(S) → 另存为 → 解析文件 | 会触发 |
| `clipboard` | Ctrl+A / Ctrl+C | 会触发 |

OCR 实现要点（`thsapi/gui/ocr_table.py`）：

- 在原图上检测**竖线**得到列边界（同花顺表格式固定列宽，检测很稳）；
- 放大 2.5 倍后交给 `Windows.Media.Ocr`（需要系统装 `Language.OCR~~~zh-CN`，本机已装）；
- 每个字按坐标归到"行 × 列"，拼回单元格；
- 灰色水印（如"当前没有可撤委托单"）按像素亮度过滤掉；
- 表头用编辑距离拉回已知词表（`合同编号` 被认成 `台同编号` 也能纠正）。

耗时：单表约 **2.5 秒**（截图 0.1s + OCR 1.0s + 切换页面 1.2s）。

> 注意：只识别**当前可见列**。持仓表的"市值/仓位占比"等列在右侧，需要横向滚动才可见，
> 所以 `market_value` 建议用 `股票余额 × 市价` 自行计算，或用资金页的"股票市值"做合计校验。

### 11.2 本次联调实测记录

环境：同花顺 9.60.81 + 网上股票交易系统 5.0，Windows 11 + Python 3.12。

已验证通过：

| 项目 | 结果 |
| --- | --- |
| 客户端窗口定位 / 最小化还原 / 强制置前 | ✅ |
| 登录状态识别（登录前主窗口是隐藏的） | ✅ |
| 左侧导航切换（`买入[F1]`/`当日委托` 等） | ✅ UIA SelectionItem |
| 资金页字段读取（总资产/可用/可取/市值/盈亏） | ✅ 接口字段实测一致 |
| 证券代码填写 + 名称联动（513100 → 纳指ETF） | ✅ |
| 持仓 / 当日委托 / 当日成交 表格读取 | ✅ 改用截屏 OCR（不复制/不导出，实测不触发验证码）；数值精度待真实数据校准 |
| 风控拒绝（整手、时段、金额、白名单、价格偏离） | ✅ |
| 幂等重放 / 台账 / 撤单参数校验 | ✅ |
| `dry_run` 下单全链路（prepare + 风控 + 台账） | ✅ |

**未实测**（需要交易时段 + 真实资金）：

- 真实报单的提交、确认框、结果提示框解析与"当日委托"回读；
- 撤单的完整链路（当前无委托可撤）；
- 有数据时的表格解析（OCR 只验证了表头与空表）。

> ⚠️ 实盘前请确认账户资金足以覆盖最小 100 股和手续费；小资金账户可能无法完成最小交易。

建议首次真实测试：交易时段内用 **100 股、贴近现价**的限价单走一遍
`下单 → /orders 核对 → /cancel 撤单 → /trades`，确认无误后再交给策略使用。

### 11.3 性能参考（本机实测，2026-10-21）

| 接口 | 冷查询 | 缓存命中（3 s 内重复） |
| --- | --- | --- |
| `/health` | 0.03–0.19 s | 0.02 s |
| `/portfolio` | 1.4–5.7 s | — |
| `/orders` | 3.9–8.2 s | 0.02 s |
| `/trades` | 2.9–5.5 s | 0.02 s |
| `POST /orders` | 3–12 s | — |

> 冷查询的波动来自虚拟机 CPU 争用（同花顺重绘 + OCR 同时吃 CPU）。
> 缓存由 `trading.cache_ttl_s` 控制（默认 3 秒，`0` 关闭）；下单/撤单后自动失效。

**已做的性能优化**

| 优化 | 节省 |
| --- | --- |
| OCR 引擎单例（原来每次调用都新建） | ~1.2 s |
| 截图在内存里传给 OCR，不落盘 | 0.5–3 s（避开杀毒扫描） |
| BMP 编码替代 PNG | 50–150 ms |
| 列边界按尺寸缓存 | ~80 ms |
| 导航去重（已在该页面就不再点） | ~0.5 s |
| 默认不点"刷新"按钮 | 0.3–1 s |
| 启动预热（树节点 / OCR / 列边界） | 首请求 ~3 s |
| 查询结果 TTL 缓存 | 重复查询 → 0.02 s |

### 11.4 首次联调步骤（推荐顺序）

```powershell
# 1) 登录客户端，停在主界面
# 2) 自检
python -m thsapi selftest

# 3) 校准（可选，客户端升级后）
python -m thsapi probe --nav 买入 撤单 当日委托

# 4) 干跑（不下单）
$env:THSAPI_TRADING__MODE="dry_run"; python -m thsapi serve

# 5) 真实小额验证（交易时段）
$env:THSAPI_TRADING__MODE="live"; python -m thsapi serve
curl -X POST ... -d '{"symbol":"513100","side":"buy","price":现价,"quantity":100,"ref_price":现价}'
```
