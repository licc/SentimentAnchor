import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteJson } from '../lib/atomic.js'

export interface RuntimeConfig {
  brokerUrl: string
  brokerKey: string
  orderTimeoutMs: number
  statusTtlMs: number
  maxManualOrderAmount: number
  updatedAt: string
}

const FILE = path.join(process.cwd(), 'data', 'runtime-config.json')
const ENV_DEFAULTS: RuntimeConfig = {
  brokerUrl: (process.env.ETF_BROKER_URL || 'http://127.0.0.1:8888').replace(/\/$/, ''),
  brokerKey: process.env.ETF_BROKER_KEY || '',
  orderTimeoutMs: Math.max(5_000, Number(process.env.ETF_ORDER_TIMEOUT_MS || 20_000)),
  statusTtlMs: Math.max(1_000, Number(process.env.ETF_STATUS_TTL_MS || 8_000)),
  maxManualOrderAmount: Math.max(100, Number(process.env.ETF_MAX_ORDER_AMOUNT || 50_000)),
  updatedAt: new Date().toISOString(),
}

let config: RuntimeConfig = load()

export function getRuntimeConfig(): RuntimeConfig { return { ...config } }
export function publicRuntimeConfig() {
  return {
    brokerUrl: config.brokerUrl,
    brokerKeyConfigured: Boolean(config.brokerKey),
    brokerKeyMasked: config.brokerKey ? `${config.brokerKey.slice(0, 3)}••••${config.brokerKey.slice(-4)}` : '',
    orderTimeoutMs: config.orderTimeoutMs,
    statusTtlMs: config.statusTtlMs,
    maxManualOrderAmount: config.maxManualOrderAmount,
    updatedAt: config.updatedAt,
  }
}

export function saveRuntimeConfig(input: Partial<RuntimeConfig> & { brokerKey?: string; clearBrokerKey?: boolean }): ReturnType<typeof publicRuntimeConfig> {
  const brokerUrl = String(input.brokerUrl ?? config.brokerUrl).trim().replace(/\/$/, '')
  if (!/^https?:\/\/[^\s]+$/i.test(brokerUrl)) throw new Error('交易接口地址必须是 http/https URL')
  const brokerKey = input.clearBrokerKey ? '' : (typeof input.brokerKey === 'string' && input.brokerKey.trim() ? input.brokerKey.trim() : config.brokerKey)
  config = {
    ...config,
    brokerUrl,
    brokerKey,
    orderTimeoutMs: clamp(Number(input.orderTimeoutMs ?? config.orderTimeoutMs), 5_000, 120_000),
    statusTtlMs: clamp(Number(input.statusTtlMs ?? config.statusTtlMs), 1_000, 60_000),
    maxManualOrderAmount: clamp(Number(input.maxManualOrderAmount ?? config.maxManualOrderAmount), 100, 10_000_000),
    updatedAt: new Date().toISOString(),
  }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, config) } catch { /* best effort */ }
  return publicRuntimeConfig()
}

function load(): RuntimeConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<RuntimeConfig>
    return {
      ...ENV_DEFAULTS,
      ...raw,
      // Explicit environment variables win over the page config (useful for mocks/deployments).
      brokerUrl: String(process.env.ETF_BROKER_URL || raw.brokerUrl || ENV_DEFAULTS.brokerUrl).replace(/\/$/, ''),
      brokerKey: String(process.env.ETF_BROKER_KEY || raw.brokerKey || ENV_DEFAULTS.brokerKey),
      orderTimeoutMs: Math.max(5_000, Number(process.env.ETF_ORDER_TIMEOUT_MS || raw.orderTimeoutMs || ENV_DEFAULTS.orderTimeoutMs)),
      statusTtlMs: Math.max(1_000, Number(process.env.ETF_STATUS_TTL_MS || raw.statusTtlMs || ENV_DEFAULTS.statusTtlMs)),
      maxManualOrderAmount: Math.max(100, Number(process.env.ETF_MAX_ORDER_AMOUNT || raw.maxManualOrderAmount || ENV_DEFAULTS.maxManualOrderAmount)),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    }
  } catch { return { ...ENV_DEFAULTS } }
}
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a)) }
