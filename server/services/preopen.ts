import fs from 'node:fs'
import path from 'node:path'
import type { Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { buildQuantCandidates } from './quant-pool.js'

const DIR = path.join(process.cwd(), 'data', 'preopen')
let lastAttempt = ''

export interface PreopenItem { code: string; name: string; price: number; pct: number; theme: string; source: string; reason: string; score: number; estimatedCost: number; affordable: boolean }
export interface PreopenReview { date: string; generatedAt: string; stage: string; sentimentScore: number; foreignFear: number | null; items: PreopenItem[]; note: string }

export function generatePreopen(snapshot: Snapshot, accountTotal = 10_000): PreopenReview {
  const date = snapshot.tradingDate
  const candidates = buildQuantCandidates(snapshot, Math.max(1_000, accountTotal), 0.3)
    .filter((c) => !/^[NC]|ST|\*ST/.test(c.name))
    .slice(0, 8)
    .map((c, i) => ({ code: c.code, name: c.name, price: c.price, pct: c.pct, theme: c.theme, source: c.source, reason: c.reason, score: Math.max(0, 100 - i * 8), estimatedCost: Math.round(c.price * 100), affordable: c.affordable }))
  const review: PreopenReview = {
    date, generatedAt: new Date().toISOString(), stage: snapshot.sentiment.stage, sentimentScore: snapshot.sentiment.score,
    foreignFear: snapshot.sentiment.foreignFear?.score ?? null, items: candidates,
    note: candidates.length ? '盘前候选来自情绪锚强势股与锚定池，开盘前仅作人工观察，不自动下单。' : '当前没有满足条件的盘前候选。',
  }
  try { fs.mkdirSync(DIR, { recursive: true }); atomicWriteJson(path.join(DIR, `${date}.json`), review) } catch { /* best effort */ }
  lastAttempt = date
  return review
}

export function getPreopen(date?: string): PreopenReview | null {
  const wanted = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  try { return JSON.parse(fs.readFileSync(path.join(DIR, `${wanted}.json`), 'utf8')) as PreopenReview } catch {
    try {
      const latest = fs.readdirSync(DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1)
      return latest ? JSON.parse(fs.readFileSync(path.join(DIR, latest), 'utf8')) as PreopenReview : null
    } catch { return null }
  }
}

export function maybeGeneratePreopen(snapshot: Snapshot | null, accountTotal = 10_000): void {
  if (!snapshot) return
  if (lastAttempt === snapshot.tradingDate) return
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  if ((minutes >= 9 * 60 + 20 && minutes <= 9 * 60 + 40) || minutes >= 15 * 60) generatePreopen(snapshot)
}
