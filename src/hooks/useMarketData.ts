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
  const appliedAt = useRef(Date.now())

  const apply = useCallback((next: Snapshot) => {
    setSnapshot(next)
    setError(null)
    lastEvent.current = Date.now()
    // 倒计时以"收到帧的本地时刻"为基准，不用 nextRefreshAt 减本地时钟：
    // 远程设备（手机/另一台电脑）时钟常有几秒~几分钟偏差，那样算会恒为 0，环形进度条就卡死不动。
    appliedAt.current = Date.now()
    setCountdown(Math.max(1, Math.round((next.refreshMs || 10_000) / 1000)))
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

    let source: EventSource | null = null
    let retry = 0
    let retryTimer: number | undefined
    let closed = false

    // EventSource 只会在"网络层断开"时自动重连；如果服务端（或开发代理）返回了一个
    // 合法的 HTTP 非 200（例如后端重启瞬间代理报 502），规范要求客户端永久放弃，
    // 页面就会一直停在旧快照上——远程设备踩到这个窗口后就再也收不到帧了。
    // 所以这里自己接管重连，退避 2s → 4s → 8s → 16s，上限 30s。
    const scheduleReconnect = () => {
      if (closed || cancelled) return
      const delay = Math.min(30_000, 2_000 * 2 ** retry)
      retry = Math.min(retry + 1, 4)
      retryTimer = window.setTimeout(() => {
        if (!closed && !cancelled) connect()
      }, delay)
    }

    const bind = (stream: EventSource) => {
      stream.onopen = () => {
        retry = 0
        setConnected(true)
      }
      stream.onerror = () => {
        setConnected(false)
        // 主动关掉并重建：不再依赖浏览器对 EventSource 的自动重试
        stream.close()
        if (source === stream) source = null
        scheduleReconnect()
      }
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
      const onAlert = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as AlertEvent
          if (!cancelled) setAlertEvents((prev) => [...prev.slice(-9), data])
        } catch {
          // ignore malformed alert frames
        }
      }
      stream.addEventListener('snapshot', onSnapshot as EventListener)
      stream.addEventListener('alert', onAlert as EventListener)
    }

    const connect = () => {
      if (cancelled) return
      const stream = new EventSource('/api/stream')
      source = stream
      bind(stream)
    }

    connect()

    return () => {
      cancelled = true
      closed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [apply])

  useEffect(() => {
    const id = setInterval(() => {
      const current = new Date()
      setNow(current)
      // 纯本地推算：距"收到上一帧"过了多少秒，与设备时钟是否准确无关
      const period = Math.max(1, Math.round((snapshot?.refreshMs ?? 10_000) / 1000))
      const elapsed = (current.getTime() - appliedAt.current) / 1000
      setCountdown(Math.max(0, Math.min(period, Math.ceil(period - elapsed))))
      if (document.visibilityState === 'visible' && Date.now() - lastEvent.current > 12_000 && !fallbackBusy.current) {
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
  }, [snapshot?.refreshMs, apply])

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
