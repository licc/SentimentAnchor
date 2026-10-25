import fs from 'node:fs'
import path from 'node:path'
import type { EtfBrokerStatus, EtfQuote, EtfSentimentLog, EtfSignal, Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'etf-sentiment-log.json')
const MAX = 1000
const MIN_INTERVAL_MS = 60_000
let rows: EtfSentimentLog[] = load()
let lastAt = 0
let lastKey = ''

export function recordSentiment(input: {
  snapshot: Snapshot
  signal: EtfSignal
  quotes: EtfQuote[]
  broker: EtfBrokerStatus
  source?: string
}) {
  const { snapshot, signal, quotes, broker } = input
  // Only the live trading session writes sentiment entries; closed/holiday polling is ignored.
  if (snapshot.marketStatus !== '盘中' && snapshot.marketStatus !== '集合竞价') return
  const key = `${signal.regime}|${signal.targetCode ?? ''}`
  const now = Date.now()
  if (now - lastAt < MIN_INTERVAL_MS && key === lastKey) return
  const positions = broker.positions.filter((p) => p.quantity > 0)
  const held = signal.targetCode ? positions.find((p) => p.symbol === signal.targetCode) : undefined
  const decision = !signal.targetCode ? '空仓等待' : held ? '持有目标' : '候选调仓'
  const row: EtfSentimentLog = {
    id: `sent-${now}-${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toISOString(),
    tradingDate: snapshot.tradingDate,
    marketStatus: snapshot.marketStatus,
    score: signal.score,
    stage: signal.stage,
    trend: signal.trend,
    risk: snapshot.sentiment.risk,
    confidence: snapshot.sentiment.confidence,
    regime: signal.regime,
    targetCode: signal.targetCode,
    targetName: signal.targetName,
    reason: signal.reason,
    decision,
    breadth: {
      rise: snapshot.breadth.rise,
      fall: snapshot.breadth.fall,
      limitUp: snapshot.breadth.limitUp,
      limitDown: snapshot.breadth.limitDown,
      amount: snapshot.breadth.amount,
      ratio: snapshot.breadth.ratio,
    },
    quotes: quotes.slice(0, 6).map((q) => ({ code: q.code, name: q.name, price: q.price, pct: q.pct, amount: q.amount })),
    account: broker.account ? { totalAsset: broker.account.totalAsset, cashAvailable: broker.account.cashAvailable, marketValue: broker.account.marketValue } : null,
    positions: positions.map((p) => ({ symbol: p.symbol, name: p.name, quantity: p.quantity, available: p.available })),
    source: input.source || 'T+0 ETF 情绪引擎',
    channel: 't0',
  }
  rows.unshift(row)
  rows = rows.slice(0, MAX)
  lastAt = now
  lastKey = key
  save()
}

export function getSentimentLog(limit = 100): EtfSentimentLog[] {
  return rows.slice(0, Math.max(1, Math.min(MAX, limit)))
}

function load(): EtfSentimentLog[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EtfSentimentLog[]
    return Array.isArray(raw) ? raw.slice(0, MAX) : []
  } catch {
    return []
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    atomicWriteJson(FILE, rows)
  } catch {
    // best effort
  }
}
