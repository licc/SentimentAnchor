import { useCallback, useEffect, useState } from 'react'
import type { EtfDeskPayload } from '../../shared/types'
import { getEtfDesk } from '../api'

export function useEtfDesk() {
  const [data, setData] = useState<EtfDeskPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await getEtfDesk(force)
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ETF 策略台加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  return { data, loading, error, refresh }
}
