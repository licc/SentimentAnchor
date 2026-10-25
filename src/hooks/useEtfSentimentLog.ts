import { useEffect, useState } from 'react'
import type { EtfSentimentLog } from '../../shared/types'
import { getEtfSentimentLog } from '../api'

export function useEtfSentimentLog(limit = 12) {
  const [logs, setLogs] = useState<EtfSentimentLog[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      getEtfSentimentLog(limit)
        .then((r) => { if (alive) { setLogs(r.logs); setError(null) } })
        .catch((err) => { if (alive) setError(err instanceof Error ? err.message : '读取交易事件失败') })
    }
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [limit])

  return { logs, error }
}
