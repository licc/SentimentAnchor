import { useEffect, useState } from 'react'
import type { EtfExecutionRecord } from '../../shared/types'
import { getEtfExecutions } from '../api'

export function useEtfExecutions(limit = 50) {
  const [rows, setRows] = useState<EtfExecutionRecord[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      getEtfExecutions(limit)
        .then((r) => { if (alive) setRows(r.executions) })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [limit])
  return rows
}
