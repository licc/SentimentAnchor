import type { EtfPaperTrade } from '../../shared/types.js'
import { brokerChannel } from './broker-channel.js'
import { commission } from './etf-fees.js'
import { getExecutions, updateExecution } from './etf-execution.js'
import { getToday, recordTrade } from './etf-journal.js'
import { confirmCancellation, confirmExecution } from './etf-write-confirm.js'
import { withTradeLock } from './etf-trade-lock.js'

let running = false

/**
 * Background confirmation: POST is only a hint. Every pending execution is
 * resolved from orders + trades + portfolio. No duplicate submissions.
 */
export async function reconcilePendingExecutions(): Promise<void> {
  if (running) return
  const pending = getExecutions(200).filter((x) => (x.status === 'accepted' || x.status === 'unknown') && x.factors.source !== 'quant')
  if (pending.length === 0) return
  running = true
  try {
    await withTradeLock(async () => {
      for (const ex of pending) {
        if (!ex.orderId) continue
        const confirmed = await confirmExecution({ orderId: ex.orderId, symbol: ex.symbol, side: ex.side, quantity: ex.quantity })
        const broker = await brokerChannel.status(true)
        if (confirmed.result === 'filled') {
          const fee = commission(ex.price * ex.quantity)
          updateExecution(ex.id, {
            status: 'filled', filled: confirmed.evidence.tradeQty || ex.quantity, fee,
            brokerStatus: confirmed.evidence.orderStatus, cashAfter: confirmed.evidence.cashAfter,
            positionAfter: confirmed.evidence.positionAfter, evidence: confirmed.evidence,
            message: '后台多源核对：成交', resolution: `多源确认：${confirmed.evidence.note}`,
          })
          if (!getToday()?.trades.some((t) => t.id === `live-${ex.orderId}`)) {
            const trade: EtfPaperTrade = {
              id: `live-${ex.orderId}`, time: new Date().toISOString(), code: ex.symbol,
              name: ex.symbol, side: ex.side, price: confirmed.evidence.tradePrice ?? ex.price,
              quantity: confirmed.evidence.tradeQty || ex.quantity,
              amount: (confirmed.evidence.tradePrice ?? ex.price) * (confirmed.evidence.tradeQty || ex.quantity),
              fee, note: `LIVE · 后台确认 · ${ex.orderId}`,
            }
            recordTrade(trade, broker.account?.totalAsset ?? 0, 'live')
          }
        } else if (confirmed.result === 'rejected' || confirmed.result === 'cancelled') {
          updateExecution(ex.id, { status: confirmed.result, brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, cashAfter: confirmed.evidence.cashAfter, positionAfter: confirmed.evidence.positionAfter, resolution: confirmed.evidence.note })
        } else if (Date.now() - Date.parse(ex.createdAt) > 15_000) {
          const cancel = await confirmCancellation(ex.orderId).catch(() => 'unknown' as const)
          if (cancel === 'pending') {
            await brokerChannel.cancelOrder(ex.orderId).catch(() => undefined)
          }
          const after = await confirmCancellation(ex.orderId).catch(() => 'unknown' as const)
          updateExecution(ex.id, {
            status: after === 'cancelled' ? 'cancelled' : after === 'filled' ? 'filled' : 'unknown',
            brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence,
            resolution: after === 'cancelled' ? '15 秒窗口未成交，已撤单并二次查询确认' : '窗口结束仍未确认，需人工核对',
          })
        }
      }
    })
  } finally {
    running = false
  }
}

export function startOrderMonitor(): NodeJS.Timeout {
  const timer = setInterval(() => void reconcilePendingExecutions().catch(() => undefined), 5_000)
  timer.unref?.()
  return timer
}
