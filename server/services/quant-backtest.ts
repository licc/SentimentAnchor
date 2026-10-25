import type { QuantBacktestResult, QuantBacktestTrade, QuantBacktestWindow, QuantStrategyConfig } from '../../shared/types.js'
import { fetchDailyBars, type DailyBar } from '../providers/history.js'
import { fetchCorporateActions } from '../providers/corporate-actions.js'
import { adjustBarsForActions } from './corporate-actions.js'

const FEE_PCT = 0.1
const SLIPPAGE_PCT = 0.05
export function limitPctFor(code: string): number {
  if (/^(30|68)/.test(code)) return 19.5
  if (/^(4|8)/.test(code)) return 29.5
  return 9.5
}

export async function runQuantBacktest(input: { code: string; strategy: QuantStrategyConfig; days: number }): Promise<QuantBacktestResult> {
  const code = String(input.code)
  if (!/^(0|3|6)\d{5}$/.test(code)) throw new Error('回测代码必须是 6 位 A 股股票代码')
  const days = Math.max(60, Math.min(500, Math.round(input.days || 180)))
  const rawBars = await fetchDailyBars(code, days + 40)
  if (rawBars.length < 30) throw new Error('历史数据不足 30 个交易日')
  const actions = await fetchCorporateActions(code).catch(() => [])
  const adjusted = adjustBarsForActions(rawBars, actions)
  const bars = adjusted.bars
  const start = Math.max(20, bars.length - days)
  const trades: QuantBacktestTrade[] = []
  let equity = 1
  let peak = 1
  let maxDD = 0
  let position: { entryIndex: number; entryPrice: number; entryDate: string } | null = null
  let pendingEntry = false
  const curve: Array<{ date: string; value: number }> = []

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const pct = prev?.close ? (bar.close / prev.close - 1) * 100 : 0
    const ma20 = avg(bars.slice(i - 20, i).map((b) => b.close))

    if (position) {
      const held = i - position.entryIndex
      const stop = position.entryPrice * (1 - input.strategy.stopLossPct / 100)
      const take = position.entryPrice * (1 + input.strategy.takeProfitPct / 100)
      let exit: { price: number; reason: string } | null = null
      if (bar.low <= stop) exit = { price: stop, reason: `止损 -${input.strategy.stopLossPct}%` }
      else if (bar.high >= take) exit = { price: take, reason: `止盈 +${input.strategy.takeProfitPct}%` }
      else if (held >= input.strategy.maxHoldDays) exit = { price: bar.close, reason: `持有 ${held} 日` }
      if (exit && held >= 1) {
        const limitPct = limitPctFor(code)
        const limitDownLocked = Boolean(prev?.close && bar.low <= prev.close * (1 - limitPct / 100) && bar.high <= prev.close * (1 - limitPct / 100))
        if (limitDownLocked) {
          // Cannot sell when the stock is locked limit-down; keep the position for the next session.
          peak = Math.max(peak, equity)
          curve.push({ date: bar.date, value: round4(equity) })
          continue
        }
        const exitPrice = exit.price * (1 - SLIPPAGE_PCT / 100)
        const ret = (exitPrice / position.entryPrice - 1) * 100 - FEE_PCT
        equity *= 1 + ret / 100
        trades.push({ entryDate: position.entryDate, exitDate: bar.date, entryPrice: round2(position.entryPrice), exitPrice: round2(exitPrice), returnPct: round2(ret), reason: exit.reason })
        position = null
      }
    }

    if (!position && pendingEntry) {
      const gap = prev?.close ? ((bar.open / prev.close) - 1) * 100 : 0
      if (bar.open > 0 && bar.volume > 0 && gap < limitPctFor(code)) position = { entryIndex: i, entryPrice: bar.open * (1 + SLIPPAGE_PCT / 100), entryDate: bar.date }
      pendingEntry = false
    }

    if (!position && i < bars.length - 1 && entrySignal(input.strategy, bars, i, ma20, pct)) {
      pendingEntry = true
    }

    peak = Math.max(peak, equity)
    maxDD = Math.min(maxDD, (equity / peak - 1) * 100)
    curve.push({ date: bar.date, value: round4(equity) })
  }

  if (position) {
    const last = bars[bars.length - 1]
    const exitPrice = last.close * (1 - SLIPPAGE_PCT / 100)
    const ret = (exitPrice / position.entryPrice - 1) * 100 - FEE_PCT
    equity *= 1 + ret / 100
    trades.push({ entryDate: position.entryDate, exitDate: last.date, entryPrice: round2(position.entryPrice), exitPrice: round2(exitPrice), returnPct: round2(ret), reason: '回测结束平仓' })
  }

  const suspendedDays = bars.slice(start).filter((b) => b.volume <= 0).length
  const largeGaps = bars.slice(start).reduce((count, b, i, arr) => i === 0 ? count : (Date.parse(b.date) - Date.parse(arr[i - 1].date) > 10 * 86_400_000 ? count + 1 : count), 0)
  const wins = trades.filter((t) => t.returnPct > 0).length
  const metrics = buildMetrics(curve, trades, bars.slice(start), equity)
  const rollingWindows = buildRollingWindows(curve, trades, 3)
  const split = Math.max(1, Math.floor(curve.length * 0.7))
  const oosCurve = curve.slice(split)
  const oosStart = curve[split]?.value ?? 1
  const oosEnd = curve[curve.length - 1]?.value ?? oosStart
  const oosPeak = oosCurve.reduce((peak, p) => Math.max(peak, p.value), oosStart)
  const oosMaxDD = oosCurve.reduce((dd, p) => Math.min(dd, (p.value / oosPeak - 1) * 100), 0)
  const oosTrades = trades.filter((t) => t.exitDate >= (bars[split]?.date ?? ''))
  const oosWins = oosTrades.filter((t) => t.returnPct > 0).length
  return {
    dataQuality: { suspendedDays, largeGaps, note: `${suspendedDays || largeGaps ? `停牌/零成交 ${suspendedDays} 日，长休市间隔 ${largeGaps} 段` : '日线连续，无零成交'} · 前复权 ${adjusted.applied} 次` },
    metrics,
    rollingWindows,
    outOfSample: {
      returnPct: round2((oosEnd / oosStart - 1) * 100),
      maxDrawdownPct: round2(oosMaxDD),
      winRate: oosTrades.length ? round2((oosWins / oosTrades.length) * 100) : 0,
      trades: oosTrades.length,
    },
    code,
    name: code,
    strategy: input.strategy.id,
    days: bars.length - start,
    returnPct: round2((equity - 1) * 100),
    maxDrawdownPct: round2(maxDD),
    winRate: trades.length ? round2((wins / trades.length) * 100) : 0,
    trades,
    bars: bars.slice(start).map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
    equity: curve,
  }
}

function entrySignal(config: QuantStrategyConfig, bars: DailyBar[], i: number, ma20: number, pct: number): boolean {
  const bar = bars[i]
  if (pct < config.entry.minPct || pct > config.entry.maxPct) return false
  if (config.entry.priceAboveOpen && bar.close <= bar.open) return false
  if (config.entry.breakout20) {
    const high20 = Math.max(...bars.slice(i - 20, i).map((b) => b.high))
    if (bar.close <= high20) return false
  }
  if (config.entry.pullback && bar.close <= ma20) return false
  return true
}

function buildMetrics(curve: Array<{ date: string; value: number }>, trades: QuantBacktestTrade[], bars: DailyBar[], equity: number) {
  const daily = curve.slice(1).map((p, i) => p.value / curve[i].value - 1).filter((x) => Number.isFinite(x))
  const mean = daily.length ? daily.reduce((a, b) => a + b, 0) / daily.length : 0
  const variance = daily.length ? daily.reduce((a, b) => a + (b - mean) ** 2, 0) / daily.length : 0
  const std = Math.sqrt(variance)
  const downside = Math.sqrt(daily.length ? daily.reduce((a, b) => a + (b < 0 ? b * b : 0), 0) / daily.length : 0)
  const wins = trades.filter((t) => t.returnPct > 0).reduce((a, t) => a + t.returnPct, 0)
  const losses = Math.abs(trades.filter((t) => t.returnPct < 0).reduce((a, t) => a + t.returnPct, 0))
  let streak = 0
  let maxStreak = 0
  for (const t of trades) { if (t.returnPct < 0) { streak++; maxStreak = Math.max(maxStreak, streak) } else streak = 0 }
  const first = bars[0]?.close ?? 1
  const last = bars[bars.length - 1]?.close ?? first
  let peak = first
  let benchmarkDD = 0
  for (const b of bars) { peak = Math.max(peak, b.close); benchmarkDD = Math.min(benchmarkDD, (b.close / peak - 1) * 100) }
  return {
    annualizedReturnPct: round2((Math.pow(Math.max(0.01, equity), 252 / Math.max(1, curve.length)) - 1) * 100),
    sharpe: std ? round2((mean / std) * Math.sqrt(252)) : 0,
    sortino: downside ? round2((mean / downside) * Math.sqrt(252)) : 0,
    profitFactor: losses ? round2(wins / losses) : wins > 0 ? 99 : 0,
    expectancyPct: trades.length ? round2(trades.reduce((a, t) => a + t.returnPct, 0) / trades.length) : 0,
    maxConsecutiveLosses: maxStreak,
    benchmarkReturnPct: round2((last / first - 1) * 100),
    benchmarkMaxDrawdownPct: round2(benchmarkDD),
  }
}

function buildRollingWindows(curve: Array<{ date: string; value: number }>, trades: QuantBacktestTrade[], count: number): QuantBacktestWindow[] {
  if (curve.length < count * 2) return []
  const size = Math.floor(curve.length / count)
  return Array.from({ length: count }, (_, i) => {
    const from = i * size
    const to = i === count - 1 ? curve.length - 1 : (i + 1) * size
    const start = curve[from]?.value ?? 1
    const end = curve[to]?.value ?? start
    let peak = start
    let dd = 0
    for (const p of curve.slice(from, to + 1)) { peak = Math.max(peak, p.value); dd = Math.min(dd, (p.value / peak - 1) * 100) }
    const startDate = curve[from]?.date ?? ''
    const endDate = curve[to]?.date ?? ''
    const windowTrades = trades.filter((t) => t.exitDate >= startDate && t.exitDate <= endDate)
    const wins = windowTrades.filter((t) => t.returnPct > 0).length
    return { label: `W${i + 1}`, startDate, endDate, returnPct: round2((end / start - 1) * 100), maxDrawdownPct: round2(dd), winRate: windowTrades.length ? round2((wins / windowTrades.length) * 100) : 0, trades: windowTrades.length }
  })
}

function avg(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }
function round2(n: number) { return Math.round(n * 100) / 100 }
function round4(n: number) { return Math.round(n * 10000) / 10000 }
