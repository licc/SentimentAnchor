import assert from 'node:assert/strict'
import { findMatchingOrder } from '../server/services/broker-order-match.ts'
import { enrichTradePnl } from '../src/lib/trade-pnl.ts'
import { parseT0Strategy } from '../server/services/t0-strategy.ts'
import { limitPctFor } from '../server/services/quant-backtest.ts'
import { adjustBarsForActions } from '../server/services/corporate-actions.ts'

const orders = [
  { orderId: '6204', symbol: '518880', name: '', side: '买入', price: 8.179, quantity: 100, filled: 100, status: '已成', time: '10:07:51' },
  { orderId: '1019', symbol: '518880', name: '', side: '卖出', price: 8.202, quantity: 200, filled: 200, status: '已成', time: '09:30:46' },
]
assert.equal(findMatchingOrder(orders, { symbol: '518880', side: 'buy', quantity: 100, price: 8.18, createdAt: '2026-10-23T02:07:30Z' })?.orderId, '6204')
assert.equal(findMatchingOrder(orders, { symbol: '518880', side: 'buy', quantity: 200, price: 8.18, createdAt: '2026-10-23T02:07:30Z' }), null)
assert.equal(findMatchingOrder(orders, { symbol: '518880', side: 'sell', quantity: 200, price: 8.2, createdAt: '2026-10-23T01:30:00Z' })?.orderId, '1019')

const trades = [
  { id: '6204', time: '2026-10-23T02:07:30Z', code: '518880', name: '黄金ETF', side: 'buy', price: 8.179, quantity: 100, amount: 817.9, fee: 5, note: '买入' },
  { id: '6562', time: '2026-10-23T02:11:56Z', code: '518880', name: '黄金ETF', side: 'sell', price: 8.186, quantity: 100, amount: 818.6, fee: 5, note: '卖出' },
  { id: 'recon-6562', time: '2026-10-23T02:12:10Z', code: '518880', name: '黄金ETF', side: 'sell', price: 8.186, quantity: 100, amount: 818.6, fee: 5, note: '后台确认 6562' },
]
const pnl = enrichTradePnl(trades)
assert.equal(pnl.rows.length, 2, 'duplicate sell must be deduped')
assert.equal(pnl.realizedPnl, -9.3)
assert.equal(pnl.fees, 10)
assert.equal(pnl.wins, 0)
assert.equal(pnl.losses, 1)

const t0 = parseT0Strategy('# 测试\n进攻分数 >= 60\n防守分数 < 45\n进攻仓位 40%\n防守仓位 20%', { stages: ['修复'], riskOnScore: 50, riskOffScore: 40, riskOnPositionPct: 0.5, riskOffPositionPct: 0.3, allowRisk: true })
assert.equal(t0.riskOnScore, 60)
assert.equal(t0.riskOffScore, 45)
assert.equal(t0.riskOnPositionPct, 0.4)
assert.equal(t0.riskOffPositionPct, 0.2)

const divBars = [
  { date: '2026-05-28', open: 10, high: 11, low: 9, close: 10, volume: 100 },
  { date: '2026-05-29', open: 9.8, high: 10, low: 9.7, close: 9.9, volume: 120 },
]
const divAdjusted = adjustBarsForActions(divBars, [{ symbol: '600000', exDate: '2026-05-29', cashPerShare: 0.2, shareRatio: 0, description: 'test' }])
assert.equal(divAdjusted.applied, 1)
assert.equal(divAdjusted.bars[0].close, 9.8)
assert.equal(divAdjusted.bars[1].close, 9.9)
assert.equal(limitPctFor('300502'), 19.5)
assert.equal(limitPctFor('600000'), 9.5)
assert.equal(limitPctFor('830000'), 29.5)

console.log('core tests passed')
