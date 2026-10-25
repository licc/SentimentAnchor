import fs from 'node:fs'
import path from 'node:path'
import type { IntradaySeries } from '../providers/tencent-intraday.js'
import { atomicWriteJson } from '../lib/atomic.js'

const ROOT = path.join(process.cwd(), 'data', 'intraday')

/** Persist every analyzed session so the 5-day provider limit stops being a hard ceiling. */
export function recordIntradaySeries(series: IntradaySeries): void {
  const dir = path.join(ROOT, series.symbol)
  const file = path.join(dir, `${series.date}.json`)
  try {
    if (fs.existsSync(file) && series.partial) return
    fs.mkdirSync(dir, { recursive: true })
    atomicWriteJson(file, series)
  } catch { /* data archive is best effort; never block analysis */ }
}

export function listIntradayDates(symbol: string): string[] {
  try {
    return fs.readdirSync(path.join(ROOT, symbol)).filter((n) => /^\d{8}\.json$/.test(n)).map((n) => n.slice(0, 8)).sort()
  } catch { return [] }
}

export function loadIntradaySeries(symbol: string, date: string): IntradaySeries | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, symbol, `${date}.json`), 'utf8')) as IntradaySeries
  } catch { return null }
}

export function loadIntradayArchive(symbol: string, limit = 120): IntradaySeries[] {
  return listIntradayDates(symbol).slice(-limit).map((date) => loadIntradaySeries(symbol, date)).filter((x): x is IntradaySeries => Boolean(x))
}
