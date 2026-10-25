# 串行交易机制测试记录

测试时间：2026-10-22 19:25–19:26（休市）
接口模式：LIVE
测试原则：不休市发真实买卖单；只测试锁、查询、确认、控制指令。

## 1. 全局交易锁

并发提交 A/B 两个任务，A 故意耗时 400ms：

| 任务 | 开始(ms) | 结束(ms) | 结果 |
|---|---:|---:|---|
| A | 0 | 401 | 完成 |
| B | 401 | 503 | A 结束后才开始 |

结论：串行成立，没有交错。

## 2. 券商 GUI 请求队列

同时发起 3 个 `fetchEtfBrokerStatus`：

| 请求 | 开始(ms) | 结束(ms) | 结果 |
|---|---:|---:|---|
| 1 | 0 | 3,740 | ok, live, 1 position |
| 2 | 0 | 7,239 | ok, live, 1 position |
| 3 | 0 | 10,383 | ok, live, 1 position |

结论：请求虽然同时发起，但实际完成时间严格串行，排队约 3.5 秒/个。

## 3. 多源成交确认

确认订单 14462：

| 项目 | 结果 |
|---|---|
| orders | 已成 |
| trades | 200 股 @ 8.335 |
| portfolio | 518880 200 股 |
| 可用资金 | 3,291.38 |
| 一致 | 是 |
| 最终状态 | filled |

证据：

```text
sources: orders + trades + portfolio
orderFilled: 200
tradeQty: 200
positionAfter: 200
consistent: true
```

## 4. 撤单确认

确认订单 12124：

```text
orders 状态：已撤
confirmCancellation：cancelled
```

结论：撤单不是只看 cancel 返回值，二次查询确认已撤。

## 5. 清仓确认

```text
openOrders: 0
positions: 1
ok: false
```

当前仍持有 518880 200 股，所以清仓确认正确返回“不满足”。

## 6. 无效下单控制测试

并发 3 个无效代码下单请求：

| 请求 | 开始(ms) | 结束(ms) | HTTP | 返回 |
|---|---:|---:|---:|---|
| 1 | 0 | 5 | 422 | 该代码不在当前 ETF 池中 |
| 2 | 1 | 5 | 422 | 该代码不在当前 ETF 池中 |
| 3 | 1 | 6 | 422 | 该代码不在当前 ETF 池中 |

结论：内部校验先于任何真实下单，未触达券商写接口。

## 7. 自动执行控制

| 指令 | HTTP | 耗时 | 结果 |
|---|---:|---:|---|
| auto/start | 200 | 9.4s | running |
| auto/state | 200 | 1ms | 已收盘，不交易 |
| auto/pause | 200 | 2ms | paused |
| executions/reconcile | 200 | 6.4s | checked 0, unresolved 0 |

## 8. 休市情绪记录

```text
测试前：64 条
测试后：64 条
最新：18:00，已收盘
```

休市后没有继续写入。

## 9. 当前真实状态

```text
自动执行：暂停
持仓：518880 200 股
可用资金：3,291.38
总资产：约 4,963.38
未完成委托：0
```

## 10. 未测试

以下必须在下一个交易时段测试：

```text
真实买入 100 股
真实卖出 100 股
真实撤单
全部清仓
后台确认器 filled / cancelled / timeout
```

休市阶段没有发真实委托。

## 11. 第二轮：数据复用与多源确认

测试时间：2026-10-22 20:18（休市）

| 操作 | 结果 | 耗时 | 数据来源 |
|---|---|---:|---|
| confirmExecution 14462 | filled | 5,986ms | orders + portfolio |
| confirmCancellation 12124 | cancelled | 4,412ms | orders |
| confirmFlat | false（仍有持仓） | 4,252ms | orders + portfolio |
| 5 并发 /api/etf | 200 | 8–10ms | 同一份缓存 |

关键结论：

```text
正常成交确认没有查询 trades
orders 已成 + portfolio 持仓 200 股
两源一致后直接 filled
```

5 个并发 `/api/etf`：

```text
全部在 8–10ms 返回
全部返回同一份数据
实际只构建一次
```

当前状态：

```text
自动执行：暂停
持仓：518880 200 股
可用资金：3,291.38
未完成委托：0
```

本轮没有发出真实买卖委托。
