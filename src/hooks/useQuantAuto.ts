import { useCallback, useEffect, useState } from 'react'
import type { QuantAutoState } from '../../shared/types'
import { flattenQuantAuto, getQuantAuto, pauseQuantAuto, startQuantAuto } from '../api'

export function useQuantAuto() {
  const [state, setState] = useState<QuantAutoState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setState(await getQuantAuto()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : 'T+1 状态读取失败') }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  const run = useCallback(async (action: 'start' | 'pause' | 'flatten') => {
    setBusy(true); setError(null)
    try {
      const next = action === 'start' ? await startQuantAuto() : action === 'pause' ? await pauseQuantAuto() : await flattenQuantAuto()
      setState(next)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : 'T+1 操作失败')
      throw err
    } finally { setBusy(false) }
  }, [])

  return { state, busy, error, refresh, run }
}
