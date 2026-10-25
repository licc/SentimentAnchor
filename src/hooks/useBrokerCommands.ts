import { useEffect, useState } from 'react'
import type { BrokerCommandState } from '../../shared/types'
import { getBrokerCommands } from '../api'

export function useBrokerCommands() {
  const [state, setState] = useState<BrokerCommandState | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => getBrokerCommands().then((s) => { if (alive) setState(s) }).catch(() => undefined)
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 10_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return state
}
