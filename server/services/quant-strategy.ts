import fs from 'node:fs'
import path from 'node:path'
import type { QuantStrategyConfig, QuantStrategyId, QuantTextStrategy } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'

const FILE = path.join(process.cwd(), 'data', 'quant-strategies.json')

interface Store { activeId: string | null; strategies: QuantTextStrategy[] }
let store: Store = load()

export function listQuantStrategies(): QuantStrategyConfig[] {
  return store.strategies.filter((s) => s.status !== 'archived').map((s) => s.config)
}

export function getQuantStrategyById(id: string | null | undefined): QuantStrategyConfig | null {
  if (!id) return null
  const s = store.strategies.find((x) => x.id === id)
  return s ? s.config : null
}

export function getActiveQuantStrategy(): QuantStrategyConfig {
  const active = store.strategies.find((s) => s.id === store.activeId && s.status === 'active')
  if (active) return active.config
  const fallback = store.strategies.find((s) => s.status !== 'archived')
  return fallback?.config ?? defaultConfig('momentum')
}

export function parseCutoff(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 14 * 60 + 30
}

export function listStrategyDefinitions(): QuantTextStrategy[] {
  return store.strategies.map(clone)
}

export function getStrategySeed(): QuantStrategyId {
  return 'momentum'
}

export function createStrategy(input: { name: string; content: string }): QuantTextStrategy {
  const now = new Date().toISOString()
  const strategy: QuantTextStrategy = {
    id: `qs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: input.name.trim() || '未命名策略',
    content: input.content,
    status: 'draft',
    version: 1,
    createdAt: now,
    updatedAt: now,
    config: { ...parseStrategyText(input.content, defaultConfig('momentum')), name: input.name.trim() || '未命名策略' },
    history: [],
  }
  store.strategies.push(strategy)
  save()
  return clone(strategy)
}

export function updateStrategy(id: string, input: { name?: string; content?: string }): QuantTextStrategy {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('策略不存在')
  const content = input.content ?? s.content
  const name = (input.name ?? s.name).trim() || s.name
  const config = parseStrategyText(content, s.config)
  s.history = [...s.history.slice(-9), { version: s.version, content: s.content, config: s.config, savedAt: s.updatedAt }]
  s.version += 1
  s.content = content
  s.name = name
  config.name = name
  s.config = config
  s.updatedAt = new Date().toISOString()
  save()
  return clone(s)
}

export function activateStrategy(id: string): QuantTextStrategy {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('策略不存在')
  for (const x of store.strategies) if (x.status === 'active') x.status = 'draft'
  s.status = 'active'
  store.activeId = s.id
  s.updatedAt = new Date().toISOString()
  save()
  return clone(s)
}

export function duplicateStrategy(id: string): QuantTextStrategy {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('策略不存在')
  const copy = createStrategy({ name: `${s.name} 副本`, content: s.content })
  return copy
}

export function removeStrategy(id: string): void {
  const s = store.strategies.find((x) => x.id === id)
  if (!s) throw new Error('策略不存在')
  if (store.activeId === id) throw new Error('当前启用策略不能删除，请先启用其他策略')
  store.strategies = store.strategies.filter((x) => x.id !== id)
  save()
}

/** Human-readable text is the primary definition; parameters are parsed from it. */
export function parseStrategyText(content: string, base: QuantStrategyConfig): QuantStrategyConfig {
  const stop = firstNumber(content, [/(?:止损|亏)[^\d]{0,10}([\d.]+)\s*%/]) ?? base.stopLossPct
  const take = firstNumber(content, [/(?:止盈|赚)[^\d]{0,10}([\d.]+)\s*%/]) ?? base.takeProfitPct
  const hold = firstNumber(content, [/(?:持有|持仓)[^\d]{0,10}(\d+)\s*(?:个)?(?:交易)?日/]) ?? base.maxHoldDays
  const position = firstNumber(content, [/(?:单票|单只|仓位)[^\d]{0,10}([\d.]+)\s*%/]) ?? base.positionPct
  const score = firstNumber(content, [/(?:分数|评分)[^\d]{0,10}(\d+)/]) ?? base.minScore
  const cutoff = /(?:截止|不买|买入)[^\d]{0,10}(\d{1,2}:\d{2})/.exec(content)?.[1] ?? base.entryCutoff
  return {
    ...base,
    id: base.id,
    model: base.model || 'rule',
    name: base.name,
    stages: /修复|发酵|高潮/.test(content) ? ['修复', '发酵', '高潮'] : base.stages,
    minScore: clamp(score, 0, 100),
    stopLossPct: clamp(stop, 0.5, 20),
    takeProfitPct: clamp(take, 0.5, 50),
    maxHoldDays: Math.round(clamp(hold, 1, 30)),
    positionPct: clamp(position, 5, 70),
    entryCutoff: /^\d{1,2}:\d{2}$/.test(cutoff) ? cutoff : base.entryCutoff,
    entry: {
      priceAboveOpen: /站上开盘|高于开盘|开盘价/.test(content) || base.entry?.priceAboveOpen === true,
      minPct: firstNumber(content, [/涨幅[^\d]{0,8}([\d.]+)\s*%/]) ?? base.entry?.minPct ?? 0,
      maxPct: firstNumber(content, [/涨幅(?:不超过|不高于|≤|<=)?[^\d]{0,6}([\d.]+)\s*%/]) ?? 100,
      breakout20: /突破|新高/.test(content),
      pullback: /回踩|承接/.test(content),
    },
  }
}

function firstNumber(text: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) return Number(m[1])
  }
  return null
}

function clone(s: QuantTextStrategy): QuantTextStrategy {
  return JSON.parse(JSON.stringify(s)) as QuantTextStrategy
}

function defaultConfig(id: QuantStrategyId): QuantStrategyConfig {
  const seed = seedDefinitions().find((x) => x.config.id === id)!
  return seed.config
}

function seedDefinitions(): QuantTextStrategy[] {
  const now = new Date().toISOString()
  const rows: Array<{ id: QuantStrategyId; name: string; content: string }> = [
    {
      id: 'momentum', name: '情绪锚 · 龙头跟随',
      content: `# 情绪锚 · 龙头跟随

## 适用环境
市场情绪处于修复、发酵或高潮，情绪分数 >= 55，趋势 >= 0。

## 选股
只做人工确认加入 T+1 量化池的股票，选择当日涨幅最强且价格站上开盘价的一只。

## 买入
14:30 前买入，单票仓位 30%，账户总仓位不超过 70%，100 股起步。

## 退出
止损 3%，止盈 5%，最长持有 3 个交易日。T+1 当日买入不可卖出，不执行 14:55 强制清仓。`,
    },
    {
      id: 'trend', name: '情绪锚 · 趋势确认',
      content: `# 情绪锚 · 趋势确认

## 适用环境
情绪处于修复、发酵或高潮，分数 >= 50，趋势 >= 0。

## 选股
T+1 池内价格站上开盘价且保持相对强势的股票。

## 买入
14:30 前，单票 25%。

## 退出
止损 3%，止盈 6%，最长持有 4 日。T+1 当日不可卖出。`,
    },
    {
      id: 'breakout', name: '情绪锚 · 20日突破',
      content: `# 情绪锚 · 20日突破

## 适用环境
情绪处于修复、发酵或高潮，分数 >= 55。

## 选股
T+1 池内收盘突破过去 20 日最高价、且站上开盘价的股票。

## 买入
14:30 前，单票 25%，100 股起步。

## 退出
止损 3%，止盈 8%，最长持有 5 日。T+1 当日不可卖出。`,
    },
    {
      id: 'reversion', name: '情绪锚 · 回踩低吸',
      content: `# 情绪锚 · 回踩低吸

## 适用环境
情绪处于修复或发酵，分数 >= 48。

## 选股
T+1 池内回踩均线后重新站上开盘价、涨幅不超过 5% 的股票。

## 买入
14:30 前，单票 20%。

## 退出
止损 2%，止盈 3%，最长持有 2 日。T+1 当日不可卖出。`,
    },
    {
      id: 'pullback', name: '情绪锚 · 回踩承接',
      content: `# 情绪锚 · 回踩承接

## 适用环境
情绪处于修复或发酵，分数 >= 48，趋势 >= 0。

## 选股
T+1 池内回踩后重新站上开盘价、涨幅不超过 3% 的股票。

## 买入
14:30 前，单票 20%。

## 退出
止损 2.5%，止盈 4%，最长持有 2 日。T+1 当日不可卖出。`,
    },
  ]
  return rows.map((r, i) => {
    const config: QuantStrategyConfig = { id: r.id, model: 'rule', name: r.name, description: r.content.split('\n')[0].replace(/^#\s*/, ''), stages: ['修复', '发酵', '高潮'], minScore: r.id === 'momentum' ? 55 : r.id === 'trend' ? 50 : r.id === 'breakout' ? 55 : 48, stopLossPct: r.id === 'pullback' ? 2.5 : r.id === 'reversion' ? 2 : 3, takeProfitPct: r.id === 'momentum' ? 5 : r.id === 'trend' ? 6 : r.id === 'breakout' ? 8 : r.id === 'reversion' ? 3 : 4, maxHoldDays: r.id === 'momentum' ? 3 : r.id === 'trend' ? 4 : r.id === 'breakout' ? 5 : 2, positionPct: r.id === 'momentum' ? 30 : r.id === 'trend' ? 25 : 20, entryCutoff: '14:30', entry: { priceAboveOpen: true, minPct: 0, maxPct: r.id === 'pullback' ? 3 : r.id === 'reversion' ? 5 : 100, breakout20: r.id === 'breakout', pullback: r.id === 'pullback' || r.id === 'reversion' } }
    return { id: `qs-seed-${r.id}`, name: r.name, content: r.content, status: i === 0 ? 'active' : 'draft', version: 1, createdAt: now, updatedAt: now, config: parseStrategyText(r.content, config), history: [] } as QuantTextStrategy
  })
}

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store
    if (Array.isArray(raw.strategies) && raw.strategies.length) {
      for (const s of raw.strategies) s.config = parseStrategyText(s.content, s.config)
      for (const seed of seedDefinitions()) if (!raw.strategies.some((s) => s.id === seed.id)) raw.strategies.push(seed)
      return raw
    }
  } catch { /* seed below */ }
  const strategies = seedDefinitions()
  const store = { activeId: strategies.find((s) => s.status === 'active')?.id ?? null, strategies }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, store) } catch { /* best effort */ }
  return store
}

function save() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); atomicWriteJson(FILE, store) } catch { /* best effort */ }
}

export function saveQuantStrategy(input: { active?: string; config?: Partial<QuantStrategyConfig> }): QuantStrategyConfig {
  const active = store.strategies.find((s) => s.id === store.activeId)
  if (!active) throw new Error('当前没有启用策略')
  if (input.config) active.config = { ...active.config, ...input.config }
  active.updatedAt = new Date().toISOString()
  save()
  return active.config
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }
