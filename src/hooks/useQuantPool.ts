import { useCallback, useEffect, useState } from 'react'
import type { QuantPoolPayload } from '../../shared/types'
import { addQuantCode, assignQuantStrategy, getQuantPool, removeQuantCode } from '../api'

export function useQuantPool() {
  const [pool, setPool] = useState<QuantPoolPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setPool(await getQuantPool())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取量化池失败')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => clearInterval(timer)
  }, [refresh])

  const add = useCallback(async (code: string) => {
    setBusy(true)
    try { await addQuantCode(code); await refresh(); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '加入失败'); throw err } finally { setBusy(false) }
  }, [refresh])

  const assign = useCallback(async (code: string, strategyId: string) => {
    setBusy(true)
    try { await assignQuantStrategy(code, strategyId); await refresh(); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '指定策略失败'); throw err } finally { setBusy(false) }
  }, [refresh])

  const remove = useCallback(async (code: string) => {
    setBusy(true)
    try { await removeQuantCode(code); await refresh(); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '移除失败'); throw err } finally { setBusy(false) }
  }, [refresh])

  return { pool, error, busy, refresh, add, remove, assign }
}
