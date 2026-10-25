import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

export interface CoordinatorConfig {
  t0MaxPct: number
  t1MaxPct: number
  accountMaxPct: number
  reserveCash: number
  priority: 't0' | 't1' | 'equal'
  updatedAt: string
}
const FILE = path.join(process.cwd(), 'data', 'coordinator-config.json')
let config: CoordinatorConfig = load()

export function getCoordinatorConfig(): CoordinatorConfig { return { ...config } }
export function saveCoordinatorConfig(input: Partial<CoordinatorConfig>): CoordinatorConfig {
  config = {
    ...config,
    t0MaxPct: clamp(Number(input.t0MaxPct ?? config.t0MaxPct), 0, 100),
    t1MaxPct: clamp(Number(input.t1MaxPct ?? config.t1MaxPct), 0, 100),
    accountMaxPct: clamp(Number(input.accountMaxPct ?? config.accountMaxPct), 1, 100),
    reserveCash: clamp(Number(input.reserveCash ?? config.reserveCash), 0, 100_000),
    priority: input.priority === 't0' || input.priority === 't1' || input.priority === 'equal' ? input.priority : config.priority,
    updatedAt: new Date().toISOString(),
  }
  atomicWriteJson(FILE, config)
  return getCoordinatorConfig()
}

export function engineOf(source: string): 't0' | 't1' | 'manual' {
  if (source.startsWith('t0')) return 't0'
  if (source.startsWith('t1')) return 't1'
  return 'manual'
}

export function checkEngineBudget(input: {
  source: string
  symbol: string
  price: number
  quantity: number
  totalAsset: number
  cashAvailable: number
  positions: Array<{ symbol: string; marketValue: number }>
  pendingBuyNotional?: number
}): { passed: boolean; detail: string } {
  const engine = engineOf(input.source)
  const value = input.positions.filter((p) => (engine === 't0' ? isEtf(p.symbol) : engine === 't1' ? !isEtf(p.symbol) : true)).reduce((sum, p) => sum + (p.marketValue || 0), 0)
  const capPct = effectiveEngineCapPct(engine, input.totalAsset > 0 ? value / input.totalAsset * 100 : 0)
  const cap = input.totalAsset * capPct / 100
  const pending = input.pendingBuyNotional ?? 0
  const after = value + pending + input.price * input.quantity
  if (after > cap) return { passed: false, detail: `${engine === 't0' ? 'T+0' : engine === 't1' ? 'T+1' : '手动'} 额度不足：${after.toFixed(0)} > ${cap.toFixed(0)}` }
  if (input.cashAvailable - pending - input.price * input.quantity < config.reserveCash) return { passed: false, detail: `现金低于保留额度 ¥${config.reserveCash}` }
  return { passed: true, detail: '通过' }
}

export function effectiveEngineCapPct(engine: 't0' | 't1' | 'manual', usedPct = 0): number {
  if (engine === 'manual') return config.accountMaxPct
  if (config.priority === 'equal') return engine === 't0' ? config.t0MaxPct : config.t1MaxPct
  if (config.priority === engine) return engine === 't0' ? config.t0MaxPct : config.t1MaxPct
  const reserved = config.priority === 't0' ? config.t0MaxPct : config.t1MaxPct
  const own = engine === 't0' ? config.t0MaxPct : config.t1MaxPct
  return Math.max(0, Math.min(own, config.accountMaxPct - reserved, config.accountMaxPct - usedPct))
}

export function isEtf(symbol: string): boolean { return /^(5|1[5-8])/.test(symbol) }

export interface CoordinatorUsage {
  config: CoordinatorConfig
  account: { totalAsset: number; cashAvailable: number; marketValue: number }
  t0: { used: number; cap: number; remaining: number; pct: number }
  t1: { used: number; cap: number; remaining: number; pct: number }
  accountExposure: { used: number; cap: number; remaining: number; pct: number }
}

export function coordinatorUsage(input: { totalAsset: number; cashAvailable: number; positions: Array<{ symbol: string; marketValue: number }> }): CoordinatorUsage {
  const t0Used = input.positions.filter((p) => isEtf(p.symbol)).reduce((sum, p) => sum + (p.marketValue || 0), 0)
  const t1Used = input.positions.filter((p) => !isEtf(p.symbol)).reduce((sum, p) => sum + (p.marketValue || 0), 0)
  const t0Cap = input.totalAsset * config.t0MaxPct / 100
  const t1Cap = input.totalAsset * config.t1MaxPct / 100
  const accountCap = input.totalAsset * config.accountMaxPct / 100
  return {
    config,
    account: { totalAsset: input.totalAsset, cashAvailable: input.cashAvailable, marketValue: t0Used + t1Used },
    t0: { used: t0Used, cap: t0Cap, remaining: Math.max(0, t0Cap - t0Used), pct: input.totalAsset ? (t0Used / input.totalAsset) * 100 : 0 },
    t1: { used: t1Used, cap: t1Cap, remaining: Math.max(0, t1Cap - t1Used), pct: input.totalAsset ? (t1Used / input.totalAsset) * 100 : 0 },
    accountExposure: { used: t0Used + t1Used, cap: accountCap, remaining: Math.max(0, accountCap - t0Used - t1Used), pct: input.totalAsset ? ((t0Used + t1Used) / input.totalAsset) * 100 : 0 },
  }
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)) }
function load(): CoordinatorConfig {
  try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<CoordinatorConfig>; return { t0MaxPct: Number(raw.t0MaxPct ?? 50), t1MaxPct: Number(raw.t1MaxPct ?? 30), accountMaxPct: Number(raw.accountMaxPct ?? 70), reserveCash: Number(raw.reserveCash ?? 100), priority: (raw.priority === 't0' || raw.priority === 't1' ? raw.priority : 'equal'), updatedAt: raw.updatedAt ?? new Date().toISOString() } } catch { return { t0MaxPct: 50, t1MaxPct: 30, accountMaxPct: 70, reserveCash: 100, priority: 'equal', updatedAt: new Date().toISOString() } }
}
