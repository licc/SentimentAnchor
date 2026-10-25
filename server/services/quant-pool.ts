import fs from 'node:fs'
import path from 'node:path'
import type { QuantCandidate, QuantPoolPayload, Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'quant-pool.json')
interface Stored { codes: string[]; assignments: Record<string, string>; updatedAt: string }
let data: Stored = load()

export function getQuantPool(): QuantPoolPayload {
  return { codes: data.codes, assignments: data.assignments, items: [], candidates: [], updatedAt: data.updatedAt || null }
}

export function setQuantAssignment(code: string, strategyId: string): QuantPoolPayload {
  if (!data.codes.includes(code)) throw new Error('股票不在 T+1 池内')
  if (!strategyId) delete data.assignments[code]
  else data.assignments[code] = strategyId
  data.updatedAt = new Date().toISOString()
  save()
  return getQuantPool()
}

export function addQuantCode(code: string): QuantPoolPayload {
  const normalized = String(code).trim()
  if (!/^(0|3|6)\d{5}$/.test(normalized)) throw new Error('股票代码必须是 6 位 A 股代码（不支持 ETF）')
  if (!data.codes.includes(normalized)) {
    data.codes = [...data.codes, normalized]
    data.updatedAt = new Date().toISOString()
    save()
  }
  return getQuantPool()
}

export function removeQuantCode(code: string): QuantPoolPayload {
  data.codes = data.codes.filter((x) => x !== code)
  delete data.assignments[code]
  data.updatedAt = new Date().toISOString()
  save()
  return getQuantPool()
}

export function buildQuantCandidates(snapshot: Snapshot, accountTotal: number, maxPct = 0.3): QuantCandidate[] {
  const rows: QuantCandidate[] = []
  const seen = new Set<string>()
  const add = (stock: Snapshot['leaders'][number], source: string, reason: string) => {
    if (seen.has(stock.code) || !/^(0|3|6)\d{5}$/.test(stock.code)) return
    if (stock.pct <= 0 || /跌停|大面/.test(reason) || /^[NC]/.test(stock.name)) return
    seen.add(stock.code)
    const affordable = stock.price > 0 && stock.price * 100 <= accountTotal * maxPct
    rows.push({ code: stock.code, name: stock.name, price: stock.price, pct: stock.pct, theme: stock.theme || '', source, reason, affordable })
  }
  for (const anchor of snapshot.anchors) add(anchor.stock, `情绪锚 · ${anchor.role}`, anchor.reason)
  for (const stock of snapshot.leaders.slice(0, 20)) add(stock, '强势股', stock.reason || '当日强势')
  return rows.sort((a, b) => b.pct - a.pct).slice(0, 30)
}

export function enrichQuantPool(codes: string[], candidates: QuantCandidate[], assignments: Record<string, string> = data.assignments): QuantPoolPayload {
  const map = new Map(candidates.map((x) => [x.code, x]))
  return {
    codes,
    assignments,
    items: codes.map((code) => ({ ...(map.get(code) ?? { code, name: code, price: 0, pct: 0, theme: '', source: '手工加入', reason: '等待行情', affordable: false }), strategyId: assignments[code] ?? null })),
    candidates,
    updatedAt: data.updatedAt || null,
  }
}

function load(): Stored {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Stored
    return { codes: Array.isArray(raw.codes) ? raw.codes : [], assignments: raw.assignments && typeof raw.assignments === 'object' ? raw.assignments : {}, updatedAt: raw.updatedAt || '' }
  } catch {
    return { codes: [], assignments: {}, updatedAt: '' }
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    atomicWriteJson(FILE, data)
  } catch {
    // best effort
  }
}
