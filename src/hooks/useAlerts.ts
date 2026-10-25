import { useCallback, useEffect, useState } from 'react'
import type { AlertConfig, AlertEvent, AlertPayload } from '../../shared/types'
import { getAlerts, markAlertsRead, saveAlertConfig } from '../api'

export function useAlerts() {
  const [payload, setPayload] = useState<AlertPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await getAlerts()
      setPayload(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '告警加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const ingest = useCallback((event: AlertEvent) => {
    setPayload((prev) => {
      if (!prev) return prev
      if (prev.events.some((e) => e.id === event.id)) return prev
      return {
        ...prev,
        events: [event, ...prev.events].slice(0, 80),
        unread: prev.unread + 1,
      }
    })
  }, [])

  const saveConfig = useCallback(async (config: Partial<AlertConfig>) => {
    const res = await saveAlertConfig(config)
    setPayload(res)
    return res
  }, [])

  const markRead = useCallback(async (ids?: string[]) => {
    const res = await markAlertsRead(ids)
    setPayload(res)
    return res
  }, [])

  return { payload, loading, error, refresh, ingest, saveConfig, markRead }
}
