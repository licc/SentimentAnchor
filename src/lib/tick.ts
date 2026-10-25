/**
 * 全页面共享的 1 秒 ticker。
 *
 * 为什么需要它：时钟、倒计时环原来是两个组件各开一个 setInterval，
 * 相位不同 → 顶栏一秒被重绘两次。顶栏带 `backdrop-filter: blur(16px)`，
 * 每次重绘都要重新计算背景模糊，肉眼就是"顶部在闪"。
 *
 * 用一个 ticker + useSyncExternalStore，同一时刻的通知会被 React 批量合并成一次提交，
 * 一秒只重绘一次；没有订阅者时定时器自动停掉。
 */
let nowMs = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function tick() {
  nowMs = Date.now()
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // 单个订阅者异常不影响其它订阅者
    }
  }
}

export function subscribeTick(fn: () => void): () => void {
  listeners.add(fn)
  if (timer === null) timer = setInterval(tick, 1_000)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function getNow(): number {
  return nowMs
}
