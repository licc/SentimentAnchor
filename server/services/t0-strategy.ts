import fs from 'node:fs'
import path from 'node:path'
import type { T0StrategyConfig, T0StrategyDefinition, T0StrategyPayload } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 't0-strategies.json')
interface Store { activeId: string | null; strategies: T0StrategyDefinition[] }
let store: Store = load()

export function createT0Strategy(name: string, content: string): T0StrategyDefinition {
  const now = new Date().toISOString()
  const strategy: T0StrategyDefinition = {
    id: `t0-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: name.trim() || 'AI T+0 策略',
    content,
    status: 'draft',
    version: 1,
    updatedAt: now,
    config: parseT0Strategy(content, { stages: ['修复', '发酵', '高潮'], riskOnScore: 55, riskOffScore: 42, riskOnPositionPct: 0.5, riskOffPositionPct: 0.3, allowRisk: true }),
  }
  store.strategies.push(strategy)
  save()
  return structuredClone(strategy)
}

export function getT0Strategies(): T0StrategyPayload {
  return { activeId: store.activeId, strategies: store.strategies.map((s) => structuredClone(s)) }
}

export function getActiveT0Strategy(): T0StrategyDefinition {
  return store.strategies.find((s) => s.id === store.activeId && s.status === 'active') ?? store.strategies[0]
}

export function saveT0Strategy(id: string, content: string): T0StrategyDefinition {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('T+0 策略不存在')
  s.content = content
  s.config = parseT0Strategy(content, s.config)
  s.version += 1
  s.updatedAt = new Date().toISOString()
  save()
  return structuredClone(s)
}

export function activateT0Strategy(id: string): T0StrategyDefinition {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('T+0 策略不存在')
  for (const x of store.strategies) x.status = x.id === id ? 'active' : 'draft'
  store.activeId = id
  save()
  return structuredClone(s)
}

export function parseT0Strategy(content: string, base: T0StrategyConfig): T0StrategyConfig {
  const riskOn = num(content, /(?:进攻|风险开关)[^\d]{0,10}(\d+)/) ?? base.riskOnScore
  const riskOff = num(content, /(?:防守|退潮)[^\d]{0,10}(\d+)/) ?? base.riskOffScore
  const onPos = num(content, /进攻[^\d]{0,10}(\d+(?:\.\d+)?)\s*%/) ?? base.riskOnPositionPct * 100
  const offPos = num(content, /防守[^\d]{0,10}(\d+(?:\.\d+)?)\s*%/) ?? base.riskOffPositionPct * 100
  return {
    ...base,
    stages: /修复|发酵|高潮/.test(content) ? ['修复', '发酵', '高潮'] : base.stages,
    riskOnScore: clamp(riskOn, 0, 100),
    riskOffScore: clamp(riskOff, 0, 100),
    riskOnPositionPct: clamp(onPos, 0, 100) / 100,
    riskOffPositionPct: clamp(offPos, 0, 100) / 100,
    allowRisk: /只做防守|只做黄金|不碰风险/.test(content) ? false : base.allowRisk,
  }
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)) }
function num(text: string, re: RegExp): number | null { const m = re.exec(text); return m ? Number(m[1]) : null }

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store
    if (Array.isArray(raw.strategies) && raw.strategies.length) return raw
  } catch { /* seed */ }
  const now = new Date().toISOString()
  const seeds: Array<{ id: string; name: string; content: string; config: T0StrategyConfig }> = [
    {
      id: 't0-rotation', name: '情绪锚 · T+0 情绪轮动',
      content: `# 情绪锚 · T+0 情绪轮动\n\n## 进攻\n情绪处于修复/发酵/高潮，进攻分数 >= 55，趋势 >= 0。\n进攻仓位 50%。\n\n## 防守\n退潮/冰点，或防守分数 < 42，转向黄金/现金。\n防守仓位 30%。\n\n## 执行\n只做 T+0 ETF，14:55 清仓，止损 1.2%。`,
      config: { stages: ['修复', '发酵', '高潮'], riskOnScore: 55, riskOffScore: 42, riskOnPositionPct: 0.5, riskOffPositionPct: 0.3, allowRisk: true },
    },
    {
      id: 't0-defense', name: '情绪锚 · T+0 防守优先',
      content: `# 情绪锚 · T+0 防守优先\n\n## 进攻\n只在发酵/高潮，进攻分数 >= 65 时做风险 ETF。\n进攻仓位 30%。\n\n## 防守\n退潮/冰点，防守分数 < 50，转向黄金/现金。\n防守仓位 20%。\n\n## 执行\n只做 T+0 ETF，14:55 清仓，止损 1.2%。`,
      config: { stages: ['发酵', '高潮'], riskOnScore: 65, riskOffScore: 50, riskOnPositionPct: 0.3, riskOffPositionPct: 0.2, allowRisk: true },
    },
    {
      id: 't0-hedge', name: '情绪锚 · T+0 只做防守',
      content: `# 情绪锚 · T+0 只做防守\n\n## 防守\n只做黄金/防守 ETF，不碰风险 ETF。\n防守仓位 30%。\n\n## 执行\n只做 T+0 ETF，14:55 清仓。`,
      config: { stages: ['修复', '发酵', '高潮'], riskOnScore: 55, riskOffScore: 42, riskOnPositionPct: 0.3, riskOffPositionPct: 0.3, allowRisk: false },
    },
  ]
  const strategies = seeds.map((s, i) => ({ ...s, status: i === 0 ? 'active' as const : 'draft' as const, version: 1, updatedAt: now }))
  const created: Store = { activeId: strategies[0].id, strategies }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, created) } catch { /* best effort */ }
  return created
}

function save() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, store) } catch { /* best effort */ }
}
