import { getExecutions } from './etf-execution.js'
import { getToday } from './etf-journal.js'

export interface PositionForPnl {
  symbol: string
  name: string
  quantity: number
  lastPrice: number
  costPrice: number
  pnlPct: number
}

/**
 * Prefer the system's own filled entry price over broker cost, which can lag
 * after rapid buy/sell cycles. Fall back to broker pnl only when the system
 * cannot identify a matching entry.
 */
export function effectivePositionPnl(pos: PositionForPnl): { pnlPct: number; entryPrice: number | null; source: 'system' | 'broker' } {
  const candidates: Array<{ time: number; price: number; quantity: number }> = []
  for (const t of getToday()?.trades ?? []) {
    if (t.side === 'buy' && t.code === pos.symbol) candidates.push({ time: Date.parse(t.time), price: t.price, quantity: t.quantity })
  }
  for (const e of getExecutions(200)) {
    if (e.side === 'buy' && e.symbol === pos.symbol && e.status === 'filled') {
      candidates.push({ time: Date.parse(e.createdAt), price: e.price, quantity: e.filled || e.quantity })
    }
  }
  candidates.sort((a, b) => b.time - a.time)
  const latest = candidates[0]
  if (latest && latest.price > 0 && pos.lastPrice > 0 && latest.quantity <= pos.quantity) {
    return { pnlPct: ((pos.lastPrice - latest.price) / latest.price) * 100, entryPrice: latest.price, source: 'system' }
  }
  return { pnlPct: pos.pnlPct, entryPrice: pos.costPrice > 0 ? pos.costPrice : null, source: 'broker' }
}
