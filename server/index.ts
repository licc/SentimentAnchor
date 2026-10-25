import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Response } from 'express'
import type { Snapshot } from '../shared/types.js'
import { MarketService } from './services/market.js'
import { backfillSentiment, isBackfilling } from './services/sentiment-backfill.js'
import { countDays } from './services/sentiment-store.js'
import { generateAi, getAiEnvelope, llmConfig } from './services/ai.js'
import { clearAiConfig, listAiModels, publicAiConfig, saveAiConfig, testAiConfig } from './services/ai-config.js'
import { getEtfDesk, getEtfHistory } from './services/etf-strategy.js'
import { fetchEtfJournal } from './services/etf-broker.js'
import { getEtfFeeSettings, saveEtfFeeSettings } from './services/etf-fee-config.js'
import { getEtfAutoConfig, saveEtfAutoConfig } from './services/etf-auto-config.js'
import { activateT0Strategy, createT0Strategy, getT0Strategies, saveT0Strategy } from './services/t0-strategy.js'
import { brokerChannel } from './services/broker-channel.js'
import { activeIntentCount, getOrderIntents, reconcileOrderIntents } from './services/order-intent.js'
import { activateKillSwitch, clearKillSwitch, getKillSwitch } from './services/kill-switch.js'
import { recordTrade, getToday } from './services/etf-journal.js'
import { etfAuto } from './services/etf-auto.js'
import { createExecution, getExecutions, updateExecution } from './services/etf-execution.js'
import { getSentimentLog } from './services/etf-sentiment-log.js'
import { addQuantCode, buildQuantCandidates, enrichQuantPool, getQuantPool, removeQuantCode, setQuantAssignment } from './services/quant-pool.js'
import { quantAuto } from './services/quant-auto.js'
import { riskEngine } from './services/risk/risk-engine.js'
import { riskMonitor } from './services/risk/risk-monitor.js'
import { getRiskConfig, saveRiskConfig } from './services/risk/risk-config.js'
import { activateRiskPolicy, getRiskPolicies, saveRiskPolicy } from './services/risk/risk-policy.js'
import { generateRiskPolicyDraft } from './services/risk/risk-policy-ai.js'
import { coordinatorUsage, getCoordinatorConfig, saveCoordinatorConfig } from './services/trading-coordinator.js'
import { sanitizePositionValues } from './services/position-sanity.js'
import { fetchStockQuotes } from './providers/sina.js'
import { ledgerSummary, recentLedger } from './services/ledger.js'
import { backfillLedgerFromExecutions } from './services/ledger-backfill.js'
import { checkLedgerConsistency } from './services/ledger-consistency.js'
import { metricsSnapshot } from './services/metrics.js'
import { getRuntimeConfig, publicRuntimeConfig, saveRuntimeConfig } from './services/runtime-config.js'
import { portfolioAnalytics } from './services/portfolio-analytics.js'
import { analyzeIntraday } from './services/intraday-analysis.js'
import { runIntradayBacktest } from './services/intraday-backtest.js'
import { listIntradayDates } from './services/intraday-store.js'
import { generatePreopen, getPreopen, maybeGeneratePreopen } from './services/preopen.js'
import { getPit, listPit, recordPit } from './services/pit-data.js'
import { fetchAnnouncements } from './providers/announcements.js'
import { fetchCorporateActions } from './providers/corporate-actions.js'
import { INTRADAY_RULES } from './services/intraday-rules.js'
import { createTradePlan, listTradePlans, reviewTradePlan } from './services/trade-plan.js'
import { getBackupConfig, getBackups, maybeAutoBackup, runBackup, saveBackupConfig } from './services/backup.js'
import { getNotifyConfig, saveNotifyConfig, sendNotification } from './services/notify.js'
import { activateStrategy, createStrategy, duplicateStrategy, getActiveQuantStrategy, getQuantStrategyById, listQuantStrategies, listStrategyDefinitions, removeStrategy, saveQuantStrategy, updateStrategy } from './services/quant-strategy.js'
import { runQuantBacktest } from './services/quant-backtest.js'
import { runQuantRobustness } from './services/quant-robustness.js'
import { assertStrategyQuality } from './services/strategy-quality.js'
import { generateStrategyDraft } from './services/strategy-ai.js'
import { dismissUnknownExecution, hasUnknownExecutions, reconcileUnknownExecutions } from './services/etf-reconcile.js'
import { commission } from './services/etf-fees.js'
import { startOrderMonitor } from './services/etf-order-monitor.js'
import { getEtfConfig, resetEtfConfig, saveEtfConfig } from './services/etf-config.js'
import { ensureEtfSelection } from './services/etf-selector.js'
import { withTradeLock } from './services/etf-trade-lock.js'
import { acquireInstanceLock, releaseInstanceLock } from './services/instance-lock.js'
import { getCalendar, getCalendarDay } from './services/calendar.js'
import { configureAlerts, evaluateAlerts, evaluateSystemAlerts, getAlerts, markAlertsRead } from './services/alerts.js'
import { assertSafeWebhookUrl, authRequired, authToken, parseCookies, tokenMatches } from './security.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const REFRESH_MS = Math.max(5_000, Number(process.env.REFRESH_MS ?? 10_000))
acquireInstanceLock()
const app = express()
const market = new MarketService(REFRESH_MS)
etfAuto.configure(() => market.snapshot)
quantAuto.configure(() => market.snapshot)
riskMonitor.configure(() => market.snapshot)
riskEngine.configureSnapshot(() => market.snapshot)
const orderMonitor = startOrderMonitor()
maybeAutoBackup()
setInterval(() => maybeAutoBackup(), 15 * 60_000).unref()
const clients = new Set<Response>()

app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Token')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function writeSnapshot(res: Response, snapshot: Snapshot) {
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
}

market.listeners.add((snapshot) => {
  for (const client of clients) {
    try {
      writeSnapshot(client, snapshot)
    } catch {
      clients.delete(client)
    }
  }
  maybeGeneratePreopen(snapshot)
  recordPit(snapshot)
  const fresh = evaluateAlerts(snapshot)
  if (fresh.length) {
    for (const client of clients) {
      for (const event of fresh) {
        try {
          client.write(`event: alert\ndata: ${JSON.stringify(event)}\n\n`)
        } catch {
          clients.delete(client)
        }
      }
    }
  }
})

app.get('/api/health', (_req, res) => {
  // sseClients：当前挂着 /api/stream 的浏览器数量，排查"远程页面不刷新"时先看这个
  res.json({ ...market.health(), ai: { llmConfigured: Boolean(llmConfig()) }, authRequired: authRequired(), sseClients: clients.size })
})

app.get('/api/auth', (req, res) => {
  const required = authRequired()
  const cookies = parseCookies(req.headers.cookie)
  const authed = !required || tokenMatches(cookies.anchor_session) || tokenMatches(req.headers['x-app-token'] as string)
  res.json({ required, authed })
})

app.post('/api/login', (req, res) => {
  const required = authRequired()
  if (!required) return res.json({ ok: true, required: false })
  const token = String((req.body as { token?: unknown })?.token ?? '')
  if (!tokenMatches(token)) return res.status(401).json({ error: '访问口令不正确' })
  const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'
  res.setHeader('Set-Cookie', `anchor_session=${encodeURIComponent(authToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`)
  res.json({ ok: true, required: true })
})

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'anchor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')
  res.json({ ok: true })
})

app.use('/api', (req, res, next) => {
  if (!authRequired()) return next()
  if (req.path === '/auth' || req.path === '/login' || req.path === '/logout' || req.path === '/health') return next()
  const cookies = parseCookies(req.headers.cookie)
  if (tokenMatches(cookies.anchor_session) || tokenMatches(req.headers['x-app-token'] as string)) return next()
  res.status(401).json({ error: '需要访问口令' })
})

app.get('/api/snapshot', (_req, res) => {
  if (!market.snapshot) return res.status(503).json({ error: '行情正在初始化，请稍后重试' })
  res.setHeader('Cache-Control', 'no-store')
  res.json(market.snapshot)
})

// 情绪温度的多日归档（前端「7 日 / 14 日 / 30 日」用），数据存在 SQLite：data/sentiment.db。
// 当日由行情 tick 持续写入；历史交易日由 backfillSentiment 回填（选股宝接口支持 date 参数）。
app.get('/api/sentiment/history', (req, res) => {
  const raw = Number(req.query.days)
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(60, Math.round(raw))) : 7
  const items = market.sentimentHistory(days)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ days, available: items.length, backfilling: isBackfilling(), items })
})

// 手动触发历史回填（幂等，已存在的日期跳过）。30 天约需 30 次上游请求，串行 + 轻限速。
app.post('/api/sentiment/backfill', async (req, res) => {
  const raw = Number((req.query.days as string | undefined) ?? (req.body as { days?: unknown })?.days ?? 30)
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(60, Math.round(raw))) : 30
  const force = req.query.force === '1' || (req.body as { force?: unknown })?.force === true
  try {
    const result = await backfillSentiment(days, { force })
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : '回填失败' })
  }
})

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`retry: 4000\n\n`)
  clients.add(res)
  if (market.snapshot) writeSnapshot(res, market.snapshot)
  console.log(`[stream] 客户端接入 ${req.ip ?? ''} → 当前 ${clients.size} 个`)
  req.on('close', () => {
    clients.delete(res)
    console.log(`[stream] 客户端断开 ${req.ip ?? ''} → 剩余 ${clients.size} 个`)
  })
})

app.post('/api/manual/preflight', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { symbol?: unknown; side?: unknown; price?: unknown; quantity?: unknown; reason?: unknown }
    const symbol = String(body.symbol ?? '').trim()
    const side = body.side === 'sell' ? 'sell' : 'buy'
    const price = Number(body.price)
    const quantity = Number(body.quantity)
    const reason = String(body.reason ?? '').trim()
    if (!/^(0|3|5|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '代码必须是 6 位 A 股/ETF 代码' })
    if (!Number.isFinite(price) || price <= 0) return res.status(422).json({ error: '价格无效' })
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity % 100 !== 0) return res.status(422).json({ error: '数量必须是 100 的整数倍' })
    const quoteMap = (await fetchStockQuotes([symbol]).catch(() => ({ map: {} }))).map
    const quote = Object.values(quoteMap)[0] ?? null
    const broker = await brokerChannel.status().catch(() => null)
    const position = broker?.positions.find((p) => p.symbol === symbol) ?? null
    const amount = price * quantity
    if (side === 'buy') {
      const decision = await riskEngine.previewBuy({ symbol, price, quantity, source: 'manual' }, { fresh: false })
      const manualChecks = reason.length < 4 ? [{ id: 'manual-reason', label: '交易理由', passed: false, detail: '主动买入必须填写至少 4 个字的理由/计划' }] : []
      const kill = getKillSwitch()
      const guardChecks = kill.active ? [{ id: 'manual-kill', label: '系统急停', passed: false, detail: `系统急停中：${kill.reason}` }] : []
      const checks = [...decision.checks, ...manualChecks, ...guardChecks]
      const failed = checks.filter((c) => !c.passed)
      return res.json({ allowed: failed.length === 0, side, symbol, quote, position, amount, checks, reasons: failed.map((c) => c.detail), account: broker?.account ?? null })
    }
    const available = position?.available ?? 0
    const checks = [
      {
        id: 'broker',
        label: '交易接口',
        passed: Boolean(broker?.ok && broker.mode === 'live'),
        // dry_run 时不能说"接口不可用"：接口是好的，只是演练模式不允许发真实委托，
        // 否则用户会以为是适配器挂了，去查错方向。
        detail: !broker?.ok
          ? `接口不可用${broker?.error ? `：${broker.error}` : ''}`
          : broker.mode === 'live'
            ? '接口就绪'
            : `演练模式（${broker.mode}），不能发真实委托`,
      },
      { id: 'position', label: '可卖持仓', passed: available >= quantity, detail: `可卖 ${available} 股` },
      { id: 'lot', label: '整手', passed: quantity % 100 === 0, detail: '数量必须是 100 的整数倍' },
    ]
    const failed = checks.filter((c) => !c.passed)
    res.json({ allowed: failed.length === 0, side, symbol, quote, position, amount, checks, reasons: failed.map((c) => c.detail), account: broker?.account ?? null })
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '预检失败' }) }
})

app.get('/api/manual/quote', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').trim()
  if (!/^(0|3|5|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '请输入 6 位 A 股/ETF 代码' })
  const quoteMap = (await fetchStockQuotes([symbol]).catch(() => ({ map: {} }))).map
  res.json(Object.values(quoteMap)[0] ?? null)
})

app.post('/api/etf/order', async (req, res) => withTradeLock(async () => {
  const body = (req.body ?? {}) as { symbol?: unknown; side?: unknown; price?: unknown; quantity?: unknown; confirm?: unknown; manual?: unknown; reason?: unknown }
  try {
    if (body.confirm !== 'LIVE') return res.status(400).json({ error: '实盘委托需要 confirm=LIVE' })
    const symbol = String(body.symbol ?? '').trim()
    const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : null
    const price = Number(body.price)
    const quantity = Number(body.quantity)
    if (!side) return res.status(400).json({ error: 'side 必须是 buy 或 sell' })
    if (!/^\d{6}$/.test(symbol)) return res.status(400).json({ error: 'symbol 必须是 6 位代码' })
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: '价格无效' })
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity % 100 !== 0) return res.status(400).json({ error: '数量必须是 100 的整数倍' })
    const manual = body.manual === true
    const manualReason = String(body.reason ?? '').trim()
    if (manual) {
      if (!/^(0|3|5|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '主动交易代码必须是 6 位 A 股/ETF 代码' })
      if (manualReason.length < 4) return res.status(422).json({ error: '主动交易必须填写至少 4 个字的理由/计划' })
    } else {
      const universe = getEtfConfig().universe
      if (!universe.some((x) => x.code === symbol)) return res.status(422).json({ error: '该代码不在当前 ETF 池中，请先加入 ETF 池' })
    }

    if (hasUnknownExecutions()) return res.status(409).json({ error: '存在未确认的历史委托，请先在执行记录中核对/清仓后再下单' })
    const broker = await brokerChannel.status()
    const blocked = (message: string) => {
      const audit = createExecution({
        mode: 'manual', side, symbol, name: broker.positions.find((p) => p.symbol === symbol)?.name || symbol,
        price, quantity, factors: { source: 'manual', quote: price, accountTotal: broker.account?.totalAsset, cashAvailable: broker.account?.cashAvailable, note: '实盘预检拦截' },
      })
      updateExecution(audit.id, { status: 'blocked', message, resolution: '未发送委托；修正后重试' })
    }
    if (!broker.ok) {
      blocked('交易接口未就绪，先检查客户端登录状态')
      return res.status(409).json({ error: '交易接口未就绪，先检查客户端登录状态' })
    }
    if (broker.mode !== 'live') {
      blocked(`交易接口当前是 ${broker.mode}，不是 live；不能发真实委托`)
      return res.status(409).json({ error: `交易接口当前是 ${broker.mode}，不是 live；不能发真实委托` })
    }
    if (!broker.account) {
      blocked('账户资金尚未读取')
      return res.status(409).json({ error: '账户资金尚未读取' })
    }

    const amount = price * quantity
    const maxAmount = Math.min(getRuntimeConfig().maxManualOrderAmount, broker.account.totalAsset * 0.7)
    if (amount > maxAmount) {
      blocked(`单笔金额 ¥${amount.toFixed(2)} 超过上限 ¥${maxAmount}`)
      return res.status(422).json({ error: `单笔金额 ¥${amount.toFixed(2)} 超过上限 ¥${maxAmount}` })
    }
    if (side === 'buy' && amount + commission(amount) > broker.account.cashAvailable) {
      blocked(`可用资金不足以覆盖委托和佣金：需要 ¥${(amount + commission(amount)).toFixed(2)}，可用 ¥${broker.account.cashAvailable.toFixed(2)}`)
      return res.status(422).json({ error: '可用资金不足以覆盖委托和佣金' })
    }
    if (side === 'sell') {
      const pos = broker.positions.find((p) => p.symbol === symbol)
      if (!pos || pos.available < quantity) {
        blocked('可卖持仓不足')
        return res.status(422).json({ error: '可卖持仓不足' })
      }
    }

    const desk = market.snapshot ? await getEtfDesk(market.snapshot).catch(() => null) : null
    const factors = {
      source: 'manual' as const,
      regime: desk?.signal.regime,
      score: desk?.signal.score,
      stage: desk?.signal.stage,
      trend: desk?.signal.trend,
      target: desk?.signal.targetName ?? undefined,
      reason: desk?.signal.reason,
      quote: desk?.quotes.find((q) => q.code === symbol)?.price ?? price,
      quotePct: desk?.quotes.find((q) => q.code === symbol)?.pct,
      accountTotal: broker.account.totalAsset,
      cashAvailable: broker.account.cashAvailable,
      position: broker.positions.find((p) => p.symbol === symbol)?.available?.toString(),
      rules: desk?.rules,
      note: manual ? `主动交易：${manualReason}` : '手动实盘委托',
    }
    const audit = createExecution({
      mode: 'manual', side, symbol, name: broker.positions.find((p) => p.symbol === symbol)?.name || symbol,
      price, quantity, factors,
    })
    let order: { ok?: boolean; order_id?: string; status?: string; message?: string } = {}
    let placeError: Error | null = null
    // 真实行情价作为 ref_price 传给适配器，供它做「委托价偏离现价」校验。
    // 不传的话适配器只能用委托价自证，偏离校验形同虚设（买入页本身没有"现价"控件）。
    const marketRef = desk?.quotes.find((q) => q.code === symbol)?.price
    try {
      order = await brokerChannel.placeOrder({ symbol, side, price, quantity, clientOrderId: audit.id, refPrice: marketRef }, { source: 'manual' }) as typeof order
    } catch (err) {
      placeError = err instanceof Error ? err : new Error('下单请求异常')
      if (/HTTP 400|risk_rejected|order_rejected|client_rejected/i.test(placeError.message)) {
        updateExecution(audit.id, { status: 'rejected', message: placeError.message, resolution: '券商明确拒绝，不重试' })
        throw placeError
      }
    }
    let orderId = order.order_id
    if (!orderId) {
      await new Promise((r) => setTimeout(r, 1_500))
      const journal = await fetchEtfJournal(200).catch(() => [])
      const j = journal.find((x) => x.clientOrderId === audit.id)
      if (j?.orderId) {
        orderId = j.orderId
        order.status = j.status
        order.message = '下单响应异常，但券商台账已确认该单'
      } else if (j && /reject|fail|refus|unknown/i.test(j.status)) {
        updateExecution(audit.id, { status: j.status === 'unknown' ? 'unknown' : 'rejected', brokerStatus: j.status, message: j.message, resolution: '券商台账已确认未提交/拒绝；不补单' })
        throw new Error(j.message || '券商台账拒绝委托')
      }
    }
    if (!orderId) {
      updateExecution(audit.id, {
        status: placeError ? 'unknown' : 'rejected',
        brokerStatus: order.status ?? '',
        message: placeError?.message ?? order.message ?? '券商未返回合同编号',
        resolution: placeError ? '响应异常且查询未找到委托；不补单，需核对' : '接口拒绝且查询无委托，不重试',
      })
      throw new Error(placeError ? '下单结果未知，已查询券商但未找到该单；请人工核对' : (order.message || '委托被拒绝'))
    }
    if (order.ok === false) {
      updateExecution(audit.id, { status: 'rejected', brokerStatus: order.status ?? '', message: order.message ?? '委托被拒绝', resolution: '接口拒绝，不重试' })
      throw new Error(order.message || '委托被拒绝')
    }
    updateExecution(audit.id, { orderId, status: 'accepted', brokerStatus: order.status ?? '', message: order.message ?? '已受理', resolution: '已从券商委托查询确认订单，等待成交' })
    // The POST response is only a receipt. The background monitor confirms against
    // orders + trades + portfolio and writes the final execution state.
    res.json({ ok: true, message: '委托已提交，正在后台核对成交/持仓', orderId, status: 'accepted' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '实盘委托失败'
    res.status(/HTTP 400|risk_rejected|order_rejected|client_rejected/i.test(message) ? 422 : 502).json({ error: message })
  }
}))

app.get('/api/etf/selection', async (_req, res) => {
  try {
    res.json(await ensureEtfSelection())
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : '系统选池失败' })
  }
})

app.post('/api/etf/selection/refresh', async (_req, res) => {
  try {
    res.json(await ensureEtfSelection(true))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : '系统选池失败' })
  }
})

app.get('/api/risk/policies', (_req, res) => res.json(getRiskPolicies()))
app.post('/api/risk/policies/ai-draft', async (req, res) => {
  try { res.json(await generateRiskPolicyDraft(String((req.body as { prompt?: unknown })?.prompt ?? ''))) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : 'AI 风控编排失败' }) }
})

app.post('/api/risk/policies/:id', (req, res) => {
  try { res.json(saveRiskPolicy(String(req.params.id), (req.body ?? {}) as never)) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '风控编排保存失败' }) }
})
app.post('/api/risk/policies/:id/activate', (req, res) => {
  try { res.json(activateRiskPolicy(String(req.params.id))) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '风控编排启用失败' }) }
})

app.get('/api/system/coordinator/status', async (_req, res) => {
  try {
    const broker = await brokerChannel.status()
    if (!broker.account) return res.status(422).json({ error: '账户不可用' })
    const quoteMap = (await fetchStockQuotes(broker.positions.map((p) => p.symbol)).catch(() => ({ map: {} }))).map
    const quotes = Object.values(quoteMap)
    const sane = sanitizePositionValues(broker.positions, quotes)
    res.json(coordinatorUsage({ totalAsset: broker.account.totalAsset, cashAvailable: broker.account.cashAvailable, positions: sane.positions }))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '额度状态失败' }) }
})

app.get('/api/system/coordinator', (_req, res) => res.json(getCoordinatorConfig()))
app.post('/api/system/coordinator', (req, res) => {
  try { res.json(saveCoordinatorConfig((req.body ?? {}) as never)) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '额度配置失败' }) }
})

app.get('/api/system/kill', (_req, res) => res.json(getKillSwitch()))

app.post('/api/system/kill', async (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'KILL') return res.status(400).json({ error: '急停需要 confirm=KILL' })
  const state = activateKillSwitch(String((req.body as { reason?: unknown })?.reason ?? '手动急停'))
  etfAuto.pause('系统急停')
  quantAuto.pause('系统急停')
  res.json(state)
})

app.post('/api/system/kill/clear', (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'CLEAR_KILL') return res.status(400).json({ error: '解除急停需要 confirm=CLEAR_KILL' })
  const state = clearKillSwitch()
  etfAuto.pause('急停已解除，自动执行保持暂停')
  quantAuto.pause('急停已解除，自动执行保持暂停')
  res.json(state)
})

app.get('/api/system/metrics', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(metricsSnapshot())
})

app.get('/api/system/notify', (_req, res) => res.json(getNotifyConfig()))
app.post('/api/system/notify', (req, res) => {
  try { res.json(saveNotifyConfig((req.body ?? {}) as never)) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '通知配置失败' }) }
})
app.post('/api/system/notify/test', async (_req, res) => {
  res.json(await sendNotification('情绪锚 · 测试通知', '如果你收到这条消息，手机通知配置成功。'))
})

app.get('/api/system/backup', (_req, res) => res.json({ config: getBackupConfig(), backups: getBackups() }))
app.post('/api/system/backup', (_req, res) => { try { res.status(201).json(runBackup()) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '备份失败' }) } })
app.post('/api/system/backup/config', (req, res) => { try { res.json(saveBackupConfig((req.body ?? {}) as never)) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '备份配置失败' }) } })

app.get('/api/plans', (_req, res) => res.json(listTradePlans()))
app.post('/api/plans', (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>
    res.status(201).json(createTradePlan({ symbol: String(b.symbol ?? ''), side: b.side === 'sell' ? 'sell' : 'buy', entryPrice: Number(b.entryPrice), stopPrice: b.stopPrice == null ? null : Number(b.stopPrice), targetPrice: b.targetPrice == null ? null : Number(b.targetPrice), quantity: Number(b.quantity), riskAmount: b.riskAmount == null ? null : Number(b.riskAmount), reason: String(b.reason ?? ''), orderId: b.orderId ? String(b.orderId) : null }))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '计划保存失败' }) }
})
app.post('/api/plans/:id/review', (req, res) => {
  const plan = reviewTradePlan(String(req.params.id), String((req.body as { review?: unknown })?.review ?? ''))
  if (!plan) return res.status(404).json({ error: '计划不存在' })
  res.json(plan)
})

app.get('/api/stock/corporate-actions', async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? '').trim()
    if (!/^(0|3|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '代码无效' })
    res.json(await fetchCorporateActions(symbol))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '公司行为读取失败' }) }
})

app.get('/api/stock/announcements', async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? '').trim()
    if (!/^(0|3|5|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '代码无效' })
    res.json(await fetchAnnouncements(symbol))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '公告读取失败' }) }
})

app.get('/api/pit', (req, res) => {
  const date = String(req.query.date ?? '').trim()
  if (!date) return res.json({ dates: listPit() })
  const data = getPit(date)
  if (!data) return res.status(404).json({ error: '该日期没有 point-in-time 快照' })
  res.json(data)
})

app.get('/api/preopen', (req, res) => {
  const review = getPreopen(String(req.query.date ?? '').trim() || undefined)
  if (!review) return res.status(404).json({ error: '当日盘前候选尚未生成' })
  res.json(review)
})
app.post('/api/preopen', async (_req, res) => {
  if (!market.snapshot) return res.status(422).json({ error: '行情快照不可用' })
  const broker = await brokerChannel.status().catch(() => null)
  res.json(generatePreopen(market.snapshot, broker?.account?.totalAsset ?? 10_000))
})

app.get('/api/intraday/dates', (req, res) => {
  const symbol = String(req.query.symbol ?? '').trim()
  if (!/^(0|3|5|6)\d{5}$/.test(symbol)) return res.status(422).json({ error: '代码无效' })
  res.json({ symbol, dates: listIntradayDates(symbol) })
})

app.get('/api/intraday/backtest', async (req, res) => {
  try { res.json(await runIntradayBacktest(String(req.query.symbol ?? '').trim())) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '分时回测失败' }) }
})

app.get('/api/intraday/rules', (_req, res) => res.json(INTRADAY_RULES))

app.get('/api/intraday/analysis', async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? '').trim()
    const date = String(req.query.date ?? '').trim() || undefined
    res.json(await analyzeIntraday(symbol, date))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '分时分析失败' }) }
})

app.get('/api/analytics/portfolio', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(portfolioAnalytics())
})

app.get('/api/ledger', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const symbol = String(req.query.symbol ?? '').replace(/\D/g, '').slice(0, 6)
  const status = String(req.query.status ?? '').slice(0, 20)
  res.json({ summary: ledgerSummary(), recent: recentLedger(50, { symbol, status }) })
})

app.get('/api/system/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(publicRuntimeConfig())
})

app.post('/api/system/config', (req, res) => {
  try {
    res.json(saveRuntimeConfig((req.body ?? {}) as never))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '系统配置保存失败' }) }
})

app.get('/api/system/broker/test', async (_req, res) => {
  const runtime = getRuntimeConfig()
  try {
    const response = await fetch(`${runtime.brokerUrl}/api/v1/health`, {
      headers: { Accept: 'application/json', ...(runtime.brokerKey ? { 'X-API-Key': runtime.brokerKey } : {}) },
      signal: AbortSignal.timeout(6_000),
    })
    const text = await response.text()
    res.json({ ok: response.ok, status: response.status, url: runtime.brokerUrl, keySent: Boolean(runtime.brokerKey), body: text.slice(0, 500) })
  } catch (err) {
    res.status(422).json({ ok: false, url: runtime.brokerUrl, keySent: Boolean(runtime.brokerKey), error: err instanceof Error ? err.message : '连接失败' })
  }
})

app.get('/api/system/health', async (_req, res) => {
  const snapshot = market.snapshot
  const broker = await brokerChannel.status().catch(() => null)
  const healthQuotes = broker?.positions.length ? (await fetchStockQuotes(broker.positions.map((p) => p.symbol)).catch(() => ({ map: {} }))).map : {}
  const saneHealth = broker ? sanitizePositionValues(broker.positions, Object.values(healthQuotes)) : null
  const coordinator = broker?.account && saneHealth ? coordinatorUsage({ totalAsset: broker.account.totalAsset, cashAvailable: broker.account.cashAvailable, positions: saneHealth.positions }) : null
  const alerts: string[] = []
  if (!broker?.ok) alerts.push('券商接口异常')
  if (snapshot && Date.now() - Date.parse(snapshot.generatedAt) > 30_000) alerts.push('行情超过 30 秒未更新')
  if (activeIntentCount() > 0) alerts.push(`存在 ${activeIntentCount()} 个未完成订单意图`)
  if (getKillSwitch().active) alerts.push('系统急停中')
  if (['recovering', 'error'].includes(etfAuto.getState().status)) alerts.push(`T+0 状态：${etfAuto.getState().status}`)
  if (['recovering', 'error'].includes(quantAuto.getState().status)) alerts.push(`T+1 状态：${quantAuto.getState().status}`)
  evaluateSystemAlerts(alerts)
  res.json({
    ok: Boolean(snapshot && broker?.ok),
    now: new Date().toISOString(),
    snapshot: snapshot ? {
      generatedAt: snapshot.generatedAt,
      ageMs: Date.now() - Date.parse(snapshot.generatedAt),
      marketStatus: snapshot.marketStatus,
      sentiment: { score: snapshot.sentiment.score, stage: snapshot.sentiment.stage },
    } : null,
    broker: broker ? { ok: broker.ok, mode: broker.mode, clientRunning: broker.clientRunning, clientLoggedIn: broker.clientLoggedIn, warnings: broker.warnings ?? [] } : null,
    auto: { t0: etfAuto.getState(), t1: quantAuto.getState() },
    risk: riskEngine.getStatus(),
    commands: brokerChannel.commandState(),
    intents: { active: activeIntentCount(), recent: getOrderIntents(20) },
    ledger: ledgerSummary(),
    coordinator,
    ledgerConsistency: checkLedgerConsistency(),
    alerts,
    metrics: metricsSnapshot(),
    killSwitch: getKillSwitch(),
  })
})

app.get('/api/risk', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ ...riskEngine.getStatus(), lastStopCheckAt: riskMonitor.getLastTick() ?? riskEngine.getStatus().lastStopCheckAt })
})

app.post('/api/risk/config', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    res.json(saveRiskConfig(body as never))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '风控配置保存失败' })
  }
})

app.get('/api/risk/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getRiskConfig())
})

app.get('/api/etf/auto/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getEtfAutoConfig())
})

app.post('/api/etf/auto/config', (req, res) => {
  try { res.json(saveEtfAutoConfig((req.body ?? {}) as never)) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '自动参数保存失败' }) }
})

app.post('/api/strategies/generate', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { module?: unknown; prompt?: unknown }
    const module = body.module === 't1' ? 't1' : body.module === 'risk' ? 'risk' : 't0'
    res.json(await generateStrategyDraft({ module, prompt: String(body.prompt ?? '') }))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : 'AI 策略生成失败' })
  }
})

app.post('/api/etf/strategies', (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; content?: unknown }
    res.status(201).json(createT0Strategy(String(body.name ?? ''), String(body.content ?? '')))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : 'T+0 策略创建失败' }) }
})

app.get('/api/etf/strategies', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getT0Strategies())
})

app.put('/api/etf/strategies/:id', (req, res) => {
  try {
    const body = (req.body ?? {}) as { content?: unknown }
    res.json(saveT0Strategy(String(req.params.id), String(body.content ?? '')))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : 'T+0 策略保存失败' }) }
})

app.post('/api/etf/strategies/:id/activate', (req, res) => {
  try { res.json(activateT0Strategy(String(req.params.id))) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : 'T+0 策略启用失败' }) }
})

app.get('/api/etf/fees', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getEtfFeeSettings())
})

app.post('/api/etf/fees', (req, res) => {
  try {
    const body = (req.body ?? {}) as { maxDailyFeePct?: unknown; maxDailyFeeAmount?: unknown }
    res.json(saveEtfFeeSettings(body))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '手续费配置保存失败' })
  }
})

app.get('/api/broker/commands', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(brokerChannel.commandState())
})

app.get('/api/quant/strategies', (_req, res) => {
  const strategies = listStrategyDefinitions()
  res.setHeader('Cache-Control', 'no-store')
  res.json({ activeId: strategies.find((s) => s.status === 'active')?.id ?? null, strategies })
})

app.post('/api/quant/strategies', (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; content?: unknown }
    res.status(201).json(createStrategy({ name: String(body.name ?? ''), content: String(body.content ?? '') }))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '创建策略失败' })
  }
})

app.put('/api/quant/strategies/:id', (req, res) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; content?: unknown }
    res.json(updateStrategy(String(req.params.id), { name: typeof body.name === 'string' ? body.name : undefined, content: typeof body.content === 'string' ? body.content : undefined }))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '保存策略失败' })
  }
})

app.post('/api/quant/strategies/:id/activate', (req, res) => {
  try {
    const force = (req.body as { force?: unknown })?.force === true
    assertStrategyQuality(String(req.params.id), force)
    res.json(activateStrategy(String(req.params.id)))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '启用策略失败' }) }
})

app.post('/api/quant/strategies/:id/duplicate', (req, res) => {
  try { res.status(201).json(duplicateStrategy(String(req.params.id))) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '复制策略失败' }) }
})

app.delete('/api/quant/strategies/:id', (req, res) => {
  try { removeStrategy(String(req.params.id)); res.json({ ok: true }) } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '删除策略失败' }) }
})

app.get('/api/quant/strategy', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ active: getActiveQuantStrategy(), strategies: listQuantStrategies() })
})

app.post('/api/quant/strategy', (req, res) => {
  try {
    const body = (req.body ?? {}) as { active?: unknown; config?: unknown }
    const active = typeof body.active === 'string' ? body.active : undefined
    const config = body.config && typeof body.config === 'object' ? body.config as Record<string, unknown> : undefined
    res.json({ active: saveQuantStrategy({ active: active as never, config: config as never }), strategies: listQuantStrategies() })
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '保存策略失败' })
  }
})

app.post('/api/quant/robustness', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { code?: unknown; days?: unknown }
    res.json(await runQuantRobustness({ code: String(body.code ?? ''), days: Number(body.days) || 180, strategyId: String((body as { strategyId?: unknown }).strategyId ?? '') || undefined }))
  } catch (err) { res.status(422).json({ error: err instanceof Error ? err.message : '稳健性测试失败' }) }
})

app.post('/api/quant/backtest', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { code?: unknown; days?: unknown; strategyId?: unknown }
    const selected = typeof body.strategyId === 'string' ? getQuantStrategyById(body.strategyId) : null
    const result = await runQuantBacktest({ code: String(body.code ?? ''), strategy: selected ?? getActiveQuantStrategy(), days: Number(body.days) || 180 })
    res.json(result)
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '回测失败' })
  }
})

app.get('/api/quant/auto', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(quantAuto.getState())
})

app.post('/api/quant/auto/start', async (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'QUANT') return res.status(400).json({ error: '启动 T+1 量化需要 confirm=QUANT' })
  try {
    res.json(await quantAuto.start())
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : 'T+1 量化启动失败' })
  }
})

app.post('/api/quant/auto/pause', (_req, res) => {
  res.json(quantAuto.pause('手动暂停'))
})

app.post('/api/quant/auto/flatten', async (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'QUANT_FLATTEN') return res.status(400).json({ error: 'T+1 清仓需要 confirm=QUANT_FLATTEN' })
  try {
    res.json(await quantAuto.flatten())
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : 'T+1 清仓失败' })
  }
})

app.get('/api/quant/pool', async (_req, res) => {
  try {
    const candidates = market.snapshot
      ? buildQuantCandidates(market.snapshot, (await brokerChannel.status()).account?.totalAsset ?? 0)
      : []
    const qp = getQuantPool()
    res.json(enrichQuantPool(qp.codes, candidates, qp.assignments))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : '读取量化池失败' })
  }
})

app.post('/api/quant/pool', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { code?: unknown; action?: unknown }
    if (body.action === 'remove') {
      res.json(removeQuantCode(String(body.code ?? '')))
      return
    }
    if (body.action === 'assign') {
      const strategyId = String((body as { strategyId?: unknown }).strategyId ?? '')
      const valid = listStrategyDefinitions().some((x) => x.id === strategyId)
      if (!valid) throw new Error('策略不存在')
      res.json(setQuantAssignment(String(body.code ?? ''), strategyId))
      return
    }
    res.json(addQuantCode(String(body.code ?? '')))
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : '更新量化池失败' })
  }
})

app.get('/api/etf/sentiment-log', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ logs: getSentimentLog(Number(req.query.limit) || 100) })
})

app.get('/api/etf/executions', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ executions: getExecutions(Number(req.query.limit) || 50) })
})

app.post('/api/etf/executions/:id/dismiss', async (req, res) => {
  if (req.body?.confirm !== 'DISMISS') return res.status(400).json({ error: '标记未成交需要 confirm=DISMISS' })
  try {
    res.json(await dismissUnknownExecution(String(req.params.id)))
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : '标记未成交失败' })
  }
})

app.post('/api/etf/executions/reconcile', async (_req, res) => {
  try {
    res.json(await reconcileUnknownExecutions())
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : '核对委托失败' })
  }
})

app.get('/api/etf/auto', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(etfAuto.getState())
})

app.post('/api/etf/auto/start', async (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'AUTO') return res.status(400).json({ error: '启动自动执行需要 confirm=AUTO' })
  try {
    res.json(await etfAuto.start())
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : '自动执行启动失败' })
  }
})

app.post('/api/etf/auto/pause', (_req, res) => {
  res.json(etfAuto.pause('手动暂停'))
})

app.post('/api/etf/auto/flatten', async (req, res) => {
  if ((req.body as { confirm?: unknown })?.confirm !== 'FLATTEN') return res.status(400).json({ error: '全部清仓需要 confirm=FLATTEN' })
  try {
    res.json(await etfAuto.flatten())
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : '清仓失败' })
  }
})

app.get('/api/etf/history', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ days: getEtfHistory() })
})

app.get('/api/etf/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getEtfConfig())
})

app.post('/api/etf/config', (req, res) => {
  try {
    res.json(saveEtfConfig(req.body ?? {}))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '保存 ETF 池失败' })
  }
})

app.post('/api/etf/config/reset', (_req, res) => {
  res.json(resetEtfConfig())
})

app.get('/api/etf', async (req, res) => {
  if (!market.snapshot) return res.status(503).json({ error: '行情尚未初始化' })
  try {
    res.setHeader('Cache-Control', 'no-store')
    res.json(await getEtfDesk(market.snapshot, req.query.force === '1'))
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'ETF 策略台加载失败' })
  }
})

app.get('/api/ai/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(publicAiConfig())
})

app.post('/api/ai/config', (req, res) => {
  const body = (req.body ?? {}) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown; provider?: unknown }
  try {
    res.json(saveAiConfig({
      apiKey: body.apiKey == null ? undefined : String(body.apiKey),
      baseUrl: body.baseUrl == null ? undefined : String(body.baseUrl),
      model: body.model == null ? undefined : String(body.model),
      provider: body.provider == null ? undefined : String(body.provider),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '保存 AI 配置失败' })
  }
})

app.post('/api/ai/clear', (_req, res) => {
  try {
    res.json(clearAiConfig())
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '清除 AI 配置失败' })
  }
})

app.post('/api/ai/models', async (req, res) => {
  const body = (req.body ?? {}) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown; provider?: unknown }
  try {
    res.json(await listAiModels({
      apiKey: body.apiKey == null ? undefined : String(body.apiKey),
      baseUrl: body.baseUrl == null ? undefined : String(body.baseUrl),
      model: body.model == null ? undefined : String(body.model),
      provider: body.provider == null ? undefined : String(body.provider),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取模型失败' })
  }
})

app.post('/api/ai/test', async (req, res) => {
  const body = (req.body ?? {}) as { apiKey?: unknown; baseUrl?: unknown; model?: unknown; provider?: unknown }
  try {
    res.json(await testAiConfig({
      apiKey: body.apiKey == null ? undefined : String(body.apiKey),
      baseUrl: body.baseUrl == null ? undefined : String(body.baseUrl),
      model: body.model == null ? undefined : String(body.model),
      provider: body.provider == null ? undefined : String(body.provider),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '连接测试失败' })
  }
})

app.get('/api/ai', (_req, res) => {
  if (!market.snapshot) return res.status(503).json({ error: '行情尚未初始化' })
  res.setHeader('Cache-Control', 'no-store')
  res.json(getAiEnvelope(market.snapshot))
})

app.post('/api/ai', async (req, res) => {
  if (!market.snapshot) return res.status(503).json({ error: '行情尚未初始化' })
  const mode = (req.body as { mode?: unknown })?.mode === 'llm' ? 'llm' : 'local'
  const force = Boolean((req.body as { force?: unknown })?.force)
  try {
    const envelope = await generateAi(market.snapshot, mode, force)
    if (envelope.llmError && !envelope.llmConfigured) res.setHeader('X-AI-Fallback', 'local')
    res.json(envelope)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI 研判失败' })
  }
})

app.get('/api/calendar', async (_req, res) => {
  const cal = await getCalendar()
  res.setHeader('Cache-Control', 'no-store')
  res.json(cal)
})

app.get('/api/calendar/:date', async (req, res) => {
  const date = String(req.params.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  const day = await getCalendarDay(date)
  if (!day) return res.status(404).json({ error: '该交易日暂无归档' })
  res.json(day)
})

app.get('/api/alerts', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json(getAlerts())
})

app.post('/api/alerts/config', async (req, res) => {
  const body = req.body as { rules?: unknown; webhookUrl?: unknown }
  let webhookUrl: string | undefined
  try {
    webhookUrl = typeof body.webhookUrl === 'string' ? await assertSafeWebhookUrl(body.webhookUrl) : undefined
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Webhook URL 不安全' })
  }
  const rules = Array.isArray(body.rules) ? (body.rules as any[]).map((r) => ({
    id: String(r?.id ?? ''),
    label: String(r?.label ?? ''),
    description: String(r?.description ?? ''),
    enabled: Boolean(r?.enabled),
    threshold: Number(r?.threshold) || 0,
    unit: String(r?.unit ?? ''),
  })) : undefined
  res.json(configureAlerts({ rules, webhookUrl }))
})

app.post('/api/alerts/read', (req, res) => {
  const ids = (req.body as { ids?: unknown })?.ids
  res.json(markAlertsRead(Array.isArray(ids) ? ids.map(String) : undefined))
})

app.get('/api/watchlist', (_req, res) => {
  res.json(market.getWatchlist())
})

app.post('/api/watchlist', (req, res) => {
  const body = req.body as { codes?: unknown; code?: unknown; action?: unknown }
  if (Array.isArray(body.codes)) {
    return res.json(market.setWatchlist(body.codes.map(String)))
  }
  const code = String(body.code ?? '')
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位股票代码' })
  const current = market.getWatchlist().codes
  const codes = body.action === 'remove' ? current.filter((c) => c !== code) : [...current, code]
  res.json(market.setWatchlist(codes))
})

app.post('/api/refresh', async (_req, res) => {
  await market.tick()
  res.json({ ok: true, snapshot: market.snapshot })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API not found' })
})

const dist = path.join(process.cwd(), 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><html><body style="font-family:system-ui;background:#f4f1ea;color:#20262c;padding:48px">' +
          '<h1>情绪锚 API 已启动</h1><p>前端开发地址：<a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a></p>' +
          '<p>或运行 <code>pnpm build</code> 后刷新本页。</p></body></html>',
      )
  })
}

const heartbeat = setInterval(() => {
  for (const client of clients) {
    try {
      client.write(`: heartbeat ${Date.now()}\n\n`)
    } catch {
      clients.delete(client)
    }
  }
}, 15_000)
heartbeat.unref()

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] 情绪锚 API  http://${HOST}:${PORT}  (refresh ${REFRESH_MS}ms)`)
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !authRequired()) {
    console.warn('[security] HOST 不是本机且未设置 APP_TOKEN，请勿直接暴露到公网')
  }
  // 历史归档不足 30 天时，后台静默回填（串行、轻限速，不阻塞启动）
  void (async () => {
    try {
      const have = countDays()
      if (have < 30) {
        console.log(`[sentiment] 历史仅 ${have} 天，后台回填至 30 天…`)
        await backfillSentiment(30)
      }
    } catch (err) {
      console.warn('[sentiment] 历史回填失败：', err instanceof Error ? err.message : err)
    }
  })()
})

async function shutdown(signal: string) {
  console.log(`\n[server] ${signal} received, shutting down`)
  clearInterval(heartbeat)
  clearInterval(orderMonitor)
  releaseInstanceLock()
  market.stop()
  for (const client of clients) client.end()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2_500).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

void reconcileOrderIntents().catch(() => undefined)
backfillLedgerFromExecutions()
void market.start()
