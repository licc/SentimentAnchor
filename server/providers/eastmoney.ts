import { fetchJson, sleep } from './http.js'

interface KlineResponse {
  rc: number
  data: null | {
    code: string
    name: string
    klines: string[]
  }
}

export interface AmountWindow {
  prevWindowAmount: number
  avg5WindowAmount: number
  windowLabel: string
  windowDays: number
  at: number
  latencyMs: number
}

export interface AmountBaseline {
  tradingDate: string
  prevAmount: number
  avg5Amount: number
  at: number
  latencyMs: number
}

const HOSTS = ['push2his.eastmoney.com', 'push2his.eastmoney.com', 'push2his.eastmoney.com']

export async function fetchAmountBaseline(today: string): Promise<AmountBaseline> {
  const started = Date.now()
  const [sh, sz] = await Promise.all([fetchKline('1.000001', 0), fetchKline('0.399001', 1)])
  const joined = mergeByDate(sh, sz)
  if (joined.length < 2) throw new Error('insufficient kline data')
  const todayIdx = joined.findIndex((r) => r.date === today)
  const currentIdx = todayIdx >= 0 ? todayIdx : joined.length
  const prev = joined[currentIdx - 1]
  const five = joined.slice(Math.max(0, currentIdx - 5), currentIdx)
  const prevAmount = prev ? prev.amount : 0
  const avg5Amount = five.length ? five.reduce((sum, r) => sum + r.amount, 0) / five.length : 0
  return {
    tradingDate: joined[Math.min(currentIdx, joined.length - 1)]?.date ?? today,
    prevAmount,
    avg5Amount,
    at: Date.now(),
    latencyMs: Date.now() - started,
  }
}

async function fetchKline(secid: string, hostOffset: number): Promise<Array<{ date: string; amount: number }>> {
  const params = new URLSearchParams({
    secid,
    klt: '101',
    fqt: '1',
    lmt: '12',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  })
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[(hostOffset + attempt) % HOSTS.length]
    try {
      const res = await fetchJson<KlineResponse>(`https://${host}/api/qt/stock/kline/get?${params}`, {
        timeoutMs: 8_000,
        retries: 0,
        headers: { Referer: 'https://quote.eastmoney.com/' },
      })
      if (!res.data.data?.klines?.length) throw new Error('empty kline')
      return res.data.data.klines
        .map((line) => {
          const f = line.split(',')
          return { date: f[0], amount: Number(f[6]) || 0 }
        })
        .filter((r) => r.date && r.amount > 0)
    } catch (err) {
      lastError = err
      await sleep(550 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('kline failed')
}

function mergeByDate(
  a: Array<{ date: string; amount: number }>,
  b: Array<{ date: string; amount: number }>,
): Array<{ date: string; amount: number }> {
  const map = new Map<string, number>()
  for (const row of a) map.set(row.date, (map.get(row.date) ?? 0) + row.amount)
  for (const row of b) map.set(row.date, (map.get(row.date) ?? 0) + row.amount)
  return [...map.entries()].map(([date, amount]) => ({ date, amount })).sort((x, y) => x.date.localeCompare(y.date))
}

interface TencentKlineResponse {
  code: number
  data: Record<string, { day?: string[][] }>
}

export async function fetchVolumeBaseline(indices: Array<{ code: string; price: number; amount: number; volume: number }>): Promise<AmountBaseline> {
  const started = Date.now()
  const defs = [
    { secid: 'sh000001', code: '000001' },
    { secid: 'sz399001', code: '399001' },
  ]
  const results = await Promise.all(
    defs.map(async (def) => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${def.secid},day,,,12,qfq`
      const res = await fetchJson<TencentKlineResponse>(url, {
        timeoutMs: 9_000,
        retries: 2,
        headers: { Referer: 'https://gu.qq.com/' },
      })
      const rows = res.data.data?.[def.secid]?.day
      if (!rows?.length) throw new Error(`empty kline ${def.secid}`)
      const parsed = rows
        .map((f) => ({ date: f[0], close: Number(f[2]) || 0, volume: Number(f[5]) || 0 }))
        .filter((r) => r.date && r.volume > 0)
      const current = indices.find((i) => i.code === def.code)
      const lastVolume = parsed[parsed.length - 1]?.volume ?? 0
      // Tencent daily volumes are in lots (100 shares) for both exchanges.
      const currentAvg = current && lastVolume > 0 ? current.amount / (lastVolume * 100) : 0
      return { parsed, currentAvg }
    }),
  )
  const todayIdxes = results.map((r) => r.parsed.length - 1)
  const today = results[0].parsed[todayIdxes[0]]?.date ?? ''
  let prevAmount = 0
  let avg5Amount = 0
  results.forEach((r, idx) => {
    const end = todayIdxes[idx]
    const prior = r.parsed.slice(Math.max(0, end - 5), end)
    if (prior.length === 0) return
    prevAmount += prior[prior.length - 1].volume * 100 * (r.currentAvg || 0)
    avg5Amount += (prior.reduce((sum, row) => sum + row.volume, 0) / prior.length) * 100 * (r.currentAvg || 0)
  })
  if (!prevAmount) throw new Error('no prior volume')
  return {
    tradingDate: today,
    prevAmount,
    avg5Amount,
    at: Date.now(),
    latencyMs: Date.now() - started,
  }
}


interface TrendLine {
  date: string
  time: string
  amount: number
}

export async function fetchAmountWindow(today: string, now: number): Promise<AmountWindow> {
  const started = Date.now()
  const cutoff = sessionCutoff(now)
  const cutoff5 = ceilFiveMinute(cutoff)
  const secids = ['1.000001', '0.399001']
  const parts = await Promise.all(
    secids.map(async (secid) => {
      const [trends, fiveMin] = await Promise.all([
        fetchTrendLines(secid),
        fetchFiveMinuteLines(secid),
      ])
      return { trends, fiveMin }
    }),
  )

  const trendDates = [...new Set(parts.flatMap((p) => p.trends.map((r) => r.date)).filter((d) => d < today))].sort()
  const prevDate = trendDates[trendDates.length - 1]
  let prevWindowAmount = 0
  if (prevDate) {
    prevWindowAmount = parts.reduce(
      (sum, p) => sum + p.trends.filter((r) => r.date === prevDate && r.time <= cutoff).reduce((s, r) => s + r.amount, 0),
      0,
    )
  }

  const history = new Map<string, number>()
  for (const p of parts) {
    for (const row of p.fiveMin) {
      if (row.date >= today || row.time > cutoff5) continue
      history.set(row.date, (history.get(row.date) ?? 0) + row.amount)
    }
  }
  const days = [...history.keys()].sort().slice(-5)
  const avg5WindowAmount = days.length
    ? days.reduce((sum, d) => sum + (history.get(d) ?? 0), 0) / days.length
    : 0

  if (!prevWindowAmount) {
    const last = [...history.entries()].sort((a, b) => a[0].localeCompare(b[0])).at(-1)
    prevWindowAmount = last?.[1] ?? 0
  }
  if (!prevWindowAmount) throw new Error('empty previous amount window')

  return {
    prevWindowAmount,
    avg5WindowAmount,
    windowLabel: cutoff,
    windowDays: days.length,
    at: Date.now(),
    latencyMs: Date.now() - started,
  }
}

interface TrendsResponse {
  rc: number
  data: null | { trends: string[] }
}

async function fetchTrendLines(secid: string): Promise<TrendLine[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=2`
  const res = await fetchJson<TrendsResponse>(url, {
    timeoutMs: 8_000,
    retries: 0,
    headers: { Referer: 'https://quote.eastmoney.com/' },
  })
  if (res.data.rc !== 0 || !Array.isArray(res.data.data?.trends)) throw new Error(`trends ${secid}: ${res.data.rc}`)
  return res.data.data.trends
    .map((line): TrendLine | null => {
      const f = line.split(',')
      const [date, time] = (f[0] ?? '').split(' ')
      if (!date || !time) return null
      return { date, time, amount: Number(f[6]) || 0 }
    })
    .filter((r): r is TrendLine => r !== null && r.amount > 0)
}

async function fetchFiveMinuteLines(secid: string): Promise<TrendLine[]> {
  const params = new URLSearchParams({
    secid,
    klt: '5',
    fqt: '1',
    lmt: '600',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
  })
  const res = await fetchJson<KlineResponse>(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, {
    timeoutMs: 8_000,
    retries: 0,
    headers: { Referer: 'https://quote.eastmoney.com/' },
  })
  if (!res.data.data?.klines?.length) throw new Error(`five minute kline ${secid} empty`)
  return res.data.data.klines
    .map((line): TrendLine | null => {
      const f = line.split(',')
      const [date, time] = (f[0] ?? '').split(' ')
      if (!date || !time) return null
      return { date, time, amount: Number(f[6]) || 0 }
    })
    .filter((r): r is TrendLine => r !== null && r.amount > 0)
}

function sessionCutoff(now: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const mins = hour * 60 + minute
  if (mins < 9 * 60 + 30) return '09:30'
  if (mins <= 11 * 60 + 30) return hhmm(mins)
  if (mins < 13 * 60) return '11:30'
  if (mins <= 15 * 60) return hhmm(mins)
  return '15:00'
}

function ceilFiveMinute(time: string): string {
  const [h, m] = time.split(':').map(Number)
  return hhmm(Math.ceil((h * 60 + m) / 5) * 5)
}

function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}
