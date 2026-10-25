# 部署手册

> 本文只讲 **thsapi 适配器**自身的长期运行（目录布局、自启、日志、备份、升级回滚）。
> 想从零把整套系统（前端 + 后端 + 适配器 + 局域网）跑起来，请看
> [仓库根目录的部署与操作指引](../../../docs/DEPLOYMENT.md)。
> 装 Python、装依赖这类首次安装，看 [../INSTALL.md](../INSTALL.md)。

---

## 1. 生产目录布局

```
D:\jyauto\                      ← 程序目录（解压位置，路径别带中文和空格）
├─ thsapi\                      代码
├─ deploy\                      部署脚本（本目录）
├─ tools\                       运维工具
├─ .venv\                       虚拟环境（deploy\install.bat 生成）
├─ logs\                        运行日志（start.bat 自动创建）
├─ data\orders.db               台账（自动生成，务必定期备份）
├─ runtime\                     调试产物（截图、dump，可随时删）
├─ config.yaml                  配置
└─ selectors.yaml               控件校准
```

不要放在：桌面（会被 OneDrive 同步）、`C:\Program Files`（无写权限）、带中文或空格的路径。

---

## 2. 第一次部署（5 步）

```bat
:: 1) 解压到 D:\jyauto

:: 2) 打开客户端并登录（人工操作，接口不做登录）

:: 3) 安装依赖（会创建 .venv 并自检）
D:\jyauto\deploy\install.bat

:: 4) 生成并修改配置：至少改 client.exe_path；首次保持 trading.mode: dry_run
::    （config.yaml 不在仓库里，用模板复制；它含 API Key 与本机路径，切勿提交）
copy D:\jyauto\config.example.yaml D:\jyauto\config.yaml
notepad D:\jyauto\config.yaml

:: 5) 启动
D:\jyauto\deploy\start.bat
```

启动成功后访问 <http://127.0.0.1:8888/api/v1/health> 应返回 `"ok": true`。

---

## 3. 启动方式

### 方式一：手动（调试期推荐）

```bat
D:\jyauto\deploy\start.bat
```

日志同时输出到控制台和 `logs\api.log`。关窗口即停止。

### 方式二：开机自启（长期运行）

**必须用管理员权限**运行：

```bat
D:\jyauto\deploy\install_autostart.bat
```

它会创建一个登录触发的计划任务 `thsapi-trading`，指向 `deploy\start.bat`。

管理：

```bat
:: 立即启动一次
schtasks /Run /TN "thsapi-trading"

:: 查看状态
schtasks /Query /TN "thsapi-trading" /V

:: 取消自启
D:\jyauto\deploy\remove_autostart.bat
```

### 停止

```bat
D:\jyauto\deploy\stop.bat          :: 默认停 8888
D:\jyauto\deploy\stop.bat 8899     :: 指定端口
```

---

## 4. 局域网访问

默认 `server.host: 127.0.0.1`，只有本机能访问。要让同网段的量化机访问：

1. `config.yaml` 改 `host: 0.0.0.0`
2. **务必设 `api_key`**（留空等于谁都能下单）
3. 放行防火墙（管理员）：

```bat
D:\jyauto\deploy\open_firewall.bat 8888
```

调用方带上请求头：

```
X-API-Key: <你设置的 key>
```

---

## 5. 日志

| 项 | 位置/说明 |
| --- | --- |
| 服务日志 | `logs\api.log`（`start.bat` 追加写入） |
| 台账 | `data\orders.db`（SQLite，含每笔委托的单号、合同号、状态） |
| 控制台 | 前台运行时直接输出 |

日志没有自动轮转。跑久了手动处理：

```bat
:: 停服务后归档
move logs\api.log logs\api-20261023.log
```

或者用 Windows 计划任务每周压缩一次。

---

## 6. 台账备份（重要）

`data\orders.db` 记录了你每一笔单的 `client_order_id ↔ 合同编号 ↔ order_key`，是唯一能和券商对账的凭据。

```bat
:: 每天收盘后备份（可放进计划任务）
copy /y D:\jyauto\data\orders.db D:\jyauto\data\orders-%date:~0,4%%date:~5,2%%date:~8,2%.db
```

同时建议每周把 `config.yaml`、`selectors.yaml` 一起拷走。

---

## 7. 升级与回滚

```bat
:: 1) 停服务
D:\jyauto\deploy\stop.bat

:: 2) 备份（配置 + 台账 + 旧代码）
xcopy /e /i /y D:\jyauto D:\jyauto-bak-%date:~0,4%%date:~5,2%%date:~8,2%

:: 3) 用新包覆盖代码（保留 config.yaml、data\、selectors.yaml）
::    解压新包到临时目录，然后只覆盖 thsapi\ deploy\ tools\ tests\

:: 4) 依赖可能有变，重装一次
D:\jyauto\deploy\install.bat

:: 5) 启动
D:\jyauto\deploy\start.bat
```

回滚就是把 `jyauto-bak-*` 覆盖回来，再 `start.bat`。

**升级后必做**：

```bat
:: 单测
.venv\Scripts\python.exe -m pytest tests -q

:: 接口回归（6 轮循环，只读，不下单）
.venv\Scripts\python.exe tools\cycle_test.py 6
```

---

## 8. 日常巡检清单

| 频率 | 检查 |
| --- | --- |
| 每天开盘前 | 客户端是否已登录；`/health` 的 `ok` 是否为 true |
| 每天收盘后 | 备份 `data\orders.db`；核对当日委托笔数与券商一致 |
| 每周 | 看 `logs\api.log` 有没有反复出现的 `ui_element_not_found` / `ui_timeout` |
| 客户端升级后 | 跑 `tools\calibrate.py`、`tools\calibrate_ocr.py` 重新校准 |

---

## 9. 故障应急

| 情况 | 处理 |
| --- | --- |
| 接口全报 503 `client_not_logged_in` | 客户端掉线，人工重新登录 |
| 接口报 503 `client_needs_attention` | 客户端有弹窗，去点掉（返回里带按钮名） |
| 下单返回 502 `order_result_unknown` | **委托可能已成交**，先 `GET /orders` 核实，再决定是否重试 |
| 服务进程在但接口超时 | 客户端可能卡住，重启客户端后重启服务 |
| 台账和券商对不上 | 跑 `tools\sync_order_keys.py` 按合同编号对齐 |

---

## 10. 部署脚本一览

| 脚本 | 作用 | 需要管理员 |
| --- | --- | --- |
| `install.bat` | 建 venv、装依赖、环境自检 | 否 |
| `start.bat` | 启动服务，日志写 `logs\api.log` | 否 |
| `stop.bat` | 按端口杀掉服务进程 | 否 |
| `install_autostart.bat` | 注册开机自启计划任务 | **是** |
| `remove_autostart.bat` | 删除自启任务 | **是** |
| `open_firewall.bat` | 放行端口入站规则 | **是** |
| `check_env.py` | 环境自检（Python/依赖/OCR/端口/客户端） | 否 |
