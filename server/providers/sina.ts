import type { MarketIndex, Sector, Stock } from '../../shared/types.js'
import { fetchText } from './http.js'

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/',
  Accept: '*/*',
}

const INDEX_DEFS = [
  { symbol: 'sh000001', code: '000001', name: '上证指数' },
  { symbol: 'sz399001', code: '399001', name: '深证成指' },
  { symbol: 'sz399006', code: '399006', name: '创业板指' },
  { symbol: 'sh000688', code: '000688', name: '科创50' },
  { symbol: 'sh000300', code: '000300', name: '沪深300' },
  { symbol: 'bj899050', code: '899050', name: '北证50' },
]

export interface SinaQuotesResult {
  indices: MarketIndex[]
  at: number
  latencyMs: number
}

export async function fetchIndices(): Promise<SinaQuotesResult> {
  const started = Date.now()
  const symbols = INDEX_DEFS.map((d) => d.symbol).join(',')
  const res = await fetchText(`https://hq.sinajs.cn/list=${symbols}`, {
    encoding: 'gbk',
    headers: SINA_HEADERS,
    timeoutMs: 4_000,
    retries: 1,
  })
  const map = parseHq(res.text)
  const indices: MarketIndex[] = []
  for (const def of INDEX_DEFS) {
    const p = map[def.symbol]
    if (!p || p.length < 32) continue
    const prevClose = num(p[2])
    const price = num(p[3]) || prevClose
    const change = price - prevClose
    indices.push({
      code: def.code,
      name: def.name,
      price,
      change,
      pct: prevClose ? (change / prevClose) * 100 : 0,
      open: num(p[1]),
      high: num(p[4]),
      low: num(p[5]),
      prevClose,
      amount: num(p[9]),
      volume: num(p[8]),
      date: p[30] || '',
      time: p[31] || '',
      tone: change > 0.001 ? 'up' : change < -0.001 ? 'down' : 'flat',
    })
  }
  if (indices.length === 0) throw new Error('empty index quotes')
  return { indices, at: res.at, latencyMs: Date.now() - started }
}

export interface QuoteMap {
  [code: string]: {
    code: string
    symbol: string
    name: string
    price: number
    pct: number
    open: number
    high: number
    low: number
    prevClose: number
    amount: number
    volume: number
    date: string
    time: string
  }
}

export async function fetchStockQuotes(symbols: string[]): Promise<{ map: QuoteMap; at: number; latencyMs: number }> {
  const unique = [...new Set(symbols.filter(Boolean))]
  if (unique.length === 0) return { map: {}, at: Date.now(), latencyMs: 0 }
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 70) chunks.push(unique.slice(i, i + 70))
  const started = Date.now()
  const results = await Promise.all(
    chunks.map((chunk) =>
      fetchText(`https://hq.sinajs.cn/list=${chunk.join(',')}`, {
        encoding: 'gbk',
        headers: SINA_HEADERS,
        timeoutMs: 4_000,
        retries: 0,
      }),
    ),
  )
  const map: QuoteMap = {}
  for (const res of results) {
    const parsed = parseHq(res.text)
    for (const [symbol, p] of Object.entries(parsed)) {
      if (p.length < 32) continue
      const code = symbol.replace(/^[a-z]+/, '')
      const prevClose = num(p[2])
      const price = num(p[3]) || prevClose
      if (!prevClose) continue
      map[code] = {
        code,
        symbol,
        name: p[0],
        price,
        pct: ((price - prevClose) / prevClose) * 100,
        open: num(p[1]),
        high: num(p[4]),
        low: num(p[5]),
        prevClose,
        amount: num(p[9]),
        volume: num(p[8]),
        date: p[30] || '',
        time: p[31] || '',
      }
    }
  }
  if (Object.keys(map).length === 0) throw new Error('empty stock quotes')
  return { map, at: Date.now(), latencyMs: Date.now() - started }
}

export async function fetchRank(direction: 'up' | 'down'): Promise<{ rows: Stock[]; at: number; latencyMs: number }> {
  const asc = direction === 'up' ? 0 : 1
  const url =
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
    `?page=1&num=100&sort=changepercent&asc=${asc}&node=hs_a&symbol=&_s_r_a=page`
  const res = await fetchText(url, { headers: SINA_HEADERS, timeoutMs: 9_000, retries: 2 })
  let raw: any[]
  try {
    raw = JSON.parse(res.text)
  } catch {
    throw new Error('invalid Sina rank JSON')
  }
  if (!Array.isArray(raw)) throw new Error('unexpected Sina rank payload')
  const rows = raw
    .map((r) => rankToStock(r, direction))
    .filter((s): s is Stock => Boolean(s))
  return { rows, at: res.at, latencyMs: res.latencyMs }
}

function rankToStock(r: any, direction: 'up' | 'down'): Stock | null {
  const code = String(r.code ?? '')
  const price = num(r.trade)
  const prevClose = num(r.settlement)
  if (!code || !price || !prevClose) return null
  const pct = num(r.changepercent)
  const symbol = String(r.symbol ?? prefixFor(code))
  const name = String(r.name ?? '')
  const tags: string[] = []
  if (/^ST|\*ST/.test(name)) tags.push('ST')
  if ((code.startsWith('30') || code.startsWith('68')) && Math.abs(pct) >= 19.5) tags.push('20cm')
  if (direction === 'up' && pct >= 9.8) tags.push('涨停附近')
  if (direction === 'down' && pct <= -9.8) tags.push('跌停附近')
  return {
    symbol: toXgbSymbol(symbol),
    code,
    name,
    market: symbol.slice(0, 2),
    price,
    pct: round(pct, 2),
    amount: num(r.amount),
    turnover: round(num(r.turnoverratio), 2),
    marketCap: num(r.mktcap) * 10_000,
    floatCap: num(r.nmc) * 10_000,
    volumeRatio: null,
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    prevClose,
    limitUpDays: 0,
    limitDownDays: 0,
    firstLimitTime: '—',
    lastLimitTime: '—',
    breakCount: 0,
    lockRatio: 0,
    theme: '',
    reason: '',
    status: direction === 'up' ? 'strong' : 'weak',
    tags,
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  }
}

export async function fetchSectors(): Promise<{
  industry: Sector[]
  concept: Sector[]
  at: number
  latencyMs: number
}> {
  const started = Date.now()
  const [industryRes, conceptRes] = await Promise.all([
    fetchText('https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php', {
      encoding: 'gbk',
      headers: SINA_HEADERS,
      timeoutMs: 9_000,
      retries: 2,
    }),
    fetchText('https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class', {
      encoding: 'gbk',
      headers: SINA_HEADERS,
      timeoutMs: 9_000,
      retries: 2,
    }),
  ])
  const industry = parseSectorScript(industryRes.text, 'industry')
  const concept = parseSectorScript(conceptRes.text, 'concept')
  if (industry.length === 0 && concept.length === 0) throw new Error('empty sector data')
  return { industry, concept, at: Date.now(), latencyMs: Date.now() - started }
}

function parseSectorScript(text: string, kind: 'industry' | 'concept'): Sector[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let obj: Record<string, string>
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const sectors: Sector[] = []
  for (const line of Object.values(obj)) {
    const f = line.split(',')
    if (f.length < 13) continue
    const pct = num(f[5])
    const count = Math.round(num(f[2]))
    if (!f[0] || count <= 0) continue
    sectors.push({
      code: f[0],
      name: f[1],
      pct: round(pct, 2),
      amount: num(f[7]),
      up: 0,
      down: 0,
      count,
      leader: f[12] ?? '',
      leaderPct: round(num(f[9]), 2),
      kind,
      tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    })
  }
  return sectors.sort((a, b) => b.pct - a.pct)
}

function parseHq(text: string): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  const re = /var hq_str_([a-z0-9]+)="([^"]*)";?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!m[2]) continue
    map[m[1]] = m[2].split(',')
  }
  return map
}

export function prefixFor(code: string): string {
  if (code.startsWith('6') || code.startsWith('5')) return `sh${code}`
  if (code.startsWith('0') || code.startsWith('3') || code.startsWith('1')) return `sz${code}`
  return `bj${code}`
}

export function toXgbSymbol(sinaSymbol: string): string {
  const prefix = sinaSymbol.slice(0, 2)
  const code = sinaSymbol.slice(2)
  return `${code}.${prefix === 'sh' ? 'SS' : prefix === 'sz' ? 'SZ' : 'BJ'}`
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n: number, digits = 2) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
