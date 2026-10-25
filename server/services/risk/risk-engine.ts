import fs from 'node:fs'
import path from 'node:path'
import type { RiskCheck, RiskConfig, RiskDecision, RiskStatus } from '../../../shared/types.js'
import { atomicWriteJson } from '../../lib/atomic.js'
import { fetchEtfBrokerStatus, fetchEtfOrders, isFilledStatus, isRejectedStatus } from '../etf-broker.js'
import { getRiskConfig } from './risk-config.js'
import { applyPolicyConfig, getActiveRiskPolicy } from './risk-policy.js'
import { checkEngineBudget } from '../trading-coordinator.js'
import { recordRiskEvent } from '../ledger.js'
import { inc } from '../metrics.js'
import { sanitizePositionValues } from '../position-sanity.js'
import { fetchStockQuotes } from '../../providers/sina.js'
import { fetchAnnouncements } from '../../providers/announcements.js'
import { analyzeIntraday } from '../intraday-analysis.js'

const EVENTS_FILE = path.join(process.cwd(), 'data', 'risk-events.json')
const MAX_EVENTS = 500

export interface BuyRiskContext {
  symbol: string
  price: number
  quantity: number
  source: string
}

export interface BuyRiskRule {
  id: string
  label: string
  evaluate(ctx: BuyRiskContext): Promise<RiskCheck> | RiskCheck
}

export class RiskBlockedError extends Error {
  decision: RiskDecision
  constructor(decision: RiskDecision) {
    super(`风控拦截：${decision.reasons.join('；')}`)
    this.name = 'RiskBlockedError'
    this.decision = decision
  }
}

class RiskEngine {
  private events: RiskDecision[] = load()
  private lastCheckAt: string | null = null
  private lastStopCheckAt: string | null = null
  private rules: BuyRiskRule[] = []
  private snapshotProvider: (() => { generatedAt: string; marketStatus: string } | null) | null = null

  configureSnapshot(provider: () => { generatedAt: string; marketStatus: string } | null) { this.snapshotProvider = provider }

  registerBuyRule(rule: BuyRiskRule) {
    this.rules.push(rule)
  }

  /** Read-only preview used by the manual-order ticket. Never records a decision. */
  async previewBuy(ctx: BuyRiskContext, opts: { fresh?: boolean } = {}): Promise<RiskDecision> {
    const config = applyPolicyConfig(ctx.source, getRiskConfig())
    const activePolicy = getActiveRiskPolicy(ctx.source)
    const policyParam = (id: string) => activePolicy.rules.find((r) => r.id === id)?.params ?? {}
    const checks: RiskCheck[] = []
    if (!config.enabled) {
      checks.push({ id: 'enabled', label: '风控开关', passed: true, detail: '风控关闭' })
    } else {
      checks.push(...await this.runRules(ctx, config, opts.fresh !== false))
    }
    const policy = activePolicy
    const ruleMap = new Map(policy.rules.map((r) => [r.id, r]))
    const applied = checks.filter((c) => ruleMap.get(c.id as never)?.enabled !== false)
    const failed = applied.filter((c) => !c.passed && ruleMap.get(c.id as never)?.severity !== 'warn')
    const warnings = applied.filter((c) => !c.passed && ruleMap.get(c.id as never)?.severity === 'warn').map((c) => c.detail)
    return {
      id: `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      time: new Date().toISOString(),
      kind: 'buy', allowed: failed.length === 0,
      symbol: ctx.symbol, side: 'buy', quantity: ctx.quantity, price: ctx.price, source: ctx.source,
      checks: applied, reasons: [...failed.map((c) => c.detail), ...warnings], status: failed.length === 0 ? 'allowed' : 'blocked',
    }
  }

  async checkBuy(ctx: BuyRiskContext): Promise<RiskDecision> {
    const decision = await this.previewBuy(ctx, { fresh: true })
    this.lastCheckAt = decision.time
    inc(decision.allowed ? 'risk.allowed' : 'risk.blocked')
    this.record(decision)
    recordRiskEvent(decision)
    if (!decision.allowed) throw new RiskBlockedError(decision)
    return decision
  }

  recordStop(decision: RiskDecision): RiskDecision {
    this.lastStopCheckAt = decision.time
    this.record(decision)
    recordRiskEvent(decision)
    return decision
  }

  update(id: string, patch: Partial<RiskDecision>) {
    const i = this.events.findIndex((e) => e.id === id)
    if (i >= 0) { this.events[i] = { ...this.events[i], ...patch }; this.persist() }
  }

  hasStopEventToday(symbol: string): boolean {
    const today = shanghaiDate()
    return this.events.some((e) => (e.kind === 'stop' || e.kind === 'stop_blocked') && e.symbol === symbol && e.time.startsWith(today))
  }

  getStatus(): RiskStatus {
    const today = shanghaiDate()
    return {
      config: getRiskConfig(),
      decisions: this.events.slice(0, 100),
      lastCheckAt: this.lastCheckAt,
      lastStopCheckAt: this.lastStopCheckAt,
      blockedToday: this.events.filter((e) => e.kind === 'buy' && e.status === 'blocked' && e.time.startsWith(today)).length,
      stopToday: this.events.filter((e) => e.kind !== 'buy' && e.time.startsWith(today)).length,
    }
  }

  private async runRules(ctx: BuyRiskContext, config: RiskConfig, fresh = true): Promise<RiskCheck[]> {
    const activePolicy = getActiveRiskPolicy(ctx.source)
    const policyParam = (id: string) => activePolicy.rules.find((r) => r.id === id)?.params ?? {}
    const checks: RiskCheck[] = []
    const session = sessionCheck(config)
    checks.push(session)
    const broker = await fetchEtfBrokerStatus(fresh).catch(() => null)
    if (!broker?.ok || !broker.account) {
      checks.push({ id: 'broker', label: '交易接口', passed: false, detail: broker?.error || '交易接口不可用' })
      return checks
    }
    if (broker.mode !== 'live') {
      // 接口是通的，只是演练模式：不能说"不可用"，否则会被误判成适配器故障
      checks.push({
        id: 'broker',
        label: '交易接口',
        passed: false,
        detail: `演练模式（${broker.mode}），不能发真实委托；切 live 需先小额验证`,
      })
      return checks
    }
    const account = broker.account
    const quoteMap = (await fetchStockQuotes([...broker.positions.map((p) => p.symbol), ctx.symbol]).catch(() => ({ map: {} }))).map as Record<string, { code: string; price: number; name?: string }>
    const quotes = Object.values(quoteMap)
    const targetQuote = quoteMap[ctx.symbol] ?? null
    const openOrders = await fetchEtfOrders(fresh).catch(() => [])
    const pendingBuyNotional = openOrders
      .filter((o) => (o.side === '买入' || o.side === 'buy') && !isFilledStatus(o.status) && !isRejectedStatus(o.status) && o.filled < o.quantity)
      .reduce((sum, o) => sum + o.price * (o.quantity - o.filled), 0)
    const sane = sanitizePositionValues(broker.positions, quotes)
    const positions = sane.positions
    const exposure = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)
    const notional = ctx.price * ctx.quantity
    checks.push({ id: 'quote', label: '行情可用 / 停牌', passed: Boolean(targetQuote && targetQuote.price > 0), detail: '目标标的行情不可用或疑似停牌' })
    checks.push({ id: 'st', label: 'ST / 退市风险', passed: !/ST|退/.test(targetQuote?.name ?? ''), detail: `${targetQuote?.name ?? ctx.symbol} 命中 ST/退市过滤` })
    const announcements = await fetchAnnouncements(ctx.symbol).catch(() => [])
    const risky = announcements.filter((a) => a.risk).slice(0, 2)
    checks.push({ id: 'announcement', label: '公告风险', passed: risky.length === 0, detail: risky.length ? `近期公告风险：${risky.map((a) => a.title).join('；')}` : '近期无高风险公告' })
    checks.push({ id: 'price', label: '价格有效', passed: Number.isFinite(ctx.price) && ctx.price > 0, detail: '委托价格必须大于 0' })
    checks.push({ id: 'lot', label: '整手', passed: Number.isInteger(ctx.quantity) && ctx.quantity % 100 === 0, detail: '委托数量必须是 100 股整数倍' })
    checks.push({ id: 'order-limit', label: '单笔金额', passed: notional <= config.buy.maxOrderAmount, detail: `单笔 ${notional.toFixed(0)} 超过上限 ${config.buy.maxOrderAmount}` })
    checks.push({ id: 'cash', label: '可用资金', passed: account.cashAvailable - pendingBuyNotional - notional >= config.buy.minCashReserve, detail: `可用 ${account.cashAvailable.toFixed(0)}，在途买入 ${pendingBuyNotional.toFixed(0)}，需保留 ${config.buy.minCashReserve}` })
    const pos = positions.find((p) => p.symbol === ctx.symbol)
    const symbolValue = (pos?.marketValue || 0) + notional
    checks.push({ id: 'symbol-exposure', label: '单票集中度', passed: symbolValue <= account.totalAsset * config.buy.maxSymbolPct / 100, detail: `单票 ${symbolValue.toFixed(0)} 超过 ${config.buy.maxSymbolPct}% 上限` })
    checks.push({ id: 'account-exposure', label: '账户总仓位', passed: exposure + pendingBuyNotional + notional <= account.totalAsset * config.buy.maxAccountExposurePct / 100, detail: `买入后总仓位超过 ${config.buy.maxAccountExposurePct}%` })
    const snap = this.snapshotProvider?.()
    const maxAgeSec = Number(policyParam('data-freshness').maxAgeSec ?? 30)
    checks.push({ id: 'data-freshness', label: '行情新鲜度', passed: Boolean(snap && Date.now() - Date.parse(snap.generatedAt) < maxAgeSec * 1000 && snap.marketStatus === '盘中'), detail: `行情超过 ${maxAgeSec} 秒未更新或不在盘中` })
    const dailyLossPct = account.totalAsset > 0 ? (account.pnlToday / account.totalAsset) * 100 : 0
    checks.push({ id: 'daily-loss', label: '当日亏损熔断', passed: dailyLossPct > -config.buy.maxDailyLossPct, detail: `当日亏损 ${dailyLossPct.toFixed(2)}% 触及 -${config.buy.maxDailyLossPct}%` })
    const intraday = await analyzeIntraday(ctx.symbol).catch(() => null)
    const last = intraday?.bars[intraday.bars.length - 1]
    const structure = intraday?.stats
    const minAbove = Number(policyParam('intraday-structure').minAboveRatio ?? 50)
    checks.push({ id: 'intraday-structure', label: '分时结构：价 > 均价线', passed: Boolean(last && structure && last.price >= last.vwap && structure.aboveVwapRatio >= minAbove), detail: last && structure ? `现价 ${last.price.toFixed(3)} / 均价 ${last.vwap.toFixed(3)} · 线上 ${structure.aboveVwapRatio.toFixed(1)}%` : '分时数据不可用' })
    const minVol = Number(policyParam('volume-price').minUpDownVolumeRatio ?? 1.2)
    checks.push({ id: 'volume-price', label: '量价配合', passed: Boolean(structure && structure.upDownVolumeRatio >= minVol), detail: structure ? `涨跌分钟量比 ${structure.upDownVolumeRatio.toFixed(2)}` : '分时数据不可用' })
    const maxFlags = Number(policyParam('intraday-redflags').maxRedFlags ?? 1)
    checks.push({ id: 'intraday-redflags', label: '分时红旗', passed: Boolean(intraday && intraday.redFlags.length <= maxFlags), detail: intraday ? `红旗 ${intraday.redFlags.length} 条${intraday.redFlags.length ? '：' + intraday.redFlags.map((f) => f.text).join('、') : ''}` : '分时数据不可用' })
    const rawRequire = policyParam('buy-point').requireSignal
    const requireSignal = rawRequire === false || rawRequire === 'false' || rawRequire === 0 ? false : true
    const hasBuy = Boolean(intraday?.signals.some((x) => x.action === 'buy' && ['B1', 'B3', 'B4'].includes(x.id)))
    checks.push({ id: 'buy-point', label: '有效买点 B1/B3/B4', passed: !requireSignal || hasBuy, detail: intraday ? (hasBuy ? '存在有效买点信号' : '尚未出现 B1/B3/B4 买点') : '分时数据不可用' })
    const maxAbove = Number(policyParam('chase').maxAboveVwapPct ?? 3)
    const abovePct = last && last.vwap > 0 ? (ctx.price / last.vwap - 1) * 100 : null
    checks.push({ id: 'chase', label: '追高保护', passed: abovePct == null ? false : abovePct <= maxAbove, detail: abovePct == null ? '无均价线可比较' : `委托价高于均价线 ${abovePct.toFixed(2)}%，上限 ${maxAbove}%` })
    const budget = checkEngineBudget({ source: ctx.source, symbol: ctx.symbol, price: ctx.price, quantity: ctx.quantity, totalAsset: account.totalAsset, cashAvailable: account.cashAvailable, positions, pendingBuyNotional })
    checks.push({ id: 'pending-buys', label: '在途买入', passed: pendingBuyNotional < account.cashAvailable, detail: `在途买入占用 ¥${pendingBuyNotional.toFixed(0)}` })
    checks.push({ id: 'engine-budget', label: '策略额度', passed: budget.passed, detail: budget.detail })
    checks.push({ id: 'blocked-code', label: '黑名单', passed: !config.buy.blockedCodes.includes(ctx.symbol), detail: `${ctx.symbol} 在风控黑名单` })
    const today = shanghaiDate()
    const buysToday = this.events.filter((e) => e.kind === 'buy' && e.time.startsWith(today) && e.status !== 'blocked').length
    checks.push({ id: 'daily-limit', label: '当日买入次数', passed: buysToday < config.buy.maxOrdersPerDay, detail: `今日买入已达 ${config.buy.maxOrdersPerDay} 次` })
    const cutoff = Date.now() - config.buy.duplicateWindowSec * 1000
    const duplicate = this.events.some((e) => e.kind === 'buy' && e.symbol === ctx.symbol && e.allowed && Date.parse(e.time) >= cutoff)
    checks.push({ id: 'duplicate', label: '重复委托', passed: !duplicate, detail: `${ctx.symbol} 在 ${config.buy.duplicateWindowSec}s 内已有买入` })
    for (const rule of this.rules) checks.push(await rule.evaluate(ctx))
    return checks
  }

  private record(decision: RiskDecision) {
    this.events.unshift(decision)
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
    this.persist()
  }

  private persist() {
    try { atomicWriteJson(EVENTS_FILE, this.events) } catch { /* best effort */ }
  }
}

function sessionCheck(config: RiskConfig): RiskCheck {
  const minutes = shanghaiMinutes()
  const ok = config.buy.allowedSessions.some((s) => {
    const [a, b] = s.split('-')
    return minutes >= toMinutes(a) && minutes <= toMinutes(b)
  })
  return { id: 'session', label: '交易时段', passed: ok, detail: `当前不在允许买入时段（${config.buy.allowedSessions.join(' / ')}）` }
}

function toMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function shanghaiMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
}

function load(): RiskDecision[] {
  try {
    const raw = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')) as RiskDecision[]
    return Array.isArray(raw) ? raw.slice(0, MAX_EVENTS) : []
  } catch { return [] }
}

export const riskEngine = new RiskEngine()
