import { getExecutions } from './etf-execution.js'
import { getToday } from './etf-journal.js'

export function portfolioAnalytics() {
  const executions = getExecutions(200)
  const sells = executions.filter((e) => e.side === 'sell' && e.realizedPnl != null)
  const wins = sells.filter((e) => (e.realizedPnl ?? 0) > 0)
  const losses = sells.filter((e) => (e.realizedPnl ?? 0) < 0)
  const winAmount = wins.reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0)
  const lossAmount = Math.abs(losses.reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0))
  const bySymbol = new Map<string, { symbol: string; realizedPnl: number; trades: number; fees: number }>()
  for (const e of executions) {
    const row = bySymbol.get(e.symbol) ?? { symbol: e.symbol, realizedPnl: 0, trades: 0, fees: 0 }
    row.trades += 1
    row.fees += e.fee ?? 0
    row.realizedPnl += e.realizedPnl ?? 0
    bySymbol.set(e.symbol, row)
  }
  return {
    generatedAt: new Date().toISOString(),
    today: getToday()?.date ?? null,
    trades: executions.length,
    closedTrades: sells.length,
    realizedPnl: round2(sells.reduce((sum, e) => sum + (e.realizedPnl ?? 0), 0)),
    fees: round2(executions.reduce((sum, e) => sum + (e.fee ?? 0), 0)),
    winRate: sells.length ? round2((wins.length / sells.length) * 100) : 0,
    profitFactor: lossAmount ? round2(winAmount / lossAmount) : winAmount > 0 ? 99 : 0,
    avgWin: wins.length ? round2(winAmount / wins.length) : 0,
    avgLoss: losses.length ? round2(lossAmount / losses.length) : 0,
    symbols: [...bySymbol.values()].map((s) => ({ ...s, realizedPnl: round2(s.realizedPnl), fees: round2(s.fees) })).sort((a, b) => b.realizedPnl - a.realizedPnl).slice(0, 20),
  }
}
function round2(n: number) { return Math.round(n * 100) / 100 }
