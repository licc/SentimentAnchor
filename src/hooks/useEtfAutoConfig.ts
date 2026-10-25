import { useCallback, useEffect, useState } from 'react'
import type { EtfAutoConfig } from '../../shared/types'
import { getEtfAutoConfig, saveEtfAutoConfig } from '../api'

export function useEtfAutoConfig() {
  const [config, setConfig] = useState<EtfAutoConfig | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void getEtfAutoConfig().then(setConfig).catch(() => undefined) }, [])
  const save = useCallback(async (next: EtfAutoConfig) => {
    setBusy(true)
    try { setConfig(await saveEtfAutoConfig(next)) } finally { setBusy(false) }
  }, [])
  return { config, busy, save }
}
