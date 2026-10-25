# 验证与边界

## 自动化检查

```text
pnpm test:core       通过
pnpm test:state      通过
pnpm test:broker     通过
pnpm smoke           通过
pnpm build           通过
```

覆盖：

- 行情/持仓异常清洗
- 订单状态机
- mock 券商下单/撤单/未知委托
- T+0 策略解析
- 公司行为前复权
- 风控参数与硬规则

## 接口冒烟

本机验证过的只读接口：

```text
GET /api/health                    200
GET /api/snapshot                  200
GET /api/etf                       200
GET /api/risk/policies             200
GET /api/intraday/dates            200
GET /api/pit                       200
```

`/api/etf` 不再包含模拟账户字段；T+0 页面不提供模拟调仓。

## 页面

```text
情绪锚看板：无控制台错误
/jyt 四个页签：无控制台错误
工具菜单：无模拟交易
T+0：无本地模拟入口
移动端 390px：无横向溢出
```

截图位于 `docs/screenshots/`，使用本地演示数据。

## 已验证

- Windows 同花顺 `thsapi` 查询 / 健康 / 风控 / 台账 / dry_run 联调

## 未验证

- 真实资金下单、撤单、成交回读、重启对账
- 历史 Point-in-time 全量股票池
- 完整退市/历史 ST/停牌数据
- 实盘账本分红入账与成本调整
- 同模块多策略并行
- T+0 策略级历史回测

## 数据源边界

公开行情接口没有 SLA，可能延迟、缺失或口径不同。北交所、ST、退市、停牌、涨跌停等口径以交易所和券商为准。

## 安全边界

- 默认单用户，可选 `APP_TOKEN`。
- 无多用户/RBAC。
- 券商适配器需要独立部署和鉴权。
- `data/`、`.env`、`thsapi/` 不进入仓库。
