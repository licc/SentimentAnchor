import type { EtfBrokerStatus, EtfDeskPayload, EtfQuote, EtfSignal, EtfStrategyRules, EtfUniverseItem, Snapshot } from '../../shared/types.js'
import { fetchStockQuotes, prefixFor } from '../providers/sina.js'
import { fetchEtfBrokerStatus } from './etf-broker.js'
import { getEtfConfig } from './etf-config.js'
import { getEtfAutoConfig } from './etf-auto-config.js'
import { getActiveT0Strategy } from './t0-strategy.js'
import { getRuntimeConfig } from './runtime-config.js'
import { ensureEtfSelection } from './etf-selector.js'
import { commission, getFeeModel, roundTripCostPct } from './etf-fees.js'
import { recordSentiment } from './etf-sentiment-log.js'
import { ensureToday, getHistory, getToday, recordSignal, recordTrade, resetToday } from './etf-journal.js'
import { ensureDayBaseline } from './etf-day-baseline.js'
import { sanitizePositionValues } from './position-sanity.js'

let lastQuoteAt = 0
let quoteCache: EtfQuote[] = []
let quoteKey = ''
let lastBrokerAt = 0
let brokerCache: Awaited<ReturnType<typeof fetchEtfBrokerStatus>> | null = null
let deskCache: { at: number; key: string; data: EtfDeskPayload } | null = null
let deskInFlight: { key: string; promise: Promise<EtfDeskPayload> } | null = null

const RULES: EtfStrategyRules = {
  riskOnScore: 55,
  riskOffScore: 42,
  cooldownSec: 600,
  maxPositionPct: 0.7,
  stopLossPct: 1.2,
  maxSwitchesPerDay: 1,
  lotSize: 100,
  flatTime: '14:55',
}

export function getEtfDesk(snapshot: Snapshot, force = false): Promise<EtfDeskPayload> {
  const cacheKey = snapshot.dataAsOf || snapshot.generatedAt
  if (!force && deskCache && deskCache.key === cacheKey && Date.now() - deskCache.at < 8_000) return Promise.resolve(deskCache.data)
  if (!force && deskInFlight?.key === cacheKey) return deskInFlight.promise
  const promise = buildEtfDesk(snapshot, cacheKey).finally(() => {
    if (deskInFlight?.promise === promise) deskInFlight = null
  })
  deskInFlight = { key: cacheKey, promise }
  return promise
}

async function buildEtfDesk(snapshot: Snapshot, cacheKey: string): Promise<EtfDeskPayload> {
  const selection = await ensureEtfSelection().catch(() => null)
  const universe = getEtfConfig().universe
  const quotes = await getQuotes(universe)
  const rawBroker = await getBroker()
  const broker = sanitizeBroker(rawBroker, quotes)
  const signal = buildSignal(snapshot, quotes, universe)
  const existingToday = getToday()
  const connectedLive = Boolean(broker.ok && broker.mode === 'live' && broker.account)
  const liveMode = connectedLive || existingToday?.mode === 'live'
  const equity = liveMode ? (broker.account?.totalAsset ?? existingToday?.equity ?? 0) : 0
  const mode = liveMode ? 'live' : 'paper'
  const baseline = ensureDayBaseline({ equity, mode, positions: broker.positions, existingStart: getToday()?.startEquity })
  ensureToday(baseline.startEquity, mode)
  const today = recordSignal(signal, equity, mode)
  recordSentiment({ snapshot, signal, quotes, broker })
  const payload: EtfDeskPayload = {
    broker,
    quotes,
    signal,
    universe: universe.map((u) => ({ ...u, name: quotes.find((q) => q.code === u.code)?.name || u.code })),
    rules: (() => { const ac = getEtfAutoConfig(); const st = getActiveT0Strategy().config; return { ...RULES, riskOnScore: st.riskOnScore, riskOffScore: st.riskOffScore, stopLossPct: ac.stopLossPct, cooldownSec: ac.cooldownSec, maxSwitchesPerDay: ac.maxSwitchesPerDay, flatTime: ac.flatTime } })(),
    today,
    fees: getFeeModel(),
    maxManualOrderAmount: getRuntimeConfig().maxManualOrderAmount,
    selection: selection ?? {
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
      generatedAt: new Date().toISOString(),
      source: 'fallback',
      items: universe.map((u) => ({ code: u.code, name: quotes.find((q) => q.code === u.code)?.name || u.code, role: u.role, score: 0, vol20: 0, avgAmount20: 0, tickPct: 0, roundTripPct: 0, pct: 0, reason: '沿用当前 ETF 池' })),
      candidates: [],
      note: '系统选池失败，沿用当前 ETF 池',
    },
    tradeMode: connectedLive ? 'live' : 'readonly',
    note: connectedLive
      ? '实盘接口已连接；下单必须手动确认，受单笔上限、资金和持仓检查。'
      : broker.mode === 'live'
        ? '接口模式是 live，但健康检查或账户读取失败；当前不能下单。'
        : '当前为只读接口：不会向券商发送委托，也不提供模拟账户。接口处于 dry_run 时无法下单。',
  }
  deskCache = { at: Date.now(), key: cacheKey, data: payload }
  return payload
}

export function getEtfHistory() {
  return getHistory()
}

function sanitizeBroker(broker: EtfBrokerStatus, quotes: EtfQuote[]): EtfBrokerStatus {
  const { positions, warnings } = sanitizePositionValues(broker.positions, quotes)
  return warnings.length ? { ...broker, positions, warnings } : broker
}

function buildSignal(snapshot: Snapshot, quotes: EtfQuote[], universe: EtfUniverseItem[]): EtfSignal {
  const { score, stage, trend } = snapshot.sentiment
  const strategy = getActiveT0Strategy().config
  const riskOn = strategy.stages.includes(stage) && score >= strategy.riskOnScore && trend >= 0 && strategy.allowRisk
  const riskOff = ['退潮', '冰点'].includes(stage) || score < strategy.riskOffScore || trend <= -5 || (!strategy.allowRisk && !riskOn)
  const regime: EtfSignal['regime'] = riskOn ? 'risk-on' : riskOff ? 'risk-off' : 'neutral'
  let target: EtfQuote | undefined
  const roleOf = (code: string) => universe.find((u) => u.code === code)?.role
  if (regime === 'risk-on') {
    const risk = quotes.filter((q) => roleOf(q.code) === 'risk').sort((a, b) => b.pct - a.pct)
    target = risk[0]
    // For a 10k account, prefer 513310's deep liquidity unless another risk ETF
    // has a clear (>0.6%) relative-strength lead.
    const core = risk.find((q) => q.code === '513310')
    if (target && core && target.code !== '513310' && core.pct >= 0 && target.pct - core.pct < 0.6) {
      target = core
    }
  } else if (regime === 'risk-off') {
    target = quotes.filter((q) => roleOf(q.code) === 'hedge' || roleOf(q.code) === 'defensive').sort((a, b) => b.pct - a.pct)[0]
  }
  const reason = regime === 'risk-on'
    ? `情绪 ${stage}（${score}）且趋势向上，选择相对强势的风险 ETF`
    : regime === 'risk-off'
      ? `情绪 ${stage}（${score}），转向黄金防守`
      : `情绪 ${stage}（${score}）方向不明，空仓等待，不持有 ETF`
  const positionPct = regime === 'risk-on' ? strategy.riskOnPositionPct : regime === 'risk-off' ? strategy.riskOffPositionPct : 0
  return {
    regime,
    targetCode: target?.code ?? null,
    targetName: target?.name ?? null,
    reason,
    score,
    stage,
    trend,
    positionPct,
    foreignFear: snapshot.sentiment.foreignFear ?? null,
    updatedAt: new Date().toISOString(),
  }
}

async function getQuotes(universe: EtfUniverseItem[]): Promise<EtfQuote[]> {
  const key = universe.map((x) => `${x.code}:${x.role}`).join(',')
  if (key !== quoteKey) {
    quoteKey = key
    quoteCache = []
    lastQuoteAt = 0
  }
  if (Date.now() - lastQuoteAt < 8_000 && quoteCache.length) return quoteCache
  try {
    const res = await fetchStockQuotes(universe.map((x) => prefixFor(x.code)))
    quoteCache = universe.map((def) => {
      const stock = res.map[def.code]
      return {
        code: def.code,
        name: stock?.name || def.code,
        price: stock?.price || 0,
        pct: stock?.pct || 0,
        amount: stock?.amount || 0,
        tone: (stock?.pct ?? 0) > 0.001 ? 'up' : (stock?.pct ?? 0) < -0.001 ? 'down' : 'flat',
      }
    })
    lastQuoteAt = Date.now()
    return quoteCache
  } catch {
    return quoteCache
  }
}

async function getBroker() {
  if (brokerCache && Date.now() - lastBrokerAt < 10_000) return brokerCache
  brokerCache = await fetchEtfBrokerStatus()
  lastBrokerAt = Date.now()
  return brokerCache
}

function roundPrice(value: number) {
  return Math.round(value * 1000) / 1000
}
