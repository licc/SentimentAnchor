import fs from 'node:fs'
import path from 'node:path'
import type { RiskConfig } from '../../../shared/types.js'
import { atomicWriteJson } from '../../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'risk-config.json')
const DEFAULTS: RiskConfig = {
  enabled: true,
  buy: {
    maxOrderAmount: 15_000,
    maxSymbolPct: 40,
    maxAccountExposurePct: 70,
    minCashReserve: 100,
    maxOrdersPerDay: 20,
    maxDailyLossPct: 3,
    duplicateWindowSec: 30,
    blockedCodes: [],
    blockSt: true,
    blockAnnouncementRisk: true,
    allowedSessions: ['09:30-11:30', '13:00-15:00'],
  },
  stop: { enabled: true, autoExecute: false, mode: 'fixed', thresholdPct: 3, trailingPct: 2, checkIntervalSec: 15 },
}

let config: RiskConfig = load()

export function getRiskConfig(): RiskConfig { return structuredClone(config) }

export function saveRiskConfig(input: Partial<RiskConfig>): RiskConfig {
  const next: RiskConfig = {
    ...config,
    ...input,
    buy: { ...config.buy, ...(input.buy ?? {}) },
    stop: { ...config.stop, ...(input.stop ?? {}) },
  }
  next.buy.maxOrderAmount = clamp(Number(next.buy.maxOrderAmount), 100, 1_000_000)
  next.buy.maxSymbolPct = clamp(Number(next.buy.maxSymbolPct), 1, 100)
  next.buy.maxAccountExposurePct = clamp(Number(next.buy.maxAccountExposurePct), 1, 100)
  next.buy.minCashReserve = clamp(Number(next.buy.minCashReserve), 0, 1_000_000)
  next.buy.maxOrdersPerDay = Math.round(clamp(Number(next.buy.maxOrdersPerDay), 1, 500))
  next.buy.maxDailyLossPct = clamp(Number(next.buy.maxDailyLossPct), 0.2, 20)
  next.buy.blockSt = next.buy.blockSt !== false
  next.buy.blockAnnouncementRisk = next.buy.blockAnnouncementRisk !== false
  next.buy.duplicateWindowSec = Math.round(clamp(Number(next.buy.duplicateWindowSec), 0, 3600))
  next.stop.mode = next.stop.mode === 'trailing' ? 'trailing' : 'fixed'
  next.stop.thresholdPct = clamp(Number(next.stop.thresholdPct), 0.5, 30)
  next.stop.trailingPct = clamp(Number(next.stop.trailingPct), 0.5, 30)
  next.stop.checkIntervalSec = Math.round(clamp(Number(next.stop.checkIntervalSec), 5, 300))
  config = next
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, config) } catch { /* best effort */ }
  return getRiskConfig()
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function load(): RiskConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<RiskConfig>
    return {
      ...DEFAULTS,
      ...raw,
      buy: { ...DEFAULTS.buy, ...(raw.buy ?? {}) },
      stop: { ...DEFAULTS.stop, ...(raw.stop ?? {}) },
    }
  } catch { return structuredClone(DEFAULTS) }
}
