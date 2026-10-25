import type { IntradayBar, IntradaySeries } from '../providers/tencent-intraday.js'
import { boardLimitPct, fetchTencentIntraday } from '../providers/tencent-intraday.js'
import { recordIntradaySeries } from './intraday-store.js'

export interface IntradaySignal { id: string; time: string; price: number; reason: string; action: 'buy' | 'sell' | 'watch' }
export interface IntradayRedFlag { id: string; text: string; value: string }
export interface IntradayAnalysis {
  symbol: string
  date: string
  prevClose: number
  bars: IntradayBar[]
  stats: {
    openPct: number; closePct: number; highPct: number; lowPct: number
    aboveVwapRatio: number; slopePct: number; upDownVolumeRatio: number
    peakVolumeMultiple: number; peakTime: string; closePosition: number; trendEfficiency: number
    closeVsVwapPct: number; medianVolume: number
  }
  score: { label: '强' | '中性' | '弱' | '危险'; strength: number; weak: number }
  signals: IntradaySignal[]
  redFlags: IntradayRedFlag[]
  note: string
}

const cache = new Map<string, { at: number; data: IntradayAnalysis }>()
export async function analyzeIntraday(symbol: string, date?: string): Promise<IntradayAnalysis> {
  if (!/^(0|3|5|6)\d{5}$/.test(symbol)) throw new Error('代码必须是 6 位 A 股/ETF')
  const key = `${symbol}:${date ?? 'latest'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.data
  const series = await fetchTencentIntraday(symbol, date)
  recordIntradaySeries(series)
  const data = analyzeSeries(series)
  cache.set(key, { at: Date.now(), data })
  return data
}

export function analyzeSeries(s: IntradaySeries): IntradayAnalysis {
  const bars = s.bars
  const prev = s.prevClose
  const med = s.medianVolume
  const c = bars.map((b) => b.price)
  const v = bars.map((b) => b.volume)
  const a = bars.map((b) => b.vwap)
  const up = v.reduce((sum, x, i) => i > 0 && c[i] > c[i - 1] ? sum + x : sum, 0)
  const down = v.reduce((sum, x, i) => i > 0 && c[i] < c[i - 1] ? sum + x : sum, 0)
  const above = bars.filter((b) => b.price >= b.vwap).length / bars.length
  const path = c.reduce((sum, x, i) => i > 0 ? sum + Math.abs(x - c[i - 1]) : sum, 0)
  const i10 = bars.findIndex((b) => b.time >= '10:00')
  const avgPct = a.map((x) => x / prev - 1)
  const slope = avgPct[avgPct.length - 1] - avgPct[Math.max(0, i10)]
  const peakIndex = v.reduce((best, x, i) => x > v[best] ? i : best, 0)
  const peak = v[peakIndex] / med
  const lo = Math.min(...c)
  const hi = Math.max(...c)
  const closePosition = (c[c.length - 1] - lo) / Math.max(1e-9, hi - lo)
  const trendEfficiency = Math.abs(c[c.length - 1] - c[0]) / Math.max(1e-9, path)
  const openPct = (c[0] / prev - 1) * 100
  const closePct = (c[c.length - 1] / prev - 1) * 100
  const highPct = (hi / prev - 1) * 100
  const lowPct = (lo / prev - 1) * 100
  const closeVsVwapPct = (c[c.length - 1] / a[a.length - 1] - 1) * 100
  const redFlags: IntradayRedFlag[] = []
  if (highPct - closePct >= 3 && closePct < 1) redFlags.push({ id: 'upper-shadow', text: '长上影', value: `上影 ${(highPct - closePct).toFixed(2)} 点` })
  if (closeVsVwapPct <= -1) redFlags.push({ id: 'below-vwap', text: '收盘低于均价线', value: `${closeVsVwapPct.toFixed(2)}%` })
  if (highPct - closePct >= 4) redFlags.push({ id: 'fade', text: '冲高回落', value: `${(highPct - closePct).toFixed(2)} 点` })
  if (above < 0.4) redFlags.push({ id: 'below-most', text: '多数时间在成本线下', value: `${(above * 100).toFixed(1)}%` })
  if (closePosition < 0.25) redFlags.push({ id: 'close-low', text: '收在当日下沿', value: `${(closePosition * 100).toFixed(1)}%` })
  if (peak > 30 && Math.abs(closePct) < 0.5) redFlags.push({ id: 'volume-stall', text: '天量滞涨', value: `${peak.toFixed(0)}× · 收盘 ${closePct.toFixed(2)}%` })
  const strength = [above >= 0.7, slope > 0.005, up / Math.max(down, 1) > 1.5, closePosition > 0.8, trendEfficiency > 0.25].filter(Boolean).length
  const weak = [above < 0.4, slope < -0.003, up / Math.max(down, 1) < 0.8, closePosition < 0.4, trendEfficiency < 0.12].filter(Boolean).length
  const label: IntradayAnalysis['score']['label'] = redFlags.length >= 2 || weak >= 4 ? '危险' : weak >= 2 ? '弱' : strength >= 4 ? '强' : '中性'
  return {
    symbol: s.symbol, date: s.date, prevClose: prev, bars,
    stats: {
      openPct: round(openPct), closePct: round(closePct), highPct: round(highPct), lowPct: round(lowPct),
      aboveVwapRatio: round(above * 100), slopePct: round(slope * 100), upDownVolumeRatio: round(up / Math.max(down, 1)),
      peakVolumeMultiple: round(peak), peakTime: bars[peakIndex]?.time ?? '', closePosition: round(closePosition * 100),
      trendEfficiency: round(trendEfficiency), closeVsVwapPct: round(closeVsVwapPct), medianVolume: med,
    },
    score: { label, strength, weak }, signals: buildSignals(bars, prev, med, s.symbol), redFlags,
    note: s.partial ? '当前为盘中未完成分时，指标会随分钟变化；T+1 当日买入不能当日卖出。' : '分时指标只描述当前结构，不是收益预测；T+1 当日买入不能当日卖出。',
  }
}

function buildSignals(bars: IntradayBar[], prev: number, med: number, symbol: string): IntradaySignal[] {
  const out: IntradaySignal[] = []
  const seen = new Set<string>()
  const push = (id: string, i: number, reason: string, action: IntradaySignal['action']) => {
    if (seen.has(id)) return
    seen.add(id); out.push({ id, time: bars[i].time, price: bars[i].price, reason, action })
  }
  let morningHigh = 0
  let dayHigh = 0
  let b1 = false
  let s1 = false
  let s1At = -1
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]
    const prevBar = bars[i - 1]
    const prev5 = bars.slice(Math.max(0, i - 5), i)
    const avg5 = prev5.length ? prev5.reduce((sum, x) => sum + x.volume, 0) / prev5.length : 0
    const above = b.price >= b.vwap
    const pct = (b.price / prev - 1) * 100
    if (b.time <= '11:30') morningHigh = Math.max(morningHigh, b.price)
    dayHigh = Math.max(dayHigh, b.price)
    if (!b1 && b.time <= '10:30' && above && b.volume >= 3 * med) { b1 = true; push('B1', i, '首次放量站上均价线', 'buy') }
    if (b1 && above && b.price <= b.vwap * 1.002 && b.volume <= 0.7 * avg5) push('B2', i, '缩量回踩均价线不破', 'buy')
    if (b.time >= '13:00' && b.time <= '14:00' && morningHigh > 0 && b.price > morningHigh && b.volume >= 1.5 * med) push('B3', i, '放量突破早盘高点', 'buy')
    if (b.time >= '14:30' && above && b.price >= dayHigh && b.volume >= 1.5 * med) push('B4', i, '尾盘放量突破全天高点', 'buy')
    if (!above && b.volume > 3 * med) { s1 = true; s1At = i; push('S1', i, '跌破均价线且放量', 'sell') }
    if (s1 && i > s1At && b.price >= b.vwap * 0.997 && b.price < b.vwap) push('S2', i, '反抽均价线不过', 'sell')
    if (b.volume > 30 * med && Math.abs(pct) < 0.5) push('S3', i, '天量滞涨', 'sell')
    if (b.time >= '14:30' && dayHigh >= prev * (1 + boardLimitPct(symbol) - 0.001) && b.price < dayHigh * 0.98) push('S4', i, '涨停后回落', 'sell')
    if (prevBar && b.time >= '14:30' && b.price > b.vwap && b.volume > med * 1.5) push('W1', i, '尾盘价上均价线放量', 'watch')
  }
  return out.slice(0, 12)
}
function round(n: number) { return Math.round(n * 100) / 100 }
