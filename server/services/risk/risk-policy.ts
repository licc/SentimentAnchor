import fs from 'node:fs'
import path from 'node:path'
import type { RiskConfig } from '../../../shared/types.js'
import { atomicWriteJson } from '../../lib/atomic.js'
import { getRiskConfig } from './risk-config.js'

export type RiskRuleId = 'session' | 'quote' | 'st' | 'announcement' | 'price' | 'lot' | 'order-limit' | 'cash' | 'symbol-exposure' | 'account-exposure' | 'daily-loss' | 'data-freshness' | 'pending-buys' | 'engine-budget' | 'blocked-code' | 'daily-limit' | 'duplicate' | 'intraday-structure' | 'volume-price' | 'intraday-redflags' | 'buy-point' | 'chase'
export type RiskScope = 'all' | 'manual' | 't0' | 't1'
export interface RiskPolicyRule { id: RiskRuleId; enabled: boolean; severity: 'block' | 'warn'; label: string; params: Record<string, number | string | string[] | boolean> }
export interface RiskPolicy { id: string; name: string; description: string; scope: RiskScope; status: 'active' | 'draft'; version: number; rules: RiskPolicyRule[]; updatedAt: string }
interface Store { activeByScope: Record<RiskScope, string | null>; policies: RiskPolicy[] }
const FILE = path.join(process.cwd(), 'data', 'risk-policies.json')
const LABELS: Record<RiskRuleId, string> = {
  session: '交易时段', quote: '行情可用 / 停牌', st: 'ST / 退市风险', announcement: '公告风险', price: '价格有效', lot: '整手',
  'order-limit': '单笔金额', cash: '可用资金', 'symbol-exposure': '单票集中度', 'account-exposure': '账户总仓位', 'daily-loss': '当日亏损熔断',
  'data-freshness': '行情新鲜度', 'pending-buys': '在途买入', 'engine-budget': '策略额度', 'blocked-code': '黑名单', 'daily-limit': '当日买入次数', duplicate: '重复委托',
  'intraday-structure': '分时结构：价 > 均价线', 'volume-price': '量价配合', 'intraday-redflags': '分时红旗', 'buy-point': '有效买点 B1/B3/B4', chase: '追高保护',
}
const ORDER: RiskRuleId[] = ['session', 'quote', 'st', 'announcement', 'price', 'lot', 'order-limit', 'cash', 'symbol-exposure', 'account-exposure', 'daily-loss', 'data-freshness', 'pending-buys', 'engine-budget', 'blocked-code', 'daily-limit', 'duplicate', 'intraday-structure', 'volume-price', 'intraday-redflags', 'buy-point', 'chase']
const DEFAULT_SCOPE: RiskScope = 'all'
const HARD_RULES: RiskRuleId[] = ['session', 'quote', 'price', 'lot', 'cash', 'account-exposure', 'daily-loss', 'data-freshness', 'duplicate']
export function hardRuleViolations(rules: RiskPolicyRule[]): string[] {
  return HARD_RULES.filter((id) => { const r = rules.find((x) => x.id === id); return !r || !r.enabled || r.severity !== 'block' }).map((id) => LABELS[id])
}
let store: Store = load()

function defaultParams(c: RiskConfig): Record<RiskRuleId, Record<string, number | string | string[] | boolean>> {
  return {
    session: { allowedSessions: c.buy.allowedSessions },
    quote: {}, st: {}, announcement: {}, price: {}, lot: {}, 'order-limit': { maxOrderAmount: c.buy.maxOrderAmount },
    cash: { minCashReserve: c.buy.minCashReserve }, 'symbol-exposure': { maxSymbolPct: c.buy.maxSymbolPct },
    'account-exposure': { maxAccountExposurePct: c.buy.maxAccountExposurePct }, 'daily-loss': { maxDailyLossPct: c.buy.maxDailyLossPct },
    'data-freshness': { maxAgeSec: 30 }, 'pending-buys': {}, 'engine-budget': {}, 'blocked-code': { blockedCodes: c.buy.blockedCodes },
    'daily-limit': { maxOrdersPerDay: c.buy.maxOrdersPerDay }, duplicate: { duplicateWindowSec: c.buy.duplicateWindowSec },
    'intraday-structure': { minAboveRatio: 50, requirePriceAboveVwap: true }, 'volume-price': { minUpDownVolumeRatio: 1.2 },
    'intraday-redflags': { maxRedFlags: 1 }, 'buy-point': { requireSignal: true }, chase: { maxAboveVwapPct: 3 },
  }
}
function rulesFor(c: RiskConfig): RiskPolicyRule[] { return ORDER.map((id) => ({ id, label: LABELS[id], enabled: true, severity: ['intraday-structure','volume-price','buy-point'].includes(id) ? 'warn' : 'block', params: defaultParams(c)[id] })) }

export function getRiskPolicies() { return { activeByScope: { ...store.activeByScope }, policies: store.policies.map((p) => structuredClone(p)) } }
export function getActiveRiskPolicy(source: string): RiskPolicy {
  const key: Exclude<RiskScope, 'all'> = source.startsWith('t0') ? 't0' : source.startsWith('t1') ? 't1' : 'manual'
  const id = store.activeByScope[key] ?? store.activeByScope.all
  return structuredClone(store.policies.find((p) => p.id === id) ?? store.policies[0])
}
export function saveRiskPolicy(id: string, input: { rules?: RiskPolicyRule[]; name?: string; description?: string; scope?: RiskScope }): RiskPolicy {
  const policy = store.policies.find((p) => p.id === id)
  if (!policy) throw new Error('风控编排不存在')
  const nextRules = Array.isArray(input.rules) ? policy.rules.map((r) => { const next = input.rules!.find((x) => x.id === r.id); return next ? { ...r, enabled: Boolean(next.enabled), severity: (next.severity === 'warn' ? 'warn' : 'block') as 'block' | 'warn', params: { ...r.params, ...(next.params ?? {}) } } : r }) : policy.rules
  const violations = hardRuleViolations(nextRules)
  if (violations.length) throw new Error(`以下硬风控不能关闭或降为告警：${violations.join('、')}`)
  policy.rules = nextRules
  if (input.name) policy.name = input.name.slice(0, 40)
  if (input.description != null) policy.description = String(input.description).slice(0, 300)
  if (input.scope && ['all', 'manual', 't0', 't1'].includes(input.scope)) policy.scope = input.scope
  policy.version += 1
  policy.updatedAt = new Date().toISOString()
  save()
  return structuredClone(policy)
}
export function activateRiskPolicy(id: string): RiskPolicy {
  const policy = store.policies.find((p) => p.id === id)
  if (!policy) throw new Error('风控编排不存在')
  for (const p of store.policies) p.status = p.id === id ? 'active' : 'draft'
  store.activeByScope[policy.scope] = id
  if (policy.scope === 'all') {
    store.activeByScope.manual = id; store.activeByScope.t0 = id; store.activeByScope.t1 = id
  }
  policy.updatedAt = new Date().toISOString()
  save()
  return structuredClone(policy)
}
export function applyPolicyConfig(source: string, base: RiskConfig): RiskConfig {
  const policy = getActiveRiskPolicy(source)
  const map = new Map(policy.rules.map((r) => [r.id, r]))
  const p = (id: RiskRuleId) => map.get(id)?.params ?? {}
  const num = (v: unknown, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback
  const list = (v: unknown, fallback: string[]) => Array.isArray(v) ? v.map(String) : fallback
  return {
    ...base,
    buy: {
      ...base.buy,
      maxOrderAmount: num(p('order-limit').maxOrderAmount, base.buy.maxOrderAmount),
      minCashReserve: num(p('cash').minCashReserve, base.buy.minCashReserve),
      maxSymbolPct: num(p('symbol-exposure').maxSymbolPct, base.buy.maxSymbolPct),
      maxAccountExposurePct: num(p('account-exposure').maxAccountExposurePct, base.buy.maxAccountExposurePct),
      maxDailyLossPct: num(p('daily-loss').maxDailyLossPct, base.buy.maxDailyLossPct),
      maxOrdersPerDay: num(p('daily-limit').maxOrdersPerDay, base.buy.maxOrdersPerDay),
      duplicateWindowSec: num(p('duplicate').duplicateWindowSec, base.buy.duplicateWindowSec),
      blockedCodes: list(p('blocked-code').blockedCodes, base.buy.blockedCodes),
      allowedSessions: list(p('session').allowedSessions, base.buy.allowedSessions),
    },
  }
}

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store | { activeId: string; policies: RiskPolicy[] }
    if ('policies' in raw && raw.policies?.length) {
      const activeId = 'activeId' in raw ? raw.activeId : null
      const policies = raw.policies.map((p) => normalize(p, activeId))
      const activeByScope = 'activeByScope' in raw ? raw.activeByScope : { all: activeId, manual: activeId, t0: null, t1: null }
      const c = getRiskConfig(); const now = new Date().toISOString()
      for (const scope of ['t0', 't1'] as const) {
        if (!policies.some((p) => p.scope === scope)) policies.push({ id: `risk-policy-${scope}`, name: `${scope === 't0' ? 'T+0' : 'T+1'} 买入编排`, description: `${scope.toUpperCase()} 专用风控组合。`, scope, status: 'draft', version: 1, updatedAt: now, rules: rulesFor(c) })
      }
      return { activeByScope, policies }
    }
  } catch { /* seed */ }
  const c = getRiskConfig()
  const now = new Date().toISOString()
  const standard: RiskPolicy = { id: 'risk-policy-standard', name: '标准买入编排', description: '所有前置风险按顺序检查，任一硬规则失败即拦截。', scope: 'all', status: 'active', version: 1, updatedAt: now, rules: rulesFor(c) }
  const t0: RiskPolicy = { id: 'risk-policy-t0', name: 'T+0 买入编排', description: 'T+0 ETF 专用风控组合。', scope: 't0', status: 'draft', version: 1, updatedAt: now, rules: rulesFor(c) }
  const t1: RiskPolicy = { id: 'risk-policy-t1', name: 'T+1 买入编排', description: 'T+1 股票专用风控组合。', scope: 't1', status: 'draft', version: 1, updatedAt: now, rules: rulesFor(c) }
  const created: Store = { activeByScope: { all: standard.id, manual: standard.id, t0: null, t1: null }, policies: [standard, t0, t1] }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, created) } catch { /* best effort */ }
  return created
}
function normalize(p: RiskPolicy, activeId: string | null): RiskPolicy {
  const c = getRiskConfig(); const dp = defaultParams(c)
  return {
    ...p, scope: p.scope ?? DEFAULT_SCOPE, status: p.id === activeId ? 'active' : p.status,
    rules: ORDER.map((id) => { const old = p.rules?.find((r) => r.id === id); return { id, label: LABELS[id], enabled: old?.enabled !== false, severity: old?.severity === 'warn' ? 'warn' : 'block', params: { ...dp[id], ...(old?.params ?? {}) } } }),
  }
}
function save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, store) } catch { /* best effort */ } }
