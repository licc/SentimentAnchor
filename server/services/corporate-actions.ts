import type { DailyBar } from '../providers/history.js'
import type { CorporateAction } from '../providers/corporate-actions.js'

/** 前复权：adjust bars before each ex-date so the ex-day price drop is not a fake return. */
export function adjustBarsForActions(bars: DailyBar[], actions: CorporateAction[]): { bars: DailyBar[]; applied: number } {
  if (!actions.length) return { bars, applied: 0 }
  const out = bars.map((b) => ({ ...b }))
  let applied = 0
  for (const action of [...actions].sort((a, b) => b.exDate.localeCompare(a.exDate))) {
    const factor = 1 + action.shareRatio
    if (!(factor > 0)) continue
    let touched = false
    for (const bar of out) {
      if (bar.date >= action.exDate) continue
      bar.open = Math.max(0.01, (bar.open - action.cashPerShare) / factor)
      bar.high = Math.max(0.01, (bar.high - action.cashPerShare) / factor)
      bar.low = Math.max(0.01, (bar.low - action.cashPerShare) / factor)
      bar.close = Math.max(0.01, (bar.close - action.cashPerShare) / factor)
      bar.volume = Math.round(bar.volume * factor)
      touched = true
    }
    if (touched) applied++
  }
  return { bars: out, applied }
}
