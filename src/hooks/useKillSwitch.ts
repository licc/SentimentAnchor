import { useCallback, useEffect, useState } from 'react'
import { activateKillSwitch, clearKillSwitch, getKillSwitch } from '../api'

export function useKillSwitch() {
  const [state, setState] = useState<{ active: boolean; reason: string; updatedAt: string } | null>(null)
  const refresh = useCallback(async () => { setState(await getKillSwitch()) }, [])
  useEffect(() => { void refresh() }, [refresh])
  const activate = useCallback(async (reason: string) => { setState(await activateKillSwitch(reason)) }, [])
  const clear = useCallback(async () => { setState(await clearKillSwitch()) }, [])
  return { state, refresh, activate, clear }
}
