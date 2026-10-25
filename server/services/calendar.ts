import fs from 'node:fs'
import path from 'node:path'
import type { CalendarDay, CalendarPayload } from '../../shared/types.js'
import { fetchJson, fetchText } from '../providers/http.js'
import { atomicWriteJson } from '../lib/atomic.js'

const DATA_DIR = path.join(process.cwd(), 'data')
const CACHE_PATH = path.join(DATA_DIR, 'calendar.json')
const TTL_MS = 10 * 60 * 1000
const POOL_UT = '7eea3edcaed734bea9cbfc24409ed989'

interface ThsRow {
  date: string
  close: number
  amount: number
}

interface PoolItem {
  c: string
  n: string
  zdp?: number
  lbc?: number
  fbt?: number
  zbc?: number
  hybk?: string
  days?: number
}

let cache: CalendarPayload | null = null
let fetching: Promise<CalendarPayload> | null = null

export async function getCalendar(force = false): Promise<CalendarPayload> {
  if (!force && cache && Date.now() - new Date(cache.generatedAt).getTime() < TTL_MS) return cache
  if (!cache) cache = loadCache()
  if (!force && cache && Date.now() - new Date(cache.generatedAt).getTime() < TTL_MS) return cache
  if (fetching) return fetching
  fetching = refresh().finally(() => {
    fetching = null
  })
  return fetching
}

export async function getCalendarDay(date: string): Promise<CalendarDay | null> {
  const cal = await getCalendar()
  return cal.days.find((d) => d.date === date) ?? null
}

async function refresh(): Promise<CalendarPayload> {
  const old = cache
  try {
    const [shRows, szRows] = await Promise.all([fetchThsRows('zs_1A0001'), fetchThsRows('zs_399001')])
    if (shRows.length < 3) throw new Error('THS history unavailable')
    const szMap = new Map(szRows.map((r) => [r.date, r]))
    const rows = shRows.map((r) => ({ ...r, amount: r.amount + (szMap.get(r.date)?.amount ?? 0) }))
    const dates = rows.slice(-14).map((r) => r.date)
    const days: CalendarDay[] = []
    for (let i = 0; i < dates.length; i += 3) {
      const batch = dates.slice(i, i + 3)
      const results = await Promise.all(batch.map((date) => buildDay(date, rows)))
      days.push(...results.filter((d): d is CalendarDay => Boolean(d)))
    }
    if (days.length === 0) throw new Error('no historical pool data')
    const sorted = days.sort((a, b) => a.date.localeCompare(b.date))
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < sorted.length - 1; i++) {
      const arr = buckets.get(sorted[i].stage) ?? []
      arr.push(sorted[i + 1].indexPct)
      buckets.set(sorted[i].stage, arr)
    }
    const stats = [...buckets.entries()].map(([stage, values]) => ({
      stage,
      samples: values.length,
      avgNextPct: Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100,
      winRate: Math.round((values.filter((v) => v > 0).length / values.length) * 100),
    }))
    const payload: CalendarPayload = {
      generatedAt: new Date().toISOString(),
      days: sorted,
      partial: days.length < dates.length,
      stats,
    }
    cache = payload
    saveCache(payload)
    return payload
  } catch (err) {
    if (old) return old
    const fallback = loadCache()
    if (fallback) return fallback
    return { generatedAt: new Date().toISOString(), days: [], partial: true }
  }
}

async function buildDay(date: string, rows: ThsRow[]): Promise<CalendarDay | null> {
  const idx = rows.findIndex((r) => r.date === date)
  if (idx < 1) return null
  const current = rows[idx]
  const prev = rows[idx - 1]
  const queryDate = date.replace(/-/g, '')
  const [zt, dt] = await Promise.all([fetchPool('ZT', queryDate), fetchPool('DT', queryDate)])
  if (zt.length === 0 && dt.length === 0) return null
  const sortedUp = zt.slice().sort((a, b) => (b.lbc ?? 0) - (a.lbc ?? 0) || (a.fbt ?? 0) - (b.fbt ?? 0))
  const maxBoard = sortedUp.reduce((max, s) => Math.max(max, s.lbc ?? 1), 0)
  const themeCount = new Map<string, number>()
  for (const s of zt) {
    if (!s.hybk || isGenericTheme(s.hybk)) continue
    themeCount.set(s.hybk, (themeCount.get(s.hybk) ?? 0) + 1)
  }
  const topTheme = [...themeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  const score = Math.round(Math.max(0, Math.min(100, 30 + zt.length * 0.55 + maxBoard * 2 - dt.length * 1.1)))
  const stage = zt.length >= 70 ? '高潮' : zt.length >= 45 && dt.length <= 12 ? '发酵' : zt.length >= 30 ? '修复' : zt.length >= 20 ? '分歧' : '退潮'
  return {
    date,
    indexPct: round(((current.close - prev.close) / prev.close) * 100),
    indexClose: round(current.close),
    amount: current.amount,
    limitUp: zt.length,
    limitDown: dt.length,
    maxBoard,
    topTheme,
    stage,
    score,
    leaders: sortedUp.slice(0, 5).map((s) => ({
      code: s.c,
      name: s.n,
      pct: round(Number(s.zdp) || 0),
      days: s.lbc ?? 1,
      theme: s.hybk || '',
    })),
    laggards: dt.slice(0, 5).map((s) => ({
      code: s.c,
      name: s.n,
      pct: round(Number(s.zdp) || 0),
      days: s.days ?? 1,
      theme: s.hybk || '',
    })),
    note: '历史阶段按涨停/跌停池近似，未使用全市场广度；东方财富池不含 ST。',
  }
}

async function fetchThsRows(key: string): Promise<ThsRow[]> {
  const res = await fetchText(`https://d.10jqka.com.cn/v6/line/${key}/01/last.js`, {
    timeoutMs: 9_000,
    headers: { Referer: 'https://stockpage.10jqka.com.cn/' },
    retries: 2,
  })
  const start = res.text.indexOf('(')
  const end = res.text.lastIndexOf(')')
  if (start < 0 || end <= start) throw new Error('invalid THS history')
  const json = JSON.parse(res.text.slice(start + 1, end)) as { data?: string }
  if (!json.data) throw new Error('empty THS history')
  return json.data
    .split(';')
    .map((line) => {
      const f = line.split(',')
      if (f.length < 7 || f[0].length !== 8) return null
      return {
        date: `${f[0].slice(0, 4)}-${f[0].slice(4, 6)}-${f[0].slice(6, 8)}`,
        close: Number(f[4]) || 0,
        amount: Number(f[6]) || 0,
      }
    })
    .filter((r): r is ThsRow => r !== null && r.close > 0)
}

async function fetchPool(kind: 'ZT' | 'DT', date: string): Promise<PoolItem[]> {
  const endpoint = kind === 'ZT' ? 'getTopicZTPool' : 'getTopicDTPool'
  const fields = kind === 'ZT' ? 'f12,f14,zdp,lbc,fbt,zbc,hybk' : 'f12,f14,zdp,days,hybk'
  const sort = kind === 'ZT' ? 'fbt:asc' : 'fund:asc'
  const url = `https://push2ex.eastmoney.com/${endpoint}?ut=${POOL_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=100&sort=${sort}&date=${date}&fields=${fields}`
  const res = await fetchJson<{ data?: { pool?: PoolItem[] } }>(url, { timeoutMs: 10_000, retries: 2 })
  return Array.isArray(res.data.data?.pool) ? res.data.data.pool : []
}

function isGenericTheme(name: string): boolean {
  return ['其他', '业绩增长', '昨日涨停', '融资融券', '深股通', '沪股通', '机构重仓'].includes(name)
}

function loadCache(): CalendarPayload | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CalendarPayload
  } catch {
    return null
  }
}

function saveCache(payload: CalendarPayload) {
  try {
    atomicWriteJson(CACHE_PATH, payload)
  } catch {
    // cache is best-effort
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
