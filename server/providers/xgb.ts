import type { Stock } from '../../shared/types.js'
import { fetchJson } from './http.js'

const BASE = 'https://flash-api.xuangubao.cn'

interface XgbResponse<T> {
  code: number
  message: string
  data: T
}

export interface RawBreadth {
  rise_count: number
  fall_count: number
  limit_up_count: number
  limit_down_count: number
  timestamp: number
}

export interface RawPlate {
  plate_id: number
  plate_name: string
  plate_reason: string
}

export interface RawPoolItem {
  symbol: string
  stock_chi_name: string
  price: number
  change_percent: number
  first_limit_up: number
  first_break_limit_up: number
  last_break_limit_up: number
  last_limit_up: number
  first_limit_down: number
  last_limit_down: number
  break_limit_up_times: number
  break_limit_down_times: number
  limit_up_days: number
  limit_down_days: number
  turnover_ratio: number
  buy_lock_volume_ratio: number
  sell_lock_volume_ratio: number
  total_capital: number
  non_restricted_capital: number
  volume_bias_ratio: number
  is_new_stock: boolean
  stock_type: number
  listed_date: number
  nearly_new_acc_pcp: number
  new_stock_limit_up_days: number
  yesterday_limit_up_days: number
  yesterday_limit_down_days: number
  m_days_n_boards_boards: number
  m_days_n_boards_days: number
  surge_reason: null | {
    symbol: string
    stock_reason: string
    related_plates: RawPlate[]
  }
  limit_timeline: { items: { timestamp: number; status: number }[] }
}

export interface RawLimitPool {
  limitUp: RawPoolItem[]
  limitDown: RawPoolItem[]
  at: number
  latencyMs: number
}

const headers = { Referer: 'https://xuangubao.cn/', Accept: 'application/json' }

export async function fetchBreadthLine(): Promise<{ points: RawBreadth[]; at: number; latencyMs: number }> {
  const fields = 'rise_count,fall_count,limit_up_count,limit_down_count'
  const res = await fetchJson<XgbResponse<RawBreadth[]>>(
    `${BASE}/api/market_indicator/line?fields=${fields}`,
    { headers, timeoutMs: 5_000, retries: 0 },
  )
  if (res.data.code !== 20000 || !Array.isArray(res.data.data) || res.data.data.length === 0) {
    throw new Error(`XGB breadth ${res.data.code}: ${res.data.message}`)
  }
  const points = res.data.data
    .filter((p) => Number.isFinite(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
  return { points, at: res.at, latencyMs: res.latencyMs }
}

export async function fetchLimitPools(): Promise<RawLimitPool> {
  const started = Date.now()
  const url = `${BASE}/api/pool/detail?pool_name=limit_up`
  const downUrl = `${BASE}/api/pool/detail?pool_name=limit_down`
  const up = await fetchJson<XgbResponse<RawPoolItem[]>>(url, { headers, timeoutMs: 6_000, retries: 0 })
  if (up.data.code !== 20000 || !Array.isArray(up.data.data)) throw new Error(`XGB limit_up ${up.data.code}`)
  // The limit-down endpoint can legitimately hang or return 50000 when empty.
  // Never let it discard a valid limit-up pool (and the anchors derived from it).
  const down = await fetchJson<XgbResponse<RawPoolItem[]>>(downUrl, { headers, timeoutMs: 5_000, retries: 0 }).catch(() => null)
  const limitDown = down && down.data.code === 20000 && Array.isArray(down.data.data) ? down.data.data : []
  return {
    limitUp: up.data.data,
    limitDown,
    at: Math.max(up.at, down?.at ?? up.at),
    latencyMs: Date.now() - started,
  }
}

export function toStock(raw: RawPoolItem, status: 'limitUp' | 'limitDown'): Stock {
  const [code, suffix = ''] = raw.symbol.split('.')
  const market = suffix.toLowerCase() || guessMarket(code)
  const pct = round(raw.change_percent * 100, 2)
  const days = status === 'limitUp' ? raw.limit_up_days : raw.limit_down_days
  const is20 = code.startsWith('30') || code.startsWith('68') || code.startsWith('92')
  const plates = raw.surge_reason?.related_plates ?? []
  const theme = plates[0]?.plate_name ?? ''
  const reason = (raw.surge_reason?.stock_reason ?? '').replace(/\s+/g, ' ').trim()
  const first = status === 'limitUp' ? raw.first_limit_up : raw.first_limit_down
  const last = status === 'limitUp' ? raw.last_limit_up : raw.last_limit_down
  const tags: string[] = []
  if (status === 'limitUp') {
    if (days > 1) tags.push(`${days}连板`)
    else tags.push('首板')
    if (is20 && pct >= 19.5) tags.push('20cm')
    if (raw.first_limit_up > 0 && formatTime(raw.first_limit_up) <= '09:26:00') tags.push('竞价板')
    if (raw.break_limit_up_times > 0) tags.push(`回封${raw.break_limit_up_times}`)
  } else {
    if (days > 1) tags.push(`${days}连跌停`)
    else tags.push('跌停')
    if (raw.break_limit_down_times > 0) tags.push('撬板')
  }
  if (raw.is_new_stock) tags.push('新股')
  if (theme) tags.push(theme)
  return {
    symbol: raw.symbol,
    code,
    name: raw.stock_chi_name,
    market,
    price: round(raw.price, 2),
    pct,
    amount: 0,
    turnover: round(raw.turnover_ratio * 100, 2),
    marketCap: raw.total_capital,
    floatCap: raw.non_restricted_capital,
    volumeRatio: raw.volume_bias_ratio ? round(raw.volume_bias_ratio, 2) : null,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    limitUpDays: raw.limit_up_days,
    limitDownDays: raw.limit_down_days,
    firstLimitTime: formatTime(first),
    lastLimitTime: formatTime(last),
    breakCount: status === 'limitUp' ? raw.break_limit_up_times : raw.break_limit_down_times,
    lockRatio: round((status === 'limitUp' ? raw.buy_lock_volume_ratio : raw.sell_lock_volume_ratio) * 100, 3),
    theme,
    reason,
    status,
    tags: [...new Set(tags)].slice(0, 5),
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  }
}


export function formatTime(unix: number): string {
  if (!unix) return '—'
  return new Date(unix * 1000).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function timeLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function guessMarket(code: string) {
  if (code.startsWith('6')) return 'sh'
  if (code.startsWith('0') || code.startsWith('3')) return 'sz'
  return 'bj'
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
