# API

Base URL：`http://127.0.0.1:8787`

## 认证

可选 `APP_TOKEN`。设置后：

```text
GET  /api/auth
POST /api/login       { token }
POST /api/logout
```

未认证访问 API 返回 401。生产环境建议开启并置于反向代理之后。

## 行情

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 数据源健康 |
| GET | `/api/snapshot` | 当前行情快照 |
| GET | `/api/stream` | SSE 快照/告警 |
| POST | `/api/refresh` | 强制刷新 |
| GET | `/api/calendar` | 周期日历 |
| GET | `/api/calendar/:date` | 指定日期 |
| GET | `/api/alerts` | 预警配置/历史 |
| POST | `/api/alerts/config` | 保存预警规则 |
| POST | `/api/alerts/read` | 标记已读 |
| GET | `/api/watchlist` | 自选 |
| POST | `/api/watchlist` | 保存自选 |
| GET | `/api/sentiment/history?days=7` | 情绪温度多日归档（7/14/30 日视图） |
| POST | `/api/sentiment/backfill?days=30` | 回填历史归档（可加 `&force=1` 重新校验） |

SSE 事件：

```text
event: snapshot
data: { ...Snapshot }

event: alert
data: { ...AlertEvent }
```

### 情绪温度多日归档

前端「情绪结构」卡片可在 **当日 / 7 日 / 14 日 / 30 日** 之间切换。多日视图读这个接口：

```http
GET /api/sentiment/history?days=14
```

```json
{
  "days": 14,
  "available": 14,
  "backfilling": false,
  "items": [
    { "date": "2026-09-04", "score": 55, "high": 68, "low": 31,
      "points": [{ "time": "09:25", "temp": 13 }], "updatedAt": "2026-10-25T07:30:00.000Z" }
  ]
}
```

- `score` 与日内曲线同尺度：当日**最后一个采样点**的温度（不是综合情绪分）。
- 归档存在 **SQLite**：`data/sentiment.db`（表 `sentiment_daily`，一天一行，分钟序列存 JSON 字段）。
  当日数据由行情 tick 每分钟覆盖写；历史交易日由回填任务补齐。
- `backfilling: true` 表示后台正在补齐历史，前端会每 5 秒自动重取。

**历史回填**（可手动触发，幂等）：

```http
POST /api/sentiment/backfill?days=30          # 只补缺失的日期
POST /api/sentiment/backfill?days=30&force=1  # 重新校验并覆盖已有日期
```

回填原理：选股宝广度接口支持 `date=YYYY-MM-DD`，可返回任一交易日的 243 个分钟点；
温度公式只依赖广度四元组，所以历史是**精确复算**而非估算。

> 注意：该接口对**非交易日会静默返回上一个交易日**的数据，因此回填时会校验返回数据自身的日期，
> 不匹配就丢弃并清理，避免把同一交易日重复写进多个日期（节假日尤其容易踩）。

## 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/system/health` | 系统/账户/账本健康 |
| GET | `/api/system/config` | 券商配置（Key 脱敏） |
| POST | `/api/system/config` | 保存券商地址/Key/超时 |
| GET | `/api/system/broker/test` | 测试券商 `/api/v1/health` |
| GET | `/api/system/metrics` | 指标 |
| GET/POST | `/api/system/backup` | 备份 |
| POST | `/api/system/backup/config` | 备份配置 |
| GET/POST | `/api/system/notify` | 手机告警 |
| POST | `/api/system/notify/test` | 测试通知 |
| GET/POST | `/api/system/kill` | 急停 |
| POST | `/api/system/kill/clear` | 解除急停 |
| GET/POST | `/api/system/coordinator` | T+0/T+1 资金额度 |

`POST /api/system/config`：

```json
{
  "brokerUrl": "http://127.0.0.1:8888",
  "brokerKey": "",
  "clearBrokerKey": false,
  "orderTimeoutMs": 20000,
  "statusTtlMs": 8000,
  "maxManualOrderAmount": 50000
}
```

Key 为空时不发送 `X-API-Key`。

## 风控

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/risk` | 风控状态/事件 |
| GET/POST | `/api/risk/config` | 止损/额度配置 |
| GET | `/api/risk/policies` | 风控编排列表 |
| POST | `/api/risk/policies/:id` | 保存编排 |
| POST | `/api/risk/policies/:id/activate` | 启用编排 |
| POST | `/api/risk/policies/ai-draft` | AI 生成编排草稿 |

AI 草稿只返回规则，不自动启用；硬规则违规返回 422。

## 交易

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/manual/preflight` | 人工单预检，只读 |
| GET | `/api/manual/quote` | 人工单行情 |
| POST | `/api/etf/order` | 统一委托提交 |
| GET | `/api/etf` | T+0 台数据 |
| GET | `/api/etf/auto` | T+0 自动状态 |
| POST | `/api/etf/auto/start` | 启动自动 |
| POST | `/api/etf/auto/pause` | 暂停 |
| POST | `/api/etf/auto/flatten` | 清仓 |
| GET | `/api/etf/executions` | 执行审计 |
| POST | `/api/etf/executions/:id/dismiss` | 处理异常 |
| POST | `/api/etf/executions/reconcile` | 对账 |
| GET | `/api/etf/history` | 每日记录 |
| GET | `/api/etf/sentiment-log` | 情绪记录 |
| GET | `/api/etf/config` | ETF 池 |
| POST | `/api/etf/config` | 保存 ETF 池 |
| GET | `/api/etf/selection` | 系统选池 |
| POST | `/api/etf/selection/refresh` | 重选 |
| GET | `/api/ledger` | 账本 |
| GET | `/api/analytics/portfolio` | 组合分析 |

所有写交易接口都会经过风控和券商队列；`POST /api/etf/order` 需要显式确认参数，具体以服务端校验为准。

## T+1 量化

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/quant/strategies` | 策略库 |
| POST | `/api/quant/strategies` | 新建 |
| PUT | `/api/quant/strategies/:id` | 更新 |
| POST | `/api/quant/strategies/:id/activate` | 启用 |
| POST | `/api/quant/strategies/:id/duplicate` | 复制 |
| DELETE | `/api/quant/strategies/:id` | 删除 |
| GET | `/api/quant/strategy` | 当前策略 |
| GET | `/api/quant/pool` | 股票池/候选 |
| POST | `/api/quant/pool` | 加/删/指定策略 |
| POST | `/api/quant/backtest` | 日线回测 |
| POST | `/api/quant/robustness` | 参数稳健性 |
| GET | `/api/quant/auto` | T+1 自动状态 |
| POST | `/api/quant/auto/start` | 启动 |
| POST | `/api/quant/auto/pause` | 暂停 |
| POST | `/api/quant/auto/flatten` | 清仓 |

## 数据研究

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stock/announcements?symbol=002241` | 近期公告 |
| GET | `/api/stock/corporate-actions?symbol=002241` | 分红/送转 |
| GET | `/api/intraday/analysis?symbol=002241` | 1 分钟分时 |
| GET | `/api/intraday/dates?symbol=002241` | 已归档日期 |
| GET | `/api/intraday/backtest?symbol=002241` | 5 日规则验证 |
| GET | `/api/intraday/rules` | 分时规则库 |
| GET | `/api/pit` | PIT 日期 |
| GET | `/api/pit?date=YYYY-MM-DD` | PIT 快照 |
| GET | `/api/preopen` | 盘前候选 |
| POST | `/api/preopen` | 生成候选 |
| GET/POST | `/api/plans` | 交易计划 |
| POST | `/api/plans/:id/review` | 复盘 |

## AI

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ai` | 当前研判 |
| POST | `/api/ai` | 重新研判 |
| GET/POST | `/api/ai/config` | Key/模型配置（脱敏） |
| POST | `/api/ai/models` | 获取模型 |
| POST | `/api/ai/test` | 测试连接 |
| POST | `/api/ai/clear` | 清除配置 |
| POST | `/api/strategies/generate` | AI 策略草稿 |

## 错误格式

```json
{ "error": "可读的错误信息" }
```

常见状态码：

```text
400 参数/确认缺失
401 未认证
409 交易状态冲突
422 风控/参数/数据错误
502 外部数据源错误
503 行情未初始化
```

## 安全边界

- API 默认监听 `127.0.0.1`。
- 没有多用户/RBAC；`APP_TOKEN` 只是单口令保护。
- 实盘适配器需要单独部署和鉴权。
- 不要将 `data/`、`.env`、真实账户截图提交到 Git。
