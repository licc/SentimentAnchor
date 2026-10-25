import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

export interface TradePlan {
  id: string
  createdAt: string
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  stopPrice: number | null
  targetPrice: number | null
  quantity: number
  riskAmount: number | null
  reason: string
  status: 'open' | 'closed'
  orderId: string | null
  review: string | null
  reviewAt: string | null
}
const FILE = path.join(process.cwd(), 'data', 'trade-plans.json')
let plans: TradePlan[] = load()

export function listTradePlans(limit = 100): TradePlan[] { return plans.slice(0, limit).map((p) => ({ ...p })) }
export function createTradePlan(input: { symbol: string; side: 'buy' | 'sell'; entryPrice: number; stopPrice?: number | null; targetPrice?: number | null; quantity: number; riskAmount?: number | null; reason: string; orderId?: string | null }): TradePlan {
  const plan: TradePlan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    symbol: input.symbol, side: input.side, entryPrice: input.entryPrice,
    stopPrice: input.stopPrice ?? null, targetPrice: input.targetPrice ?? null,
    quantity: input.quantity, riskAmount: input.riskAmount ?? null,
    reason: input.reason, status: 'open', orderId: input.orderId ?? null,
    review: null, reviewAt: null,
  }
  plans.unshift(plan)
  plans = plans.slice(0, 500)
  save()
  return { ...plan }
}
export function reviewTradePlan(id: string, review: string): TradePlan | null {
  const plan = plans.find((p) => p.id === id)
  if (!plan) return null
  plan.review = review.slice(0, 2000)
  plan.reviewAt = new Date().toISOString()
  plan.status = 'closed'
  save()
  return { ...plan }
}
function load(): TradePlan[] { try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as TradePlan[]; return Array.isArray(raw) ? raw : [] } catch { return [] } }
function save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, plans) } catch { /* best effort */ } }
