import { useCallback, useEffect, useState } from 'react'
import type { EtfAutoState } from '../../shared/types'
import { flattenEtfAuto, getEtfAuto, pauseEtfAuto, startEtfAuto } from '../api'

export function useEtfAuto() {
  const [state, setState] = useState<EtfAutoState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await getEtfAuto())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动执行状态读取失败')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const run = useCallback(async (action: 'start' | 'pause' | 'flatten') => {
    setBusy(true)
    setError(null)
    try {
      const next = action === 'start' ? await startEtfAuto() : action === 'pause' ? await pauseEtfAuto() : await flattenEtfAuto()
      setState(next)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动执行操作失败')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, error, refresh, run }
}
