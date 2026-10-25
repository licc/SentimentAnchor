import type { QuantBacktestResult, QuantRobustnessResult, QuantStrategyConfig } from '../../shared/types.js'
import { getActiveQuantStrategy, getQuantStrategyById } from './quant-strategy.js'
import { runQuantBacktest } from './quant-backtest.js'
import { recordStrategyQuality } from './strategy-quality.js'

export async function runQuantRobustness(input: { code: string; days?: number; strategyId?: string }): Promise<QuantRobustnessResult> {
  const base = (input.strategyId ? getQuantStrategyById(input.strategyId) : null) ?? getActiveQuantStrategy()
  const variants: Array<{ label: string; strategy: QuantStrategyConfig }> = [
    { label: '基准', strategy: base },
    { label: '止损 -0.5%', strategy: { ...base, stopLossPct: Math.max(0.5, base.stopLossPct - 0.5) } },
    { label: '止损 +0.5%', strategy: { ...base, stopLossPct: Math.min(10, base.stopLossPct + 0.5) } },
    { label: '止盈 -1%', strategy: { ...base, takeProfitPct: Math.max(0.5, base.takeProfitPct - 1) } },
    { label: '止盈 +1%', strategy: { ...base, takeProfitPct: Math.min(20, base.takeProfitPct + 1) } },
  ]
  const results = await Promise.all(variants.map(async (v) => ({ label: v.label, result: await runQuantBacktest({ code: input.code, strategy: v.strategy, days: input.days ?? 180 }) })))
  const baseResult = results[0].result
  const positives = results.filter((r) => r.result.returnPct > 0).length
  const payload = {
    code: input.code,
    base: summarize(baseResult),
    variants: results.map((r) => ({ ...summarize(r.result), label: r.label, returnDeltaPct: round2(r.result.returnPct - baseResult.returnPct) })),
    positiveRatio: results.length ? round2((positives / results.length) * 100) : 0,
    note: positives === results.length ? '参数邻域全部为正，稳定性较好' : positives === 0 ? '参数邻域全部为负，策略可能失效' : '参数邻域部分为正，存在参数敏感性',
  }
  recordStrategyQuality({ strategyId: input.strategyId || base.id, code: input.code, days: input.days ?? 180, positiveRatio: payload.positiveRatio, note: payload.note })
  return payload
}

function summarize(r: QuantBacktestResult) {
  return { returnPct: r.returnPct, maxDrawdownPct: r.maxDrawdownPct, winRate: r.winRate, trades: r.trades.length }
}
function round2(n: number) { return Math.round(n * 100) / 100 }
