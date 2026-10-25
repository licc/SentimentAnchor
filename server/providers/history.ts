import { prefixFor } from './sina.js'

export interface DailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Daily K-line from the same public quote source used by the dashboard. */
export async function fetchDailyBars(code: string, days = 180): Promise<DailyBar[]> {
  const symbol = prefixFor(code)
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${Math.max(60, days)}`
  const res = await fetch(url, { headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`历史行情 HTTP ${res.status}`)
  const raw = await res.json() as Array<{ day: string; open: string; high: string; low: string; close: string; volume: string }>
  if (!Array.isArray(raw)) throw new Error('历史行情格式错误')
  return raw.map((b) => ({
    date: b.day.slice(0, 10),
    open: Number(b.open) || 0,
    high: Number(b.high) || 0,
    low: Number(b.low) || 0,
    close: Number(b.close) || 0,
    volume: Number(b.volume) || 0,
  })).filter((b) => b.close > 0)
}
