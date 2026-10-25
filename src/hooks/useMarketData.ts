import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlertEvent, Snapshot } from '../../shared/types'
import { forceRefresh, getSnapshot } from '../api'

export function useMarketData() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [now, setNow] = useState(() => new Date())
  const lastEvent = useRef(0)
  const fallbackBusy = useRef(false)

  const apply = useCallback((next: Snapshot) => {
    setSnapshot(next)
    setError(null)
    lastEvent.current = Date.now()
  }, [])

  useEffect(() => {
    let cancelled = false
    getSnapshot()
      .then((s) => {
        if (!cancelled) {
          apply(s)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '行情初始化失败')
          setLoading(false)
        }
      })

    const es = new EventSource('/api/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    const onSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as Snapshot
        if (!cancelled) {
          apply(data)
          setConnected(true)
          setLoading(false)
        }
      } catch {
        // Ignore malformed frames, the next 10s frame will recover.
      }
    }
    es.addEventListener('snapshot', onSnapshot as EventListener)
    const onAlert = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as AlertEvent
        if (!cancelled) setAlertEvents((prev) => [...prev.slice(-9), data])
      } catch {
        // ignore malformed alert frames
      }
    }
    es.addEventListener('alert', onAlert as EventListener)

    return () => {
      cancelled = true
      es.removeEventListener('snapshot', onSnapshot as EventListener)
      es.removeEventListener('alert', onAlert as EventListener)
      es.close()
    }
  }, [apply])

  useEffect(() => {
    const id = setInterval(() => {
      const current = new Date()
      setNow(current)
      if (snapshot?.nextRefreshAt) {
        const sec = Math.ceil((new Date(snapshot.nextRefreshAt).getTime() - current.getTime()) / 1000)
        setCountdown(Math.max(0, sec))
      }
      if (document.visibilityState === 'visible' && Date.now() - lastEvent.current > 22_000 && !fallbackBusy.current) {
        fallbackBusy.current = true
        getSnapshot()
          .then((s) => apply(s))
          .catch(() => undefined)
          .finally(() => {
            fallbackBusy.current = false
          })
      }
    }, 1000)
    return () => clearInterval(id)
  }, [snapshot?.nextRefreshAt, apply])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await forceRefresh()
      apply(res.snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }, [apply])

  return {
    snapshot,
    connected,
    loading,
    error,
    refreshing,
    countdown,
    now,
    refresh,
    alertEvents,
    setSnapshot,
  }
}
