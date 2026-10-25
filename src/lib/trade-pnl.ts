import type { EtfPaperTrade } from '../../shared/types'

export interface TradeWithPnl extends EtfPaperTrade {
  entryPrice?: number | null
  realizedPnl?: number | null
  realizedPnlPct?: number | null
  reason?: string
}

export interface TradePnlSummary {
  realizedPnl: number
  fees: number
  count: number
  wins: number
  losses: number
  winRate: number
  rows: TradeWithPnl[]
}

interface Lot { qty: number; price: number; feePerShare: number }

/** FIFO P&L for today's journal trades, so rows show what each sale actually made/lost. */
export function enrichTradePnl(trades: EtfPaperTrade[]): TradePnlSummary {
  const lots = new Map<string, Lot[]>()
  const rows: TradeWithPnl[] = []
  const ordered = dedupeTrades(trades).sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  for (const trade of ordered) {
    if (trade.side === 'buy') {
      const fee = trade.fee ?? 0
      const list = lots.get(trade.code) ?? []
      list.push({ qty: trade.quantity, price: trade.price, feePerShare: trade.quantity ? fee / trade.quantity : 0 })
      lots.set(trade.code, list)
      rows.push({ ...trade })
      continue
    }
    let remaining = trade.quantity
    let cost = 0
    let buyFee = 0
    const list = lots.get(trade.code) ?? []
    while (remaining > 0 && list.length) {
      const lot = list[0]
      const take = Math.min(remaining, lot.qty)
      cost += take * lot.price
      buyFee += take * lot.feePerShare
      remaining -= take
      lot.qty -= take
      if (lot.qty <= 0) list.shift()
    }
    const sold = trade.quantity - remaining
    if (sold <= 0) { rows.push({ ...trade }); continue }
    const pnl = sold * trade.price - cost - buyFee - (trade.fee ?? 0)
    rows.push({
      ...trade,
      entryPrice: cost / sold,
      realizedPnl: round(pnl),
      realizedPnlPct: round((pnl / Math.max(1, cost)) * 100),
    })
  }
  const sells = rows.filter((r) => r.side === 'sell' && r.realizedPnl != null)
  const realizedPnl = round(sells.reduce((sum, r) => sum + (r.realizedPnl ?? 0), 0))
  const wins = sells.filter((r) => (r.realizedPnl ?? 0) > 0).length
  const losses = sells.filter((r) => (r.realizedPnl ?? 0) < 0).length
  const fees = round(rows.reduce((sum, r) => sum + (r.fee ?? 0), 0))
  return { rows, realizedPnl, fees, count: rows.length, wins, losses, winRate: sells.length ? round((wins / sells.length) * 100) : 0 }
}

function round(n: number) { return Math.round(n * 100) / 100 }


function dedupeTrades(trades: EtfPaperTrade[]): EtfPaperTrade[] {
  const seen = new Set<string>()
  const result: EtfPaperTrade[] = []
  for (const t of trades) {
    const order = /\b(\d{4,})\b/.exec(t.id)?.[1] ?? /·\s*(\d{4,})(?:\s*·|$)/.exec(t.note)?.[1]
    const key = order ? `${order}|${t.side}|${t.code}` : `${t.code}|${t.side}|${t.price}|${t.quantity}|${t.time.slice(0, 16)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(t)
  }
  return result
}
