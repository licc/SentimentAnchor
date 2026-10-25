import { useCallback, useEffect, useState } from 'react'
import type { QuantStrategyLibraryPayload } from '../../shared/types'
import {
  activateQuantStrategy, createQuantStrategy, deleteQuantStrategy, duplicateQuantStrategy,
  getQuantStrategyLibrary, updateQuantStrategy,
} from '../api'

export function useQuantStrategyLibrary() {
  const [data, setData] = useState<QuantStrategyLibraryPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setData(await getQuantStrategyLibrary()); setError(null) } catch (err) { setError(err instanceof Error ? err.message : '读取策略库失败') }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const action = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try { const result = await fn(); await refresh(); setError(null); return result } catch (err) { setError(err instanceof Error ? err.message : '策略操作失败'); throw err } finally { setBusy(false) }
  }, [refresh])

  return {
    data, busy, error, refresh,
    create: (name: string, content: string) => action(() => createQuantStrategy({ name, content })),
    update: (id: string, name: string, content: string) => action(() => updateQuantStrategy(id, { name, content })),
    activate: (id: string, force = false) => action(() => activateQuantStrategy(id, force)),
    duplicate: (id: string) => action(() => duplicateQuantStrategy(id)),
    remove: (id: string) => action(() => deleteQuantStrategy(id)),
  }
}
