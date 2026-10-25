/**
 * Regression check: anchors must be selected from the supplied market data,
 * never from a hardcoded stock list. The synthetic names must surface as the
 * "空间龙 / 次高标 / 换手龙 / 跌停锚" after buildSnapshot().
 */
import assert from 'node:assert/strict'
import { buildSnapshot } from '../server/services/analysis.ts'

const pool = (symbol, name, days, pct, first, theme) => ({
  symbol, stock_chi_name: name, price: 10, change_percent: pct,
  first_limit_up: first, first_break_limit_up: 0, last_break_limit_up: 0,
  last_limit_up: first, first_limit_down: 0, last_limit_down: 0,
  break_limit_up_times: 0, break_limit_down_times: 0,
  limit_up_days: days, limit_down_days: 0, turnover_ratio: 0.1,
  buy_lock_volume_ratio: 0.01, sell_lock_volume_ratio: 0, total_capital: 1e9,
  non_restricted_capital: 8e8, volume_bias_ratio: 1, is_new_stock: false,
  stock_type: 0, listed_date: 0, nearly_new_acc_pcp: 0, new_stock_limit_up_days: 0,
  yesterday_limit_up_days: 0, yesterday_limit_down_days: 0,
  m_days_n_boards_boards: 0, m_days_n_boards_days: 0,
  surge_reason: { symbol, stock_reason: '', related_plates: [{ plate_id: 1, plate_name: theme, plate_reason: '' }] },
  limit_timeline: { items: [] },
})

const down = pool('600004.SS', '测试跌停', 0, -0.1, 1792459500, '测试板块')
down.first_limit_down = 1792459500
down.limit_down_days = 1

const now = 1792500000000
const snapshot = buildSnapshot({
  now,
  indices: [{ code: '000001', name: '上证指数', price: 3000, change: 10, pct: 0.3, open: 2990, high: 3010, low: 2980, prevClose: 2990, amount: 1e12, volume: 1, date: '2026-10-20', time: '15:00:00', tone: 'up' }],
  breadthPoints: [
    { rise_count: 3000, fall_count: 1200, limit_up_count: 3, limit_down_count: 1, timestamp: now / 1000 - 60 },
    { rise_count: 3000, fall_count: 1200, limit_up_count: 3, limit_down_count: 1, timestamp: now / 1000 },
  ],
  limitUpsRaw: [
    pool('600001.SS', '测试甲', 2, 0.1, 1792459500, '测试板块'),
    pool('600002.SS', '测试乙', 1, 0.1, 1792460000, '测试板块'),
    pool('600003.SS', '测试丙', 1, 0.1, 1792461000, '测试板块'),
  ],
  limitDownsRaw: [down],
  topRows: [], bottomRows: [], industry: [], concept: [], quotes: {},
  previousAmount: 9e11, avg5Amount: 9.5e11, watchlistCodes: [], sources: [], refreshMs: 10_000, latencyMs: 1,
})

const names = Object.fromEntries(snapshot.anchors.map((a) => [a.role, a.stock.name]))
assert.equal(names['空间龙'], '测试甲')
assert.equal(names['次高标'], '测试乙')
assert.equal(names['换手龙'], '测试丙')
assert.equal(names['跌停锚'], '测试跌停')
console.log('dynamic-anchor check passed:', names)
