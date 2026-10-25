import type { EtfExecutionRecord } from '../../shared/types.js'

interface Lot { quantity: number; price: number; feePerShare: number }

/** FIFO realized P&L for filled buy/sell execution records. */
export function enrichExecutionPnl(records: EtfExecutionRecord[]): EtfExecutionRecord[] {
  const lots = new Map<string, Lot[]>()
  const enriched = new Map<string, EtfExecutionRecord>()
  const ordered = [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  for (const record of ordered) {
    if (record.status !== 'filled') { enriched.set(record.id, { ...record }); continue }
    const qty = record.filled || record.quantity
    if (qty <= 0) { enriched.set(record.id, { ...record }); continue }
    if (record.side === 'buy') {
      const fee = record.fee || 0
      const list = lots.get(record.symbol) ?? []
      list.push({ quantity: qty, price: record.price, feePerShare: fee / qty })
      lots.set(record.symbol, list)
      enriched.set(record.id, { ...record })
      continue
    }
    let remaining = qty
    let cost = 0
    let buyFee = 0
    const list = lots.get(record.symbol) ?? []
    while (remaining > 0 && list.length > 0) {
      const lot = list[0]
      const take = Math.min(remaining, lot.quantity)
      cost += take * lot.price
      buyFee += take * lot.feePerShare
      remaining -= take
      lot.quantity -= take
      if (lot.quantity <= 0) list.shift()
    }
    const sold = qty - remaining
    if (sold <= 0) { enriched.set(record.id, { ...record }); continue }
    const proceeds = sold * record.price
    const pnl = proceeds - cost - buyFee - (record.fee || 0)
    enriched.set(record.id, {
      ...record,
      entryPrice: cost / sold,
      realizedPnl: round(pnl),
      realizedPnlPct: round((pnl / Math.max(1, cost)) * 100),
    })
  }
  return records.map((r) => enriched.get(r.id) ?? r)
}

function round(n: number) { return Math.round(n * 100) / 100 }
