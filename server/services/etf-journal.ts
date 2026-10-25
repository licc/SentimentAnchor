import fs from 'node:fs'
import path from 'node:path'
import type { EtfDailyRecord, EtfSignal, EtfSignalRecord, EtfPaperTrade } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'etf-journal.json')
let days: Record<string, EtfDailyRecord> = load()

export function ensureToday(equity: number, mode: string): EtfDailyRecord {
  const date = shanghaiDate()
  const normalized = mode === 'live' ? 'live' : 'paper'
  const existing = days[date]
  if (existing && existing.mode === normalized) {
    existing.equity = equity
    existing.pnl = equity - existing.startEquity
    existing.pnlPct = ((equity - existing.startEquity) / existing.startEquity) * 100
    existing.updatedAt = new Date().toISOString()
    save()
    return existing
  }
  const record: EtfDailyRecord = {
    date,
    mode: normalized,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startEquity: equity,
    equity,
    pnl: 0,
    pnlPct: 0,
    trades: [],
    signals: [],
    note: mode === 'live' ? 'LIVE' : 'DRY RUN / 本地模拟',
  }
  days[date] = record
  save()
  return record
}

export function recordSignal(signal: EtfSignal, equity: number, mode = 'paper'): EtfDailyRecord {
  const date = shanghaiDate()
  const normalized = mode === 'live' ? 'live' : 'paper'
  const record = days[date]?.mode === normalized ? days[date] : ensureToday(equity, normalized)
  const last = record.signals[0]
  if (last && last.regime === signal.regime && last.targetCode === signal.targetCode) {
    record.equity = equity
    record.pnl = equity - record.startEquity
    record.pnlPct = ((equity - record.startEquity) / record.startEquity) * 100
    record.updatedAt = new Date().toISOString()
    save()
    return record
  }
  const entry: EtfSignalRecord = {
    id: `s-${Date.now()}`,
    time: new Date().toISOString(),
    regime: signal.regime,
    targetCode: signal.targetCode,
    targetName: signal.targetName,
    reason: signal.reason,
    score: signal.score,
    stage: signal.stage,
    trend: signal.trend,
  }
  record.signals.unshift(entry)
  record.signals = record.signals.slice(0, 60)
  record.equity = equity
  record.pnl = equity - record.startEquity
  record.pnlPct = ((equity - record.startEquity) / record.startEquity) * 100
  record.updatedAt = new Date().toISOString()
  save()
  return record
}

export function recordTrade(trade: EtfPaperTrade, equity: number, mode = 'paper'): EtfDailyRecord {
  const date = shanghaiDate()
  const normalized = mode === 'live' ? 'live' : 'paper'
  const record = days[date]?.mode === normalized ? days[date] : ensureToday(equity, normalized)
  if (isDuplicateTrade(record.trades, trade)) return record
  record.trades.unshift(trade)
  record.trades = record.trades.slice(0, 30)
  record.equity = equity
  record.pnl = equity - record.startEquity
  record.pnlPct = ((equity - record.startEquity) / record.startEquity) * 100
  record.updatedAt = new Date().toISOString()
  save()
  return record
}

export function getToday(): EtfDailyRecord | null {
  return days[shanghaiDate()] ?? null
}

export function getHistory(limit = 30): EtfDailyRecord[] {
  return Object.values(days)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

export function resetToday(equity: number, mode: string): EtfDailyRecord {
  const date = shanghaiDate()
  const record: EtfDailyRecord = {
    date,
    mode: mode === 'live' ? 'live' : 'paper',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startEquity: equity,
    equity,
    pnl: 0,
    pnlPct: 0,
    trades: [],
    signals: [],
    note: mode === 'live' ? 'LIVE' : 'DRY RUN / 本地模拟',
  }
  days[date] = record
  save()
  return record
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function load(): Record<string, EtfDailyRecord> {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, EtfDailyRecord>
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function save() {
  try {
    atomicWriteJson(FILE, days)
  } catch {
    // journal persistence is best-effort
  }
}


function isDuplicateTrade(existing: EtfPaperTrade[], trade: EtfPaperTrade): boolean {
  const order = /\b(\d{4,})\b/.exec(trade.id)?.[1] ?? /·\s*(\d{4,})(?:\s*·|$)/.exec(trade.note)?.[1]
  if (!order) return existing.some((t) => t.id === trade.id)
  return existing.some((t) => {
    const o = /\b(\d{4,})\b/.exec(t.id)?.[1] ?? /·\s*(\d{4,})(?:\s*·|$)/.exec(t.note)?.[1]
    return o === order && t.side === trade.side && t.code === trade.code
  })
}
