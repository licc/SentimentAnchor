import fs from 'node:fs'
import path from 'node:path'
import type { EtfRole, EtfSelection, EtfSelectionItem, EtfUniverseItem } from '../../shared/types.js'
import { fetchJson } from '../providers/http.js'
import { fetchStockQuotes, prefixFor } from '../providers/sina.js'
import { saveEtfConfig } from './etf-config.js'
import { roundTripCostPct } from './etf-fees.js'

const FILE = path.join(process.cwd(), 'data', 'etf-selection.json')
const MIN_AMOUNT = 300_000_000
const MIN_PRICE = 0.6
const MAX_PRICE = 200

const CANDIDATES: Array<{ code: string; role: EtfRole; t0: boolean }> = [
  { code: '513310', role: 'risk', t0: true },
  { code: '159981', role: 'risk', t0: true },
  { code: '513060', role: 'risk', t0: true },
  { code: '513050', role: 'risk', t0: true },
  { code: '513090', role: 'risk', t0: true },
  { code: '159792', role: 'risk', t0: true },
  { code: '513180', role: 'risk', t0: true },
  { code: '513330', role: 'risk', t0: true },
  { code: '513520', role: 'risk', t0: true },
  { code: '159740', role: 'risk', t0: true },
  { code: '518880', role: 'hedge', t0: true },
  { code: '518800', role: 'hedge', t0: true },
  { code: '159934', role: 'hedge', t0: true },
]

interface KlineResponse {
  rc: number
  data: null | { klines: string[] }
}

let cache: EtfSelection | null = load()
let fetching: Promise<EtfSelection> | null = null

export async function ensureEtfSelection(force = false): Promise<EtfSelection> {
  const date = shanghaiDate()
  const nowMin = shanghaiMinutes()
  const cacheBeforeOpen = cache?.date === date && nowMin >= 9 * 60 + 30 && minuteOf(cache.generatedAt) < 9 * 60 + 30
  if (!force && cache?.date === date && !cacheBeforeOpen) return cache
  if (fetching) return fetching
  fetching = select(date).finally(() => {
    fetching = null
  })
  return fetching
}

export async function getEtfSelection(force = false): Promise<EtfSelection> {
  return ensureEtfSelection(force)
}

async function select(date: string): Promise<EtfSelection> {
  const nowMin = shanghaiMinutes()
  const old = cache
  try {
    const quoteRes = await fetchStockQuotes(CANDIDATES.map((x) => prefixFor(x.code)))
    const rows = await Promise.all(
      CANDIDATES.map(async (def) => {
        try {
          if (!def.t0) return null
          const quote = quoteRes.map[def.code]
          if (!quote?.price || quote.price < MIN_PRICE || quote.price > MAX_PRICE) return null
          const stats = await dailyStats(def.code, quote.amount)
          if (!stats || stats.avgAmount < MIN_AMOUNT) return null
          const tickPct = (0.001 / quote.price) * 100
          const roundTripPct = roundTripCostPct(5_000, quote.price)
          const volScore = Math.min(stats.vol20 / 50, 1) * 45
          const liqScore = Math.min(stats.avgAmount / 100_000_000_000, 1) * 25
          const tickScore = (1 - Math.min(tickPct / 0.3, 1)) * 20
          const momentum = nowMin < 9 * 60 + 30 ? 0 : Math.max(-1, Math.min(1, quote.pct / 5)) * 10
          const score = Math.round((volScore + liqScore + tickScore + momentum) * 10) / 10
          return {
            code: def.code,
            name: quote.name || def.code,
            role: def.role,
            score,
            vol20: round(stats.vol20),
            avgAmount20: stats.avgAmount,
            tickPct: round(tickPct),
            roundTripPct,
            pct: round(quote.pct),
            reason: `20日波动 ${round(stats.vol20)}% · ${stats.source === 'tencent' ? '当前成交' : '日均成交'} ${(stats.avgAmount / 1e8).toFixed(1)}亿 · tick ${tickPct.toFixed(3)}% · 5k往返约 ${roundTripPct.toFixed(2)}%`,
          } satisfies EtfSelectionItem
        } catch {
          return null
        }
      }),
    )
    const eligible = rows.filter((x): x is EtfSelectionItem => Boolean(x))
    const risks = eligible.filter((x) => x.role === 'risk').sort((a, b) => b.score - a.score).slice(0, 3)
    const hedges = eligible.filter((x) => x.role === 'hedge').sort((a, b) => b.score - a.score).slice(0, 1)
    const items = [...risks, ...hedges]
    if (items.length === 0) throw new Error('没有满足流动性/价格条件的 T+0 ETF')
    const universe: EtfUniverseItem[] = items.map((x) => ({ code: x.code, role: x.role }))
    saveEtfConfig({ universe })
    const selection: EtfSelection = {
      date,
      generatedAt: new Date().toISOString(),
      source: '系统自动选池 · 20日波动 + 成交额 + tick成本 + 当日相对强弱',
      items,
      candidates: eligible.sort((a, b) => b.score - a.score).slice(0, 10),
      note: `条件：价格 ≥${MIN_PRICE} 且 ≤${MAX_PRICE}，日均成交 ≥${(MIN_AMOUNT / 1e8).toFixed(0)}亿；优先高波动、低成本、流动性。`,
    }
    cache = selection
    save(selection)
    return selection
  } catch (err) {
    if (old) return old
    throw err
  }
}

async function dailyStats(code: string, currentAmount: number) {
  const secid = `${code.startsWith('5') || code.startsWith('6') ? '1' : '0'}.${code}`
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=40&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`
  let source = 'eastmoney'
  let rows: Array<{ close: number; high: number; low: number; amount: number }> = []
  try {
    const res = await fetchJson<KlineResponse>(url, {
      timeoutMs: 8_000,
      retries: 0,
      headers: { Referer: 'https://quote.eastmoney.com/' },
    })
    const klines = res.data.data?.klines ?? []
    rows = klines
      .map((line) => {
        const f = line.split(',')
        return { close: Number(f[2]) || 0, high: Number(f[3]) || 0, low: Number(f[4]) || 0, amount: Number(f[6]) || 0 }
      })
      .filter((x) => x.close > 0)
      .slice(-20)
  } catch {
    rows = []
  }
  if (rows.length < 10) {
    try {
      const prefix = code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'
      const t = await fetchJson<{ data?: Record<string, { day?: string[][]; qfqday?: string[][] }> }>(
        `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,30,qfq`,
        { timeoutMs: 8_000, retries: 0, headers: { Referer: 'https://gu.qq.com/' } },
      )
      const day = t.data.data?.[`${prefix}${code}`]?.day ?? t.data.data?.[`${prefix}${code}`]?.qfqday ?? []
      rows = day
        .map((f) => ({ close: Number(f[2]) || 0, high: Number(f[3]) || 0, low: Number(f[4]) || 0, amount: 0 }))
        .filter((x) => x.close > 0)
        .slice(-20)
      source = 'tencent'
    } catch {
      rows = []
    }
  }
  if (rows.length < 10) return null
  const returns: number[] = []
  const amps: number[] = []
  for (let i = 1; i < rows.length; i++) {
    returns.push(rows[i].close / rows[i - 1].close - 1)
    amps.push((rows[i].high - rows[i].low) / rows[i - 1].close)
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const sd = Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length)
  return {
    vol20: sd * Math.sqrt(252) * 100,
    amp20: (amps.reduce((a, b) => a + b, 0) / amps.length) * 100,
    avgAmount: source === 'tencent' ? currentAmount : rows.reduce((s, x) => s + x.amount, 0) / rows.length,
    source,
  }
}

function shanghaiMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
}

function minuteOf(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function round(n: number) {
  return Math.round(n * 100) / 100
}

function load(): EtfSelection | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EtfSelection
    return raw?.date ? raw : null
  } catch {
    return null
  }
}

function save(value: EtfSelection) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    const tmp = `${FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, FILE)
  } catch {
    // best effort
  }
}
