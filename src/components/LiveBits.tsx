/**
 * 只让"每秒变化的部分"重渲染。
 *
 * 背景：原来 `useMarketData` 每秒 setState（now / countdown），导致 **App 整棵树**
 * 每秒重渲染一次——包括情绪曲线、涨停池、交易台等大量 SVG/列表。页面开着不动时
 * CPU 也常年占用，这就是"主页很吃 CPU"的主因。
 *
 * 现在把时钟与倒计时下沉成独立组件，各自持有 1s 定时器：
 * 状态变化只影响这两个小节点，父级（App / TopBar）不再每秒重渲染。
 */
import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { clockOf } from '../lib/format'

/** 顶部实时时钟：自己走秒，不依赖父组件状态。 */
export function LiveClock() {
  return (
    <>
      <Clock3 size={13} />
      <NowText />
    </>
  )
}

/** 纯时间文本（自己走秒），供只需要 HH:mm:ss 的地方复用。 */
export function NowText() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="mono">{clockOf(now)}</span>
}

/**
 * 刷新倒计时环：以"收到上一帧的本地时刻"为基准倒推，与设备时钟无关。
 * appliedAt 只在收到新快照时变化（约 10 秒一次），秒级更新都发生在这里。
 */
export function RefreshRing({
  appliedAt,
  refreshMs,
  marketStatus,
}: {
  appliedAt: number
  refreshMs: number
  marketStatus: string
}) {
  const period = Math.max(1, Math.round((refreshMs || 10_000) / 1000))
  const [countdown, setCountdown] = useState(period)

  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - appliedAt) / 1000
      setCountdown(Math.max(0, Math.min(period, Math.ceil(period - elapsed))))
    }
    tick()
    const id = window.setInterval(tick, 1_000)
    return () => window.clearInterval(id)
  }, [appliedAt, period])

  const progress = Math.max(0, Math.min(1, 1 - countdown / period))
  const isLive = marketStatus === '盘中'

  return (
    <div
      className="countdown"
      style={{ '--progress': `${progress * 360}deg` } as React.CSSProperties}
      title={`下次刷新 ${countdown}s`}
    >
      <div className={`countdown-inner ${isLive ? '' : 'is-closed'}`}>
        {isLive ? (
          <>
            <span className="mono">{countdown}</span>
            <small>s</small>
          </>
        ) : (
          <span className="countdown-closed">{marketStatus === '已收盘' ? '收盘' : marketStatus}</span>
        )}
      </div>
    </div>
  )
}
