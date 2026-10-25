import fs from 'node:fs'
import path from 'node:path'
import type { EtfAutoConfig } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'etf-auto-config.json')
const DEFAULTS: EtfAutoConfig = {
  stopLossPct: 1.2,
  maxDailyLossPct: 2,
  maxSwitchesPerDay: 1,
  cooldownSec: 600,
  flatTime: '14:55',
  flattenEnabled: true,
  maxOrderAmount: Number(process.env.ETF_MAX_ORDER_AMOUNT || 50_000),
  updatedAt: new Date().toISOString(),
}
let config: EtfAutoConfig = load()

export function getEtfAutoConfig(): EtfAutoConfig { return { ...config } }

export function saveEtfAutoConfig(input: Partial<EtfAutoConfig>): EtfAutoConfig {
  const next: EtfAutoConfig = {
    ...config,
    ...input,
    stopLossPct: clamp(Number(input.stopLossPct ?? config.stopLossPct), 0, 20),
    maxDailyLossPct: clamp(Number(input.maxDailyLossPct ?? config.maxDailyLossPct), 0.1, 20),
    maxSwitchesPerDay: Math.round(clamp(Number(input.maxSwitchesPerDay ?? config.maxSwitchesPerDay), 0, 100)),
    cooldownSec: Math.round(clamp(Number(input.cooldownSec ?? config.cooldownSec), 0, 86_400)),
    maxOrderAmount: clamp(Number(input.maxOrderAmount ?? config.maxOrderAmount), 100, 1_000_000),
    flatTime: /^\d{1,2}:\d{2}$/.test(String(input.flatTime ?? config.flatTime)) ? String(input.flatTime ?? config.flatTime) : config.flatTime,
    flattenEnabled: Boolean(input.flattenEnabled ?? config.flattenEnabled),
    updatedAt: new Date().toISOString(),
  }
  config = next
  atomicWriteJson(FILE, config)
  return getEtfAutoConfig()
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function load(): EtfAutoConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<EtfAutoConfig>
    return { ...DEFAULTS, ...raw, updatedAt: raw.updatedAt ?? new Date().toISOString() }
  } catch { return { ...DEFAULTS } }
}
