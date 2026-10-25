# 代码目录说明

## 顶层

```text
.
├── README.md
├── DISCLAIMER.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── package.json
├── server/             Node.js 后端
├── src/                React 前端
├── shared/             前后端共享类型
├── scripts/            测试/冒烟/截图脚本
├── docs/               架构、API、使用、审计文档
├── thsapi/             Windows 同花顺 HTTP 适配器
├── data/               本地运行数据（Git 忽略）
└── index.html
```

## server/

```text
server/
├── index.ts            Express 入口、路由、SSE
├── security.ts         可选访问口令、CORS
├── providers/          外部数据源
│   ├── xgb.ts          选股宝广度/涨停池
│   ├── sina.ts         新浪行情/指数/榜单
│   ├── eastmoney.ts    东财日线
│   ├── ths.ts          同花顺量能基线
│   ├── tencent-intraday.ts 腾讯 1 分钟分时
│   ├── announcements.ts 东财公告
│   ├── corporate-actions.ts 分红/送转
│   └── global-fear.ts  VIX/美股/黄金/CNH/韩国/日本
├── services/
│   ├── market.ts       行情调度、快照、缓存、降级
│   ├── analysis.ts     情绪评分、锚点、主线、规则
│   ├── ai.ts           本地/LLM 研判
│   ├── etf-*.ts        T+0 ETF、选池、执行、审计、账本
│   ├── quant-*.ts      T+1 策略、池、自动执行、回测、稳健性
│   ├── intraday-*.ts   1 分钟分析、规则、归档、回测
│   ├── risk/           风控规则、策略、AI 草稿、止损监控
│   ├── broker-*.ts     统一券商通道、订单匹配、命令队列
│   ├── ledger*.ts      SQLite 账本、一致性
│   ├── trade-plan.ts   交易计划/复盘
│   ├── preopen.ts      盘前候选
│   ├── pit-data.ts     Point-in-time 快照
│   ├── backup.ts       自动备份
│   └── notify.ts       手机告警
└── lib/                原子写等工具
```

## src/

```text
src/
├── App.tsx             看板路由、主题、字体、摸鱼模式
├── components/
│   ├── EtfPage.tsx     交易台总入口
│   ├── ActiveTradingDesk.tsx 主动交易
│   ├── EtfDesk.tsx     T+0
│   ├── QuantDesk.tsx   T+1
│   ├── RiskCenter.tsx  风控
│   ├── IntradayAnalysisModal.tsx 分时检查
│   ├── StrategyLibrary.tsx T+1 策略库/回测
│   ├── T0StrategyLibraryModal.tsx T+0 策略库
│   ├── RiskPolicyModal.tsx 风控编排
│   ├── SystemSettingsModal.tsx 系统设置
│   └── ...
├── hooks/              SSE、行情、自动执行、账本
├── contexts/           交易台共享上下文
├── lib/                格式化、字体缩放、PnL
└── styles.css          统一主题与布局
```

## shared/

```text
shared/types.ts         前后端共享的 Snapshot、策略、风控、订单类型
```

## scripts/

```text
scripts/
├── core-tests.mjs             核心单元测试
├── order-state-machine-test.mjs 订单状态机
├── broker-mock-test.mjs        mock 券商
├── ai-mock-test.mjs            LLM mock
├── smoke.mjs                   API 冒烟
├── shot.mjs                   截图
└── ...                        主题/动态锚点等辅助测试
```

## thsapi/

```text
thsapi/thsapi-0.1.0-20261023/
├── README.md           适配器说明
├── INSTALL.md          Windows 安装
├── config.yaml         地址/客户端/交易/风控配置
├── selectors.yaml      UI 控件定位
├── requirements.txt
├── thsapi/
│   ├── api.py          FastAPI 路由
│   ├── service.py      业务编排
│   ├── guard.py        前置风控
│   ├── journal.py      SQLite 台账/幂等
│   ├── models.py       Pydantic 模型
│   ├── config.py       配置加载
│   ├── webdocs.py      内置 API 文档
│   └── gui/            Windows GUI 自动化
├── deploy/             Windows 安装/启动/防火墙脚本
├── examples/           Python 客户端示例
├── tests/              mock/解析测试
├── tools/              校准、截图、诊断工具
└── docs/API.md         适配器 API
```

`static/shots/` 真实账户截图未包含；运行时 `data/`、`runtime/`、缓存、zip 也不进入仓库。

## docs/

```text
USAGE.md                使用手册
ARCHITECTURE.md         系统架构
API.md                  主服务 API
CODEBASE.md             本文件
VERIFICATION.md         验证与边界
DISCLAIMER.md           免责声明（根目录）
system-review-final.md  全系统复盘
system-capability-audit.md 能力审计
screenshots/            脱敏演示截图
```

## data/

本地运行数据，Git 忽略：

```text
runtime-config.json
ledger.db
risk-policies.json
quant-strategies.json
t0-strategies.json
pit/
intraday/
preopen/
```

不要提交真实账户、委托、成交、持仓、Key 或券商地址。
