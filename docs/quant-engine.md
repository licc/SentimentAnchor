# T+1 量化引擎

## 边界

| 引擎 | 范围 | 交易制度 | 清仓 |
|---|---|---|---|
| `EtfAutoService` | T+0 ETF 池 | T+0 | 14:55 全部清仓 |
| `QuantAutoService` | 人工确认的 T+1 股票池 | T+1 | 不强制 14:55，按止损/止盈/持有期退出 |

两个引擎共用交易账户、券商接口、资金、持仓和执行审计，但不共用交易规则。

## 股票池来源

1. 情绪锚系统从当日锚点/强势股中浮现候选。
2. 候选过滤：正涨幅、非 N/C 新股、非跌停/大面锚、A 股 6 位代码。
3. 人工点击“加入”或手工输入代码，写入 `data/quant-pool.json`。
4. 只有池内股票才会被 T+1 引擎交易。

## 模型策略

策略不是固定枚举。文字策略是模型实例，统一通过 `StrategyModel` 接口评估：

```text
StrategyModel.evaluate(context)
  → buy / hold
  → score + reason
```

当前内置 `rule` 模型（规则模型），后续可注册 LLM、因子模型或外部评分模型：

```ts
registerStrategyModel({
  kind: 'your-model',
  label: '你的模型',
  async evaluate(ctx) { ... }
})
```

T+1 引擎不按 `momentum/trend/pullback` 写死分支，而是读取策略的 `model` 字段并调用对应模型。

## 策略库（独立功能）

`/jyt` 顶部第三个 Tab 是「策略库」：

```text
文字定义策略
列表管理
新建 / 保存 / 启用 / 复制 / 删除
解析参数预览
版本号和历史版本数
历史回测
```

策略内容以自然语言为主，服务器解析止损、止盈、持有日、单票仓位、最低分数和买入截止时间。

## 策略与回测

`data/quant-strategy.json` 保存当前策略和参数覆盖值。

```text
GET  /api/quant/strategy
POST /api/quant/strategy
POST /api/quant/backtest
```

页面支持文字策略、策略列表管理、版本号、启用/复制/删除。

回测返回日线 OHLCV，前端绘制大图：收盘价、均价线、成交量、B/S 买卖标记和区间指标；还可查看 5 分钟分时线和成交量。

每只 T+1 股票可在池内单独指定策略，未指定时使用当前启用策略。

## 引擎规则

```text
账户总仓位上限：70%
单票上限：30%
入场环境：修复 / 发酵 / 高潮，分数 ≥ 55，趋势 ≥ 0
买入截止：14:30
止损：-3%
止盈：+5%
最长持有：3 个自然日（按日期差）
退出时点：止损/止盈即时；第 3 日 14:50 后
当日买入：不可当日卖出，以券商 available 为准
```

## 止损成本口径

账户级止损优先使用系统记录的成交买入价，而不是券商 `cost_price`。券商成本在快速买卖后可能滞后；只有系统找不到对应买入成交时才回退到券商 `pnlPct`。

## 委托核对

未知委托核对使用 15 秒共享快照（持仓 + 委托），不做多接口重复查询；重试间隔为 30/60/120/300 秒。

超时未知委托按以下顺序核对：

```text
券商委托列表匹配 → 成交/持仓 → positionBefore/positionAfter 持仓差
```

买入后持仓增加、卖出后持仓减少，可直接用持仓差确认成交；不再因为拿不到委托回执而一直停在核对状态。

## 统一交易管理

所有写指令进入 `broker-command.ts` 的单一 FIFO 队列：

```text
T+0 自动 / 手动
T+1 自动
委托监控撤单
        ↓
broker-command.ts  唯一写指令队列
        ↓
broker-channel.ts  统一门面
        ↓
etf-broker.ts      唯一券商串行队列
```

页面顶部显示：交易通道 = 统一串行，指令队列 = 当前排队数/执行中。

## 复用能力

- `broker-channel.ts`：统一券商交易通道门面，T+0/T+1 共用。
- `etf-broker.ts`：唯一券商串行队列、健康检查、portfolio、下单实现。
- `etf-write-confirm.ts`：订单 + portfolio 优先，trades 兜底。
- `etf-execution.ts`：执行审计。
- `etf-trade-lock.ts`：全局交易互斥。
- `etf-order-monitor.ts`：跳过 `source=quant`，避免 ETF 审计串线。
- `quant-pool.ts`：候选和人工池。
- `fetchStockQuotes`：股票报价。
- `atomicWriteJson`：状态持久化。

## 状态与 API

状态文件：`data/quant-auto.json`

```text
GET  /api/quant/auto
POST /api/quant/auto/start    confirm=QUANT
POST /api/quant/auto/pause
POST /api/quant/auto/flatten  confirm=QUANT_FLATTEN
GET  /api/quant/pool
POST /api/quant/pool          action=add|remove
```

## 安全开关

- 必须 `mode=live`。
- 账户总资产 ≥ ¥1,000。
- T+1 池非空。
- 无未完成委托、无未确认执行。
- 启动明确二次确认。
- 未知委托不补单，等待核对。
- 当日买入由券商 available=0 阻止卖出。
