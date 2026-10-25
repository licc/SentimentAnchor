import { fetchText } from './http.js'
import type { AmountBaseline } from './eastmoney.js'

interface ThsRow {
  date: string
  close: number
  volume: number
  amount: number
}

export async function fetchThsAmountBaseline(today: string): Promise<AmountBaseline> {
  const started = Date.now()
  const defs = [
    { key: 'zs_1A0001' },
    { key: 'zs_399001' },
  ]
  const results = await Promise.all(
    defs.map(async (def) => {
      const res = await fetchText(`https://d.10jqka.com.cn/v6/line/${def.key}/01/last.js`, {
        timeoutMs: 9_000,
        retries: 2,
        headers: { Referer: 'https://stockpage.10jqka.com.cn/' },
      })
      const start = res.text.indexOf('(')
      const end = res.text.lastIndexOf(')')
      if (start < 0 || end <= start) throw new Error(`invalid THS ${def.key}`)
      const json = JSON.parse(res.text.slice(start + 1, end)) as { data?: string }
      if (!json.data) throw new Error(`empty THS ${def.key}`)
      return json.data
        .split(';')
        .map((line): ThsRow | null => {
          const f = line.split(',')
          if (f.length < 7) return null
          return {
            date: f[0].length === 8 ? `${f[0].slice(0, 4)}-${f[0].slice(4, 6)}-${f[0].slice(6, 8)}` : f[0],
            close: Number(f[4]) || 0,
            volume: Number(f[5]) || 0,
            amount: Number(f[6]) || 0,
          }
        })
        .filter((r): r is ThsRow => r !== null && r.amount > 0)
    }),
  )
  const dates = results.flatMap((rows) => rows.map((r) => r.date))
  const allDates = [...new Set(dates)].sort()
  if (allDates.length < 2) throw new Error('THS baseline dates insufficient')
  // One exchange index can lag by one session; always use the session *before* today.
  const priorDates = allDates.filter((d) => d < today).slice(-5)
  if (priorDates.length === 0) throw new Error('THS previous dates missing')
  let avg5Amount = 0
  for (const date of priorDates) {
    avg5Amount += results.reduce((acc, rows) => acc + (rows.find((r) => r.date === date)?.amount ?? 0), 0)
  }
  const prevDate = priorDates[priorDates.length - 1]
  const prevAmount = results.reduce((acc, rows) => acc + (rows.find((r) => r.date === prevDate)?.amount ?? 0), 0)
  const lastAvailable = allDates[allDates.length - 1] ?? today
  if (!prevAmount) throw new Error('THS previous amount missing')
  return {
    tradingDate: lastAvailable,
    prevAmount,
    avg5Amount: avg5Amount / Math.max(1, priorDates.length),
    at: Date.now(),
    latencyMs: Date.now() - started,
  }
}
