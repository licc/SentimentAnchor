# thsapi API 参考

- Base URL：`http://127.0.0.1:8888/api/v1`
- 鉴权：`server.api_key` 为空时不校验（当前内网模式）；非空时需带 `X-API-Key: <key>`
- 编码：UTF-8 JSON
- 时间：服务器本地时间（Asia/Shanghai）

---

## GET /health

客户端就绪状态。量化系统建议每 30–60 秒探活一次，`ok=false` 时暂停下单。

```json
{
  "ok": true,
  "client_running": true,
  "client_logged_in": true,
  "broker": "ths",
  "mode": "live",
  "version": "0.1.0",
  "now": "2026-10-21T16:30:00",
  "last_order_at": "2026-10-21T14:59:58",
  "detail": {
    "client_running": true,
    "client_logged_in": true,
    "account": {"total_asset": 100000.0, "cash_available": 50000.0, "...": 0}
  }
}
```

## GET /account

```json
{
  "total_asset": 100000.0,
  "cash_available": 50000.0,
  "cash_withdrawable": 50000.0,
  "frozen": 0.0,
  "market_value": 50000.0,
  "pnl_today": 120.0,
  "pnl_total": 1500.0,
  "currency": "CNY",
  "updated_at": "2026-10-21T16:30:00"
}
```

## GET /positions

```json
[
  {
    "symbol": "513100",
    "name": "纳指ETF",
    "quantity": 1000,
    "available": 1000,
    "cost_price": 7.10,
    "last_price": 1.850,
    "market_value": 7500.0,
    "pnl": 400.0,
    "pnl_pct": 5.63
  }
]
```

## GET /orders?refresh=true

```json
[
  {
    "order_id": "12345678",
    "symbol": "513100",
    "name": "纳指ETF",
    "side": "买入",
    "price": 1.85,
    "quantity": 100,
    "filled": 100,
    "status": "全部成交",
    "time": "14:59:58"
  }
]
```

## GET /trades

```json
[
  {
    "trade_id": "87654321",
    "order_id": "12345678",
    "symbol": "513100",
    "name": "纳指ETF",
    "side": "买入",
    "price": 7.49,
    "quantity": 100,
    "amount": 749.0,
    "time": "14:59:59"
  }
]
```

## POST /orders

请求：

```json
{
  "symbol": "513100",
  "side": "buy",
  "price": 1.85,
  "quantity": 100,
  "order_type": "limit",
  "ref_price": 1.85,
  "client_order_id": "20261021-0001",
  "remark": "momentum-v3"
}
```

> `ref_price` 是行情系统的最新价，用于价格偏离校验。同花顺买入页不显示现价，
> 不传 `ref_price` 时会跳过偏离检查（仍受单笔金额/整手/时段等风控约束）。

响应 `200`：

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
  "submitted_at": "2026-10-21T14:59:58",
  "elapsed_ms": 1830,
  "raw": {
    "name": "纳指ETF",
    "last_price": 1.850,
    "available": 6666,
    "dialogs": ["委托确认\\n买入 513100 纳指ETF\\n价格 1.850 数量 100"],
    "order_row": {"合同编号": "12345678", "委托状态": "已报"}
  }
}
```

`status` 取值：`pending` / `accepted` / `partially_filled` / `filled` / `canceled` / `rejected` / `unknown`。

错误响应（所有错误统一结构）：

```json
{ "ok": false, "code": "risk_rejected", "message": "单笔委托金额 750,000.00 超过上限 100,000.00", "detail": {} }
```

## POST /cancel

```json
{ "order_id": "12345678" }
```

或按代码撤掉该代码全部可撤委托：

```json
{ "symbol": "513100" }
```

响应：

```json
{ "ok": true, "message": "撤单成功", "dialog_texts": ["撤单成功"] }
```

## POST /cancel-all

兼容旧客户端：逐个撤销仍可撤的委托。

```json
{"ok": true, "canceled": 1, "failed": []}
```

## GET /journal?limit=50

本地台账（含未成功的请求），用于对账：

```json
[
  {
    "client_order_id": "20261021-0001",
    "created_at": "2026-10-21T14:59:58",
    "trade_date": "2026-10-21",
    "symbol": "513100",
    "side": "buy",
    "price": 1.85,
    "quantity": 100,
    "status": "accepted",
    "broker_order_id": "12345678",
    "message": "委托成功"
  }
]
```

---

## 幂等语义

| 场景 | 行为 |
| --- | --- |
| 同 `client_order_id` 首次提交 | 正常下单，记台账 |
| 同 ID 且状态为 `accepted`/`rejected` | 直接返回首次结果（`message` 带 `[幂等重放]`），**不再下单** |
| 同 ID 且状态为 `pending`（上一次还没处理完） | `409 duplicate_client_order_id` |
| 不带 `client_order_id` | 服务端自动生成，失去幂等保护 |

## 建议的调用顺序

```
health 探活
  → account / positions 取资金与持仓
  → 计算目标委托
  → POST /orders（带 client_order_id）
  → 失败且 code=502/504 时：GET /orders 核对是否已报单，再决定重试
```

## 复制验证码保护

表格读取依赖客户端的"复制"功能，同花顺可能弹窗要求输入验证码。此时接口返回：

```json
{
  "ok": false,
  "code": "copy_guard_required",
  "message": "同花顺触发复制验证码保护，请在客户端输入验证码后重试",
  "detail": {"dialog": {"hwnd": 123456, "title": "提示", "text": "检测到您正在拷贝数据..."}}
}
```

处理：人工在客户端输入验证码并确定后重试。`GET /health` 的 `detail.blocking_dialog`
也会反映当前是否有此类弹窗。

## Python 示例

见 [`../examples/quant_client.py`](../examples/quant_client.py)。
