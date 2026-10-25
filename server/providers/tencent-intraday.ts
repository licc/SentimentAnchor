import { prefixFor } from './sina.js'

export interface IntradayBar { time: string; price: number; vwap: number; volume: number }
export interface IntradaySeries {
  symbol: string
  name: string
  date: string
  prevClose: number
  bars: IntradayBar[]
  unit: number
  medianVolume: number
  partial: boolean
}

interface RawDay { date: string; prec?: number | string; data?: string[] }

/** Main board / ChiNext / STAR board price limit. */
export function boardLimitPct(symbol: string): number {
  return (symbol.startsWith('688') || symbol.startsWith('300') || symbol.startsWith('301')) ? 0.20 : 0.10
}

function shanghaiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).replace(/-/g, '')
}

async function fetchDays(symbol: string): Promise<RawDay[]> {
  const code = prefixFor(symbol)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/day/query?code=${encodeURIComponent(code)}`
  const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`分时接口 HTTP ${res.status}`)
  const json = await res.json() as { data?: Record<string, { data?: RawDay[] }> }
  const days = json.data?.[code]?.data
  if (!Array.isArray(days) || !days.length) throw new Error('分时数据为空')
  return days
}

/**
 * Parse one session, rejecting bad data rather than charting it.
 * The shqx design is deliberate: unit adaptivity first, then a hard gate.
 */
function parseDay(symbol: string, day: RawDay, minBars: number): IntradaySeries {
  const prevClose = Number(day.prec)
  if (!Number.isFinite(prevClose) || prevClose <= 0) throw new Error(`${day.date} 缺少昨收，拒绝出图`)
  const rows = (day.data ?? []).map((line) => {
    const p = line.trim().split(/\s+/)
    return { time: String(p[0] ?? ''), price: Number(p[1]) || 0, cv: Number(p[2]) || 0, ca: Number(p[3]) || 0 }
  }).filter((b) => /^\d{4}$/.test(b.time) && b.price > 0 && b.cv > 0 && ((b.time >= '0930' && b.time <= '1130') || (b.time >= '1300' && b.time <= '1500')))
  if (rows.length < minBars) throw new Error(`${day.date} 分时只有 ${rows.length} 根，少于 ${minBars} 根`)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].time <= rows[i - 1].time) throw new Error(`${day.date} 分时时间不递增：${rows[i - 1].time} → ${rows[i].time}`)
    if (rows[i].cv < rows[i - 1].cv) throw new Error(`${day.date} 累计成交量回退`)
  }
  const prices = rows.map((b) => b.price)
  const lo = Math.min(...prices), hi = Math.max(...prices)
  const fit = (unit: number) => rows.filter((b) => { const v = b.ca / (b.cv * unit); return v >= lo * 0.95 && v <= hi * 1.05 }).length / rows.length
  const unit = fit(100) >= fit(1) ? 100 : 1
  const vwaps = rows.map((b) => b.ca / (b.cv * unit))
  const bad = vwaps.filter((v) => v < lo * 0.97 || v > hi * 1.03).length
  if (bad) throw new Error(`${day.date} 均价线越界 ${bad}/${rows.length} 根，拒绝出图`)
  const lim = boardLimitPct(symbol)
  if (prevClose < lo * (1 - lim) || prevClose > hi * (1 + lim)) throw new Error(`${day.date} 昨收 ${prevClose} 超出 ${(lim * 100).toFixed(0)}% 合理区间`)
  const volumes = rows.map((b, i) => i === 0 ? b.cv : Math.max(0, b.cv - rows[i - 1].cv))
  const live = volumes.slice(1).filter((v) => v > 0).sort((a, b) => a - b)
  if (!live.length) throw new Error(`${day.date} 全天零成交，无法计算中位量`)
  const median = live[Math.floor(live.length / 2)]
  const partial = day.date === shanghaiToday()
  return {
    symbol, name: symbol, date: day.date, prevClose,
    bars: rows.map((b, i) => ({ time: `${b.time.slice(0, 2)}:${b.time.slice(2)}`, price: b.price, vwap: vwaps[i], volume: volumes[i] })),
    unit, medianVolume: median, partial,
  }
}

/** Current (or requested) session. A live partial session is allowed; a closed session must be complete. */
export async function fetchTencentIntraday(symbol: string, date?: string): Promise<IntradaySeries> {
  const days = [...await fetchDays(symbol)].sort((a, b) => a.date.localeCompare(b.date))
  const wanted = date?.replace(/-/g, '')
  const day = wanted ? days.find((d) => d.date === wanted) : days.at(-1)
  if (!day) throw new Error(`分时数据缺少 ${date}`)
  const minBars = day.date === shanghaiToday() ? 2 : 200
  return parseDay(symbol, day, minBars)
}

/** Closed sessions only; partial/bad days are skipped instead of silently charted. */
export async function fetchTencentIntradayHistory(symbol: string): Promise<IntradaySeries[]> {
  const days = [...await fetchDays(symbol)].sort((a, b) => a.date.localeCompare(b.date))
  const out: IntradaySeries[] = []
  for (const day of days) {
    if (day.date === shanghaiToday()) continue
    try { out.push(parseDay(symbol, day, 200)) } catch { /* bad session is excluded */ }
  }
  return out
}
