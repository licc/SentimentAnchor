import fs from 'node:fs'
import path from 'node:path'
import type { Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const DIR = path.join(process.cwd(), 'data', 'pit')
export interface PitSnapshot {
  date: string
  recordedAt: string
  stage: string
  score: number
  foreignFear: number | null
  stocks: Array<{ code: string; name: string; price: number; pct: number; source: string; st: boolean }>
}
/** Persist what was observable on that date; never overwrite an existing date with today's list. */
export function recordPit(snapshot: Snapshot): void {
  const date = snapshot.tradingDate
  const file = path.join(DIR, `${date}.json`)
  if (fs.existsSync(file)) return
  const rows = [...snapshot.anchors.map((a) => ({ ...a.stock, source: `anchor:${a.role}` })), ...snapshot.leaders.map((s) => ({ ...s, source: 'leader' }))]
  const seen = new Set<string>()
  const stocks = rows.filter((s) => /^(0|3|6)\d{5}$/.test(s.code) && !seen.has(s.code) && Boolean(seen.add(s.code))).map((s) => ({ code: s.code, name: s.name, price: s.price, pct: s.pct, source: s.source, st: /ST|\*ST|退/.test(s.name) }))
  const record: PitSnapshot = { date, recordedAt: new Date().toISOString(), stage: snapshot.sentiment.stage, score: snapshot.sentiment.score, foreignFear: snapshot.sentiment.foreignFear?.score ?? null, stocks }
  try { fs.mkdirSync(DIR, { recursive: true }); atomicWriteJson(file, record) } catch { /* best effort */ }
}
export function getPit(date: string): PitSnapshot | null {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${date}.json`), 'utf8')) as PitSnapshot } catch { return null }
}
export function listPit(): string[] { try { return fs.readdirSync(DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 10)).sort().reverse() } catch { return [] } }
