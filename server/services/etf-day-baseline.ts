import fs from 'node:fs'
import path from 'node:path'
import type { EtfBrokerStatus } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'etf-day-baselines.json')
export interface DayBaseline {
  date: string
  mode: 'live' | 'paper'
  startEquity: number
  startPositions: Array<{ symbol: string; name: string; quantity: number; available: number }>
  createdAt: string
}

let rows: Record<string, DayBaseline> = load()

/** Immutable first observation of the trading day. Never overwrite an existing date. */
export function ensureDayBaseline(input: {
  equity: number
  mode: 'live' | 'paper'
  positions: EtfBrokerStatus['positions']
  existingStart?: number | null
}): DayBaseline {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (rows[date]) return rows[date]
  const baseline: DayBaseline = {
    date,
    mode: input.mode,
    startEquity: input.existingStart && input.existingStart > 0 ? input.existingStart : input.equity,
    startPositions: input.positions.map((p) => ({ symbol: p.symbol, name: p.name, quantity: p.quantity, available: p.available })),
    createdAt: new Date().toISOString(),
  }
  rows[date] = baseline
  save()
  return baseline
}

export function getDayBaseline(): DayBaseline | null {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return rows[date] ?? null
}

function load(): Record<string, DayBaseline> {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, DayBaseline>
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function save() {
  try {
    atomicWriteJson(FILE, rows)
  } catch {
    // best effort
  }
}
