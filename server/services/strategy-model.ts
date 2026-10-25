import type { QuantStrategyConfig, Snapshot } from '../../shared/types.js'

export interface StrategyModelContext {
  snapshot: Snapshot
  quote: { price: number; open: number; pct: number; amount: number; name: string }
  config: QuantStrategyConfig
  nowMin: number
}

export interface StrategyModelDecision {
  action: 'buy' | 'hold'
  score: number
  reason: string
}

export interface StrategyModel {
  kind: string
  label: string
  evaluate(ctx: StrategyModelContext): Promise<StrategyModelDecision> | StrategyModelDecision
}

/**
 * Generic text-rule model. It interprets the parsed model spec; it does not
 * branch on a fixed strategy name/id. Future model adapters (LLM, factor model,
 * external scoring service) can be registered under another `kind`.
 */
const ruleModel: StrategyModel = {
  kind: 'rule',
  label: '规则模型',
  evaluate({ snapshot, quote, config, nowMin }) {
    if (!config.stages.includes(snapshot.sentiment.stage)) return { action: 'hold', score: 0, reason: '情绪阶段不匹配' }
    if (snapshot.sentiment.score < config.minScore) return { action: 'hold', score: 0, reason: '情绪分数不足' }
    if (snapshot.sentiment.trend < 0) return { action: 'hold', score: 0, reason: '情绪趋势向下' }
    if (nowMin >= cutoffMinutes(config.entryCutoff)) return { action: 'hold', score: 0, reason: '超过买入截止时间' }
    if (!quote.price || quote.pct < config.entry.minPct || quote.pct > config.entry.maxPct) return { action: 'hold', score: 0, reason: '涨幅不在模型区间' }
    if (config.entry.priceAboveOpen && quote.price <= quote.open) return { action: 'hold', score: 0, reason: '价格未站上开盘价' }
    if (config.entry.pullback && quote.pct > config.entry.maxPct) return { action: 'hold', score: 0, reason: '回踩模型不追高' }
    // Daily breakout cannot be observed intraday without a daily high series;
    // the adapter leaves breakout confirmation to the backtest/next model.
    return { action: 'buy', score: quote.pct, reason: `模型命中：${config.name}` }
  },
}

const models = new Map<string, StrategyModel>([[ruleModel.kind, ruleModel]])

export function registerStrategyModel(model: StrategyModel) { models.set(model.kind, model) }
export function getStrategyModel(kind?: string): StrategyModel {
  const model = models.get(kind || 'rule')
  if (!model) throw new Error(`策略模型 ${kind} 未注册，拒绝执行`)
  return model
}
export function listStrategyModels(): Array<{ kind: string; label: string }> { return [...models.values()].map((m) => ({ kind: m.kind, label: m.label })) }

function cutoffMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 14 * 60 + 30
}
