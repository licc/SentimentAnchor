import fs from 'node:fs'
import path from 'node:path'
import type { EtfOrderIntent } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { fetchEtfOrders, isFilledStatus, isRejectedStatus } from './etf-broker.js'
import { findMatchingOrder } from './broker-order-match.js'
import { recordOrderIntent } from './ledger.js'

const FILE = path.join(process.cwd(), 'data', 'order-intents.json')
let intents: EtfOrderIntent[] = load()

export function getOrderIntents(limit = 100): EtfOrderIntent[] {
  return intents.slice(0, limit).map((x) => ({ ...x }))
}

export function createIntent(input: { clientOrderId: string; symbol: string; side: 'buy' | 'sell'; price: number; quantity: number; source: string }): EtfOrderIntent {
  const existing = intents.find((x) => x.clientOrderId === input.clientOrderId)
  if (existing) throw new Error(`重复订单意图：${input.clientOrderId}（${existing.status}）`)
  const now = new Date().toISOString()
  const intent: EtfOrderIntent = {
    clientOrderId: input.clientOrderId, symbol: input.symbol, side: input.side,
    price: input.price, quantity: input.quantity, source: input.source,
    status: 'pending', orderId: null, createdAt: now, updatedAt: now, error: null,
  }
  intents.unshift(intent)
  intents = intents.slice(0, 500)
  save()
  recordOrderIntent(intent)
  return { ...intent }
}

export function markIntent(clientOrderId: string, patch: Partial<EtfOrderIntent>): EtfOrderIntent | null {
  const intent = intents.find((x) => x.clientOrderId === clientOrderId)
  if (!intent) return null
  Object.assign(intent, patch, { updatedAt: new Date().toISOString() })
  save()
  recordOrderIntent(intent)
  return { ...intent }
}

export function activeIntentCount(): number {
  return intents.filter((x) => x.status === 'pending' || x.status === 'submitted' || x.status === 'unknown').length
}

/** Do not send the same clientOrderId twice after a crash or timeout. */
export function assertIntentCanSend(clientOrderId: string): void {
  const existing = intents.find((x) => x.clientOrderId === clientOrderId)
  if (!existing) return
  if (existing.status === 'rejected' || existing.status === 'cancelled') return
  throw new Error(`订单意图 ${clientOrderId} 已存在（${existing.status}），拒绝重复发送`)
}

export async function reconcileOrderIntents(): Promise<{ checked: number; updated: number; unknown: number }> {
  const pending = intents.filter((x) => x.status === 'pending' || x.status === 'submitted' || x.status === 'unknown')
  if (pending.length === 0) return { checked: 0, updated: 0, unknown: 0 }
  const orders = await fetchEtfOrders(true).catch(() => [])
  let updated = 0
  let unknown = 0
  for (const intent of pending) {
    const matched = findMatchingOrder(orders, { symbol: intent.symbol, side: intent.side, quantity: intent.quantity, price: intent.price, createdAt: intent.createdAt })
    if (!matched) {
      markIntent(intent.clientOrderId, { status: 'unknown', error: '启动对账未匹配到券商委托' })
      unknown++
      continue
    }
    const status = isFilledStatus(matched.status) ? 'filled' : isRejectedStatus(matched.status) ? 'rejected' : 'submitted'
    markIntent(intent.clientOrderId, { status, orderId: matched.orderId, error: status === 'submitted' ? '已匹配，等待成交' : null })
    updated++
  }
  return { checked: pending.length, updated, unknown }
}

function load(): EtfOrderIntent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EtfOrderIntent[]
    return Array.isArray(raw) ? raw.slice(0, 500) : []
  } catch { return [] }
}

function save() {
  try { atomicWriteJson(FILE, intents) } catch { /* best effort */ }
}
