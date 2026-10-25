import { useCallback, useEffect, useState } from 'react'
import type { T0StrategyPayload } from '../../shared/types'
import { activateT0Strategy, getT0Strategies, saveT0Strategy } from '../api'

export function useT0Strategies() {
  const [data, setData] = useState<T0StrategyPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { setData(await getT0Strategies()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '读取 T+0 策略失败') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const save = useCallback(async (id: string, content: string) => {
    setBusy(true)
    try { await saveT0Strategy(id, content); await refresh() } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); throw err } finally { setBusy(false) }
  }, [refresh])
  const activate = useCallback(async (id: string) => {
    setBusy(true)
    try { await activateT0Strategy(id); await refresh() } catch (err) { setError(err instanceof Error ? err.message : '启用失败'); throw err } finally { setBusy(false) }
  }, [refresh])
  return { data, busy, error, refresh, save, activate }
}
