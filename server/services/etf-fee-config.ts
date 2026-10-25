import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

export interface EtfFeeSettings {
  maxDailyFeePct: number
  maxDailyFeeAmount: number
  updatedAt: string
}

const FILE = path.join(process.cwd(), 'data', 'etf-fee-config.json')
let settings: EtfFeeSettings = load()

export function getEtfFeeSettings(): EtfFeeSettings {
  return { ...settings }
}

export function saveEtfFeeSettings(input: { maxDailyFeePct?: unknown; maxDailyFeeAmount?: unknown }): EtfFeeSettings {
  const pct = Number(input.maxDailyFeePct ?? settings.maxDailyFeePct)
  const amount = Number(input.maxDailyFeeAmount ?? settings.maxDailyFeeAmount)
  settings = {
    maxDailyFeePct: Math.max(0.01, Math.min(5, Number.isFinite(pct) ? pct : 0.3)),
    maxDailyFeeAmount: Math.max(0, Math.min(100_000, Number.isFinite(amount) ? amount : 0)),
    updatedAt: new Date().toISOString(),
  }
  atomicWriteJson(FILE, settings)
  return getEtfFeeSettings()
}

export function dailyFeeCap(totalAsset: number): number {
  if (settings.maxDailyFeeAmount > 0) return settings.maxDailyFeeAmount
  return Math.round(totalAsset * settings.maxDailyFeePct) / 100
}

function load(): EtfFeeSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<EtfFeeSettings>
    return {
      maxDailyFeePct: Number(raw.maxDailyFeePct) > 0 ? Number(raw.maxDailyFeePct) : Number(process.env.ETF_MAX_DAILY_FEE_PCT ?? 0.3),
      maxDailyFeeAmount: Number(raw.maxDailyFeeAmount) > 0 ? Number(raw.maxDailyFeeAmount) : 0,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return { maxDailyFeePct: Number(process.env.ETF_MAX_DAILY_FEE_PCT ?? 0.3), maxDailyFeeAmount: 0, updatedAt: new Date().toISOString() }
  }
}
