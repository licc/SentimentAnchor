import fs from 'node:fs'
import path from 'node:path'
import type { EtfRole, EtfStrategyConfig, EtfUniverseItem } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'etf-config.json')
const ROLES: EtfRole[] = ['risk', 'hedge', 'defensive', 'cash']

export const DEFAULT_ETF_UNIVERSE: EtfUniverseItem[] = [
  { code: '513310', role: 'risk' },
  { code: '159981', role: 'risk' },
  { code: '513090', role: 'risk' },
  { code: '518880', role: 'hedge' },
]
let config: EtfStrategyConfig = load()

export function getEtfConfig(): EtfStrategyConfig {
  return { universe: [...config.universe], updatedAt: config.updatedAt }
}

export function saveEtfConfig(input: { universe?: unknown }): EtfStrategyConfig {
  if (!Array.isArray(input.universe)) throw new Error('ETF 池格式不正确')
  const seen = new Set<string>()
  const universe: EtfUniverseItem[] = []
  for (const item of input.universe) {
    if (!item || typeof item !== 'object') continue
    const code = String((item as { code?: unknown }).code ?? '').trim()
    const role = String((item as { role?: unknown }).role ?? 'risk') as EtfRole
    if (!/^\d{6}$/.test(code)) throw new Error(`ETF 代码必须是 6 位数字：${code || '空'}`)
    if (seen.has(code)) throw new Error(`ETF 代码重复：${code}`)
    if (!ROLES.includes(role)) throw new Error(`ETF 角色不正确：${role}`)
    seen.add(code)
    universe.push({ code, role })
  }
  if (universe.length === 0) throw new Error('至少保留 1 只 ETF')
  if (universe.length > 12) throw new Error('ETF 池最多 12 只')
  config = { universe, updatedAt: new Date().toISOString() }
  atomicWriteJson(FILE, config)
  return getEtfConfig()
}

export function resetEtfConfig(): EtfStrategyConfig {
  config = { universe: DEFAULT_ETF_UNIVERSE.map((x) => ({ ...x })), updatedAt: new Date().toISOString() }
  atomicWriteJson(FILE, config)
  return getEtfConfig()
}

function load(): EtfStrategyConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<EtfStrategyConfig>
    if (Array.isArray(raw.universe) && raw.universe.length) {
      const universe = raw.universe
        .map((x) => ({ code: String(x.code ?? ''), role: String(x.role ?? 'risk') as EtfRole }))
        .filter((x) => /^\d{6}$/.test(x.code) && ROLES.includes(x.role))
      if (universe.length) return { universe, updatedAt: raw.updatedAt ?? new Date().toISOString() }
    }
  } catch {
    // use defaults
  }
  return { universe: DEFAULT_ETF_UNIVERSE.map((x) => ({ ...x })), updatedAt: new Date().toISOString() }
}
