import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

export interface StrategyQuality {
  strategyId: string
  code: string
  days: number
  positiveRatio: number
  note: string
  updatedAt: string
}
const FILE = path.join(process.cwd(), 'data', 'strategy-quality.json')
let records: StrategyQuality[] = load()

export function recordStrategyQuality(q: Omit<StrategyQuality, 'updatedAt'>): StrategyQuality {
  const next: StrategyQuality = { ...q, updatedAt: new Date().toISOString() }
  records = [next, ...records.filter((r) => r.strategyId !== q.strategyId)].slice(0, 200)
  try { atomicWriteJson(FILE, records) } catch { /* best effort */ }
  return next
}

export function getStrategyQuality(id: string): StrategyQuality | null {
  return records.find((r) => r.strategyId === id) ?? null
}

export function assertStrategyQuality(id: string, force = false): void {
  if (force) return
  const q = getStrategyQuality(id)
  if (!q) throw new Error('启用前必须先在策略库运行参数稳健性测试')
  if (q.positiveRatio < 40) throw new Error(`参数稳健性 ${q.positiveRatio}% 低于 40% 门槛；如确认启用请使用强制启用`)
}

function load(): StrategyQuality[] {
  try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as StrategyQuality[]; return Array.isArray(raw) ? raw : [] } catch { return [] }
}
