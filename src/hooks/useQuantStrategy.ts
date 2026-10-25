import { useCallback, useEffect, useState } from 'react'
import type { QuantBacktestResult, QuantStrategyConfig, QuantStrategyPayload } from '../../shared/types'
import { getQuantStrategy, runQuantBacktest, saveQuantStrategy } from '../api'

export function useQuantStrategy() {
  const [data, setData] = useState<QuantStrategyPayload | null>(null)
  const [backtest, setBacktest] = useState<QuantBacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try { setData(await getQuantStrategy()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '读取策略失败') }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const save = useCallback(async (active: string, config: QuantStrategyConfig) => {
    setBusy(true)
    try { setData(await saveQuantStrategy({ active, config })); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '保存策略失败'); throw err } finally { setBusy(false) }
  }, [])

  const run = useCallback(async (code: string, days: number) => {
    setBusy(true)
    try { const result = await runQuantBacktest({ code, days }); setBacktest(result); setError(null); return result } catch (err) { setError(err instanceof Error ? err.message : '回测失败'); throw err } finally { setBusy(false) }
  }, [backtest])

  return { data, backtest, error, busy, refresh, save, run }
}
