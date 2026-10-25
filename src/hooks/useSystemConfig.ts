import { useCallback, useEffect, useState } from 'react'
import { getSystemConfig, saveSystemConfig } from '../api'

type Config = Awaited<ReturnType<typeof getSystemConfig>>
export function useSystemConfig() {
  const [config, setConfig] = useState<Config | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void getSystemConfig().then(setConfig).catch((err) => setError(err instanceof Error ? err.message : '配置读取失败')) }, [])
  const save = useCallback(async (next: { brokerUrl: string; brokerKey?: string; clearBrokerKey?: boolean; orderTimeoutMs: number; statusTtlMs: number; maxManualOrderAmount: number }) => {
    setBusy(true)
    try { setConfig(await saveSystemConfig(next)); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '配置保存失败'); throw err } finally { setBusy(false) }
  }, [])
  return { config, busy, error, save }
}
