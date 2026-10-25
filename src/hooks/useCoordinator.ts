import { useCallback, useEffect, useState } from 'react'
import type { CoordinatorConfigLike } from '../../shared/types'
import { getCoordinatorConfig, getCoordinatorStatus, saveCoordinatorConfig } from '../api'

export function useCoordinator() {
  const [config, setConfig] = useState<CoordinatorConfigLike | null>(null)
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getCoordinatorStatus>> | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void getCoordinatorConfig().then(setConfig).catch(() => undefined); void getCoordinatorStatus().then(setStatus).catch(() => undefined) }, [])
  const save = useCallback(async (next: CoordinatorConfigLike) => {
    setBusy(true)
    try { setConfig(await saveCoordinatorConfig(next)); setStatus(await getCoordinatorStatus()) } finally { setBusy(false) }
  }, [])
  return { config, status, busy, save }
}
