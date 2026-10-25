# 风控系统

## 定位

风控挂在统一券商指令通道前面：

```text
手动 / T+0 自动 / T+1 自动
        ↓
brokerCommand 唯一串行队列
        ↓
买入前 RiskEngine.checkBuy()
        ↓
brokerChannel / etf-broker
```

所有来源的买入都无法绕过。

## 买入拦截规则

当前基础规则：

```text
交易时段
交易接口 live
价格 > 0
100 股整数倍
单笔金额上限
可用资金 + 最低现金保留
单票集中度
账户总仓位
黑名单
当日买入次数
重复委托窗口
```

后续风险模型通过 `BuyRiskRule` 注册：

```ts
riskEngine.registerBuyRule({
  id: 'model-x',
  label: '自定义模型',
  async evaluate(ctx) { return { id, label, passed, detail } }
})
```

## 止损

独立 `riskMonitor`：

```text
每 15 秒扫描持仓
pnlPct <= -3% 触发
默认只告警
开启自动卖出后，通过统一 brokerChannel 卖出可用数量
T+1 当日 available=0 时只记录 blocked
```

不沿用 ETF 的 14:55 清仓规则。

## 存储

```text
data/risk-config.json
data/risk-events.json
```

## API

```text
GET  /api/risk
GET  /api/risk/config
POST /api/risk/config
```

## 页面

`/jyt` → 风控 Tab：

```text
买入拦截配置
止损配置
自动卖出开关
风控事件列表
```

当前默认自动止损关闭，只告警，避免未确认模型直接发卖单。
