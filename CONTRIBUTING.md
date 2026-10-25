# Contributing

## 开发

```bash
pnpm install
pnpm dev
```

## 提交前

```bash
pnpm test:core
pnpm test:state
pnpm test:broker
pnpm smoke
pnpm build
```

## 约束

- 不提交 `data/`、`.env`、`thsapi/`、`dist/`。
- 不把真实账户金额、券商地址、API Key 写进代码、文档或截图。
- 新增交易入口必须经过统一 `brokerChannel` / `brokerCommand`，不要绕过风控。
- AI 只能生成策略参数/规则草稿，实盘执行必须由确定性代码完成。
- 交易相关改动请同时更新 `docs/API.md` 或 `docs/ARCHITECTURE.md`。
