import type { BrokerOrder } from './etf-broker.js'

export interface MatchInput {
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  createdAt: string
}

/** Match an order whose POST response was lost, using broker order fields. */
export function findMatchingOrder(orders: BrokerOrder[], input: MatchInput, maxAgeMinutes = 10): BrokerOrder | null {
  const isBuy = (s: string) => /买|buy/i.test(s)
  const wantedBuy = input.side === 'buy'
  const created = shanghaiMinutes(new Date(input.createdAt))
  return orders
    .filter((o) => o.symbol === input.symbol && o.quantity === input.quantity && o.status && !/拒绝|废单/.test(o.status))
    .filter((o) => (wantedBuy ? isBuy(o.side) : !isBuy(o.side)))
    .filter((o) => Math.abs(o.price - input.price) <= Math.max(0.02, input.price * 0.015))
    .filter((o) => {
      if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(o.time)) return true
      const t = shanghaiMinutes(new Date(`2000-01-01T${o.time.length === 5 ? `${o.time}:00` : o.time}+08:00`))
      return Math.abs(t - created) <= maxAgeMinutes
    })
    .sort((a, b) => b.time.localeCompare(a.time))[0] ?? null
}

function shanghaiMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
}
