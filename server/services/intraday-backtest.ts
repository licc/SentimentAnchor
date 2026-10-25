import { fetchTencentIntradayHistory } from '../providers/tencent-intraday.js'
import { analyzeSeries } from './intraday-analysis.js'
import { loadIntradayArchive } from './intraday-store.js'

export interface IntradayBacktestRow { rule: string; signals: number; avgNextReturnPct: number; winRate: number; samples: Array<{ date: string; time: string; price: number; nextClose: number; returnPct: number }> }
export async function runIntradayBacktest(symbol: string): Promise<{ symbol: string; days: number; rows: IntradayBacktestRow[]; note: string }> {
  const provider = await fetchTencentIntradayHistory(symbol)
  const merged = new Map([...loadIntradayArchive(symbol), ...provider].map((s) => [s.date, s]))
  const series = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (series.length < 2) throw new Error('分时历史不足 2 个交易日')
  const byRule = new Map<string, IntradayBacktestRow>()
  for (let i = 0; i < series.length - 1; i++) {
    const a = analyzeSeries(series[i])
    const next = series[i + 1]
    const nextClose = next.bars[next.bars.length - 1]?.price
    if (!nextClose) continue
    for (const sig of a.signals.filter((x) => x.action === 'buy' || x.action === 'sell')) {
      const row = byRule.get(sig.id) ?? { rule: sig.id, signals: 0, avgNextReturnPct: 0, winRate: 0, samples: [] }
      const returnPct = ((nextClose / sig.price) - 1) * 100
      row.signals += 1
      row.samples.push({ date: a.date, time: sig.time, price: sig.price, nextClose, returnPct: round(returnPct) })
      row.avgNextReturnPct += returnPct
      byRule.set(sig.id, row)
    }
  }
  const rows = [...byRule.values()].map((r) => ({ ...r, avgNextReturnPct: round(r.avgNextReturnPct / Math.max(1, r.signals)), winRate: round((r.samples.filter((s) => s.returnPct > 0).length / Math.max(1, r.signals)) * 100), samples: r.samples }))
  return { symbol, days: series.length, rows, note: `使用腾讯最近 5 日 + 本地归档，共 ${series.length} 日；样本仍小，信号为规则近似。` }
}
function round(n: number) { return Math.round(n * 100) / 100 }
