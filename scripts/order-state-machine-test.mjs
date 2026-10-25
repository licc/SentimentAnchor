import assert from 'node:assert/strict'
import { checkEngineBudget, coordinatorUsage, effectiveEngineCapPct } from '../server/services/trading-coordinator.ts'
import { sanitizePositionValues } from '../server/services/position-sanity.ts'

const orders = [
  { orderId: 'A', symbol: '518880', name: '', side: '买入', price: 8.2, quantity: 100, filled: 100, status: '已成', time: '10:00:00' },
  { orderId: 'B', symbol: '300502', name: '', side: '买入', price: 200, quantity: 100, filled: 0, status: '已报', time: '10:01:00' },
]
import { findMatchingOrder } from '../server/services/broker-order-match.ts'
assert.equal(findMatchingOrder(orders, { symbol: '518880', side: 'buy', quantity: 100, price: 8.2, createdAt: '2026-10-23T02:00:00Z' })?.orderId, 'A')
assert.equal(findMatchingOrder(orders, { symbol: '518880', side: 'sell', quantity: 100, price: 8.2, createdAt: '2026-10-23T02:00:00Z' }), null)

const base = { totalAsset: 10_000, cashAvailable: 8_000, positions: [{ symbol: '518880', marketValue: 1_000 }] }
assert.equal(checkEngineBudget({ ...base, source: 't0_auto', symbol: '518880', price: 8.2, quantity: 400 }).passed, true)
assert.equal(checkEngineBudget({ ...base, source: 't0_auto', symbol: '518880', price: 8.2, quantity: 500 }).passed, false)
assert.equal(checkEngineBudget({ ...base, source: 't0_auto', symbol: '518880', price: 8.2, quantity: 400, pendingBuyNotional: 1000 }).passed, false)
assert.equal(effectiveEngineCapPct('t0'), 50)
assert.equal(effectiveEngineCapPct('t1'), 30)
assert.equal(checkEngineBudget({ ...base, source: 't1_auto', symbol: '300502', price: 10, quantity: 100 }).passed, true)
assert.equal(checkEngineBudget({ ...base, source: 't1_auto', symbol: '300502', price: 50, quantity: 100 }).passed, false)

const raw = [{ symbol: '518880', quantity: 100, costPrice: 8.98, lastPrice: 210, marketValue: 21000, pnl: 0, pnlPct: 0 }]
const sane = sanitizePositionValues(raw, [{ code: '518880', price: 8.21 }])
assert.equal(Math.round(sane.positions[0].marketValue * 100) / 100, 821)
const fallback = sanitizePositionValues(raw, [])
assert.equal(Math.round(fallback.positions[0].marketValue * 100) / 100, 898)
const usage = coordinatorUsage({ totalAsset: 4886, cashAvailable: 4065, positions: sane.positions })
assert.equal(Math.round(usage.t0.pct * 10) / 10, 16.8)
assert.ok(usage.t0.remaining > 1000)

console.log('order state machine tests passed')
