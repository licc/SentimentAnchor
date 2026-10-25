import { useEffect, useState } from 'react'
import { getSystemHealth } from '../api'

type Health = Awaited<ReturnType<typeof getSystemHealth>>
export function useSystemHealth() {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => getSystemHealth().then((h) => { if (alive) setHealth(h) }).catch(() => undefined)
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return health
}
