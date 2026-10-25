import type { EtfBrokerStatus, EtfQuote } from '../../shared/types.js'

export function sanitizePositionValues<T extends { symbol: string; quantity: number; costPrice: number; lastPrice: number; marketValue: number; pnl: number; pnlPct: number }>(positions: T[], quotes: Array<Pick<EtfQuote, 'code' | 'price'>>): { positions: T[]; warnings: string[] } {
  const warnings: string[] = []
  const next = positions.map((p) => {
    const quote = quotes.find((q) => q.code === p.symbol)
    if (!quote?.price || !p.lastPrice) {
      if (p.costPrice > 0 && (p.lastPrice > p.costPrice * 2 || p.marketValue > p.costPrice * p.quantity * 2)) {
        const marketValue = p.costPrice * p.quantity
        warnings.push(`${p.symbol} 券商持仓价 ${p.lastPrice.toFixed(3)} 与成本 ${p.costPrice.toFixed(3)} 明显偏离，行情不可用时按成本校正`)
        return { ...p, lastPrice: p.costPrice, marketValue, pnl: 0, pnlPct: 0 }
      }
      return p
    }
    const deviation = Math.abs(quote.price - p.lastPrice) / p.lastPrice
    if (deviation < 0.1) return p
    const cost = p.costPrice > 0 ? p.costPrice : quote.price
    const marketValue = quote.price * p.quantity
    warnings.push(`${p.symbol} 券商持仓价 ${p.lastPrice.toFixed(3)} 与行情 ${quote.price.toFixed(3)} 偏离 ${(deviation * 100).toFixed(1)}%，已用行情校正`)
    return { ...p, lastPrice: quote.price, marketValue, pnl: (quote.price - cost) * p.quantity, pnlPct: cost > 0 ? ((quote.price - cost) / cost) * 100 : p.pnlPct }
  })
  return { positions: next, warnings }
}

export function clientPositionValue(broker: Pick<EtfBrokerStatus, 'positions'>): number {
  return broker.positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)
}
