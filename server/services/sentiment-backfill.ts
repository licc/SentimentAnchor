/**
 * 情绪温度历史回填。
 *
 * 关键发现：选股宝的广度接口支持 `date=YYYY-MM-DD`，会返回该交易日完整的 243 个分钟点；
 * 而温度公式（analysis.buildChart）只依赖广度四元组（涨跌家数、涨跌停数），
 * 不依赖指数、涨停池等"只有当日才有"的数据。因此历史可以**精确复算**，不存在口径漂移。
 *
 * 限制：接口能回溯多久取决于上游，实测 30 天没问题；再久会返回空数组，这里按失败跳过。
 */
import { buildChart } from './analysis.js'
import { fetchBreadthLine } from '../providers/xgb.js'
import { deleteDay, getDates, upsertDay } from './sentiment-store.js'

const TZ = 'Asia/Shanghai'

let running = false

export function isBackfilling(): boolean {
  return running
}

/** 上海时区的今天，YYYY-MM-DD。 */
export function todayInShanghai(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** 日期加减天数（按上海时区，返回 YYYY-MM-DD）。 */
export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** 0=周日 … 6=周六。 */
function weekday(date: string): number {
  return new Date(`${date}T12:00:00+08:00`).getUTCDay()
}

/** 某个时间戳落在上海时区的哪一天。 */
function dayOf(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: TZ })
}

export interface BackfillResult {
  /** 本次新写入的天数 */
  added: number
  /** 实际请求过的日期数 */
  tried: number
  /** 回填后库里累计的天数 */
  total: number
  /** 是否因为已经在跑而跳过 */
  skipped: boolean
}

/**
 * 从今天往前回填，直到库里有 `days` 个交易日或试完候选日期。
 * 幂等：已存在的日期会跳过（除非 force）。
 */
export async function backfillSentiment(days = 30, opts: { force?: boolean } = {}): Promise<BackfillResult> {
  const target = Math.max(1, Math.min(60, Math.round(days)))
  if (running) {
    return { added: 0, tried: 0, total: getDates().length, skipped: true }
  }
  running = true
  const have = new Set(getDates())
  const before = have.size
  let added = 0
  let tried = 0

  try {
    let cursor = shiftDate(todayInShanghai(), -1)
    // 普通模式：凑够 target 天就停；force 模式：固定往回扫一段，目的是重新校验并清理脏行
    const candidateLimit = opts.force ? Math.ceil(target * 1.5) + 10 : target * 3 + 15
    while (tried < candidateLimit && (opts.force || have.size < target)) {
      tried += 1
      const dow = weekday(cursor)
      if (dow !== 0 && dow !== 6 && (opts.force || !have.has(cursor))) {
        try {
          const { points } = await fetchBreadthLine(cursor)
          // 上游对非交易日（节假日）会静默回退到"上一个交易日"，
          // 必须核对返回数据的实际日期，否则会把同一交易日的行情重复写进多个日期。
          const firstDay = points.length ? dayOf(points[0].timestamp) : ''
          const lastDay = points.length ? dayOf(points[points.length - 1].timestamp) : ''
          const matches = firstDay === cursor && lastDay === cursor
          if (!matches) {
            // 顺手清掉之前误写入的错误行
            if (have.has(cursor)) {
              deleteDay(cursor)
              have.delete(cursor)
            }
          } else if (points.length >= 60) {
            const chart = buildChart(points)
            const temps = chart.map((p) => p.temp)
            upsertDay({
              date: cursor,
              score: temps[temps.length - 1],
              high: Math.max(...temps),
              low: Math.min(...temps),
              points: chart.map((p) => ({ time: p.time, temp: p.temp })),
              updatedAt: new Date().toISOString(),
            })
            have.add(cursor)
            added += 1
          }
        } catch {
          // 上游偶发失败/该日无数据：跳过，继续往前
        }
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      cursor = shiftDate(cursor, -1)
    }
    if (added > 0) {
      console.log(`[sentiment] 历史回填完成：新增 ${added} 天，累计 ${have.size} 天（起始 ${before} 天）`)
    }
    return { added, tried, total: have.size, skipped: false }
  } finally {
    running = false
  }
}
