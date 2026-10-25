import fs from 'node:fs'
import path from 'node:path'
import type { EtfExecutionFactors, EtfExecutionRecord, EtfExecutionStatus } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { enrichExecutionPnl } from './execution-pnl.js'
import { recordFill } from './ledger.js'
import { markIntent } from './order-intent.js'

const FILE = path.join(process.cwd(), 'data', 'etf-executions.json')
let records: EtfExecutionRecord[] = load()

export function createExecution(input: {
  mode: 'auto' | 'manual'
  side: 'buy' | 'sell'
  symbol: string
  name: string
  price: number
  quantity: number
  positionBefore?: number | null
  factors: EtfExecutionFactors
}): EtfExecutionRecord {
  const now = new Date().toISOString()
  const record: EtfExecutionRecord = {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    mode: input.mode,
    side: input.side,
    symbol: input.symbol,
    name: input.name,
    price: input.price,
    quantity: input.quantity,
    amount: input.price * input.quantity,
  fee: 0,
  cashAfter: null,
  positionBefore: input.positionBefore ?? null,
  positionAfter: null,
    status: 'submitting',
    orderId: null,
    filled: 0,
    brokerStatus: '',
    message: '',
    resolution: '已提交，等待接口回执',
    factors: input.factors,
  }
  records.unshift(record)
  records = records.slice(0, 200)
  save()
  return record
}

export function updateExecution(id: string, patch: Partial<Omit<EtfExecutionRecord, 'id' | 'factors' | 'createdAt'>>): EtfExecutionRecord | null {
  const idx = records.findIndex((r) => r.id === id)
  if (idx < 0) return null
  records[idx] = { ...records[idx], ...patch, updatedAt: new Date().toISOString() }
  save()
  if (records[idx].status === 'filled') {
    const r = records[idx]
    recordFill({ id: r.id, clientOrderId: r.id, brokerOrderId: r.orderId, symbol: r.symbol, side: r.side, price: r.price, quantity: r.filled || r.quantity, fee: r.fee || 0, filledAt: r.updatedAt })
    markIntent(r.id, { status: 'filled', orderId: r.orderId, error: null })
  }
  return records[idx]
}

export function getExecutions(limit = 50): EtfExecutionRecord[] {
  return enrichExecutionPnl(records).slice(0, Math.max(1, Math.min(200, limit)))
}

function load(): EtfExecutionRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EtfExecutionRecord[]
    return Array.isArray(raw) ? raw.slice(0, 200) : []
  } catch {
    return []
  }
}

function save() {
  try {
    atomicWriteJson(FILE, records)
  } catch {
    // audit persistence is best-effort
  }
}
