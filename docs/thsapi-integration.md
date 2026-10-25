# Windows 券商适配器对接

本仓库包含同花顺 GUI 适配器源码：`thsapi/thsapi-0.1.0-20261023/`。

Windows 查询 / 健康 / 风控 / 台账 / dry_run 已完成联调；真实资金报单、撤单、成交回读仍需小额验证。

## 必要接口

| 用途 | 方法 | 路径 |
|---|---|---|
| 探活 | GET | `/api/v1/health` |
| 资金 + 持仓 | GET | `/api/v1/portfolio?fresh=true` |
| 委托 | GET | `/api/v1/orders?refresh=true` |
| 成交 | GET | `/api/v1/trades` |
| 下单 | POST | `/api/v1/orders` |
| 撤单 | POST | `/api/v1/cancel` |
| 台账 | GET | `/api/v1/journal?limit=200` |
| 全部撤单 | POST | `/api/v1/cancel-all` |

客户端兼容：

- `/journal` 404 时返回空数组，不阻塞主流程。
- `/cancel-all` 404 时查询委托并逐个撤单。
- 未知委托先核对持仓/委托，不盲目补单。

## 配置

在页面：

```text
系统设置 → 交易接口
```

填写：

```text
接口地址：例如 http://127.0.0.1:8888
API Key：可留空；为空时不发送 X-API-Key
```

也可以设置：

```env
ETF_BROKER_URL=http://127.0.0.1:8888
ETF_BROKER_KEY=
```

## 安全建议

1. 适配器只监听本机回环，不要直接暴露公网。
2. 设置 API Key，即使当前内网免鉴权。
3. 先使用 `dry_run` 验证健康、账户、持仓、委托查询。
4. 再验证小额真实委托、撤单、成交回读。
5. 最后才开启自动执行。
