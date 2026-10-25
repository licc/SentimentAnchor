import { useCallback, useEffect, useState } from 'react'
import { getEtfFeeSettings, saveEtfFeeSettings } from '../api'

export function useEtfFees() {
  const [settings, setSettings] = useState<{ maxDailyFeePct: number; maxDailyFeeAmount: number; updatedAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void getEtfFeeSettings().then(setSettings).catch(() => undefined) }, [])
  const save = useCallback(async (input: { maxDailyFeePct: number; maxDailyFeeAmount: number }) => {
    setBusy(true)
    try { setSettings(await saveEtfFeeSettings(input)) } finally { setBusy(false) }
  }, [])
  return { settings, busy, save }
}
