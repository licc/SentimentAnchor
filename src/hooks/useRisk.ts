import { useCallback, useEffect, useState } from 'react'
import type { RiskConfig, RiskStatus } from '../../shared/types'
import { getRiskStatus, saveRiskConfig } from '../api'

export function useRisk() {
  const [status, setStatus] = useState<RiskStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try { setStatus(await getRiskStatus()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '读取风控状态失败') }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  const save = useCallback(async (config: RiskConfig) => {
    setBusy(true)
    try { await saveRiskConfig(config); await refresh(); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '保存风控配置失败'); throw err } finally { setBusy(false) }
  }, [refresh])

  return { status, error, busy, refresh, save }
}
