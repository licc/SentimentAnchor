/**
 * 只让"每秒变化的部分"重渲染。
 *
 * 背景：原来 `useMarketData` 每秒 setState（now / countdown），导致 **App 整棵树**
 * 每秒重渲染一次——包括情绪曲线、涨停池、交易台等大量 SVG/列表，页面开着不动时
 * CPU 也常年占用，这就是"主页很吃 CPU"的主因。
 *
 * 现在把时钟与倒计时下沉成独立组件；并且**共用一个 ticker**（src/lib/tick.ts）：
 * 两个组件各开一个 1 秒定时器时相位不同，顶栏一秒会被重绘两次，
 * 而顶栏带 backdrop-filter，重绘就要重算模糊，看起来就是"顶部在闪"。
 */
import { useSyncExternalStore } from 'react'
import { Clock3 } from 'lucide-react'
import { clockOf } from '../lib/format'
import { getNow, subscribeTick } from '../lib/tick'

/** 每秒更新一次的"当前时间"，所有小组件共享同一次通知。 */
function useNowMs(): number {
  return useSyncExternalStore(subscribeTick, getNow, getNow)
}

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
  const nowMs = useNowMs()
  return <span className="mono">{clockOf(new Date(nowMs))}</span>
}

/**
 * 刷新倒计时环：以"收到上一帧的本地时刻"为基准倒推，与设备时钟无关。
 * 盘中才需要每秒转动的进度环；休市/收盘时改成静态环——否则顶栏每秒重绘一次，
 * 在带毛玻璃/合成层的场景下容易闪（表现为按钮上出现黑块）。
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
  if (marketStatus !== '盘中') {
    return (
      <div className="countdown" title={`下次刷新 ${period}s`}>
        <div className="countdown-inner is-closed">
          <span className="countdown-closed">{marketStatus === '已收盘' ? '收盘' : marketStatus}</span>
        </div>
      </div>
    )
  }
  return <LiveRing appliedAt={appliedAt} period={period} />
}

/** 盘中：每秒更新一次，与时钟共用同一个 ticker（同一帧提交，只重绘一次）。 */
function LiveRing({ appliedAt, period }: { appliedAt: number; period: number }) {
  const nowMs = useNowMs()
  const elapsed = (nowMs - appliedAt) / 1000
  const countdown = Math.max(0, Math.min(period, Math.ceil(period - elapsed)))
  const progress = Math.max(0, Math.min(1, 1 - countdown / period))
  return (
    <div
      className="countdown"
      style={{ '--progress': `${progress * 360}deg` } as React.CSSProperties}
      title={`下次刷新 ${countdown}s`}
    >
      <div className="countdown-inner">
        <span className="mono">{countdown}</span>
        <small>s</small>
      </div>
    </div>
  )
}
