import type { RiskDecision, Snapshot } from '../../../shared/types.js'
import { brokerChannel } from '../broker-channel.js'
import { createExecution, updateExecution } from '../etf-execution.js'
import { withTradeLock } from '../etf-trade-lock.js'
import { confirmExecution } from '../etf-write-confirm.js'
import { getRiskConfig } from './risk-config.js'
import { effectivePositionPnl } from '../position-pnl.js'
import { riskEngine, shanghaiMinutes } from './risk-engine.js'

class RiskMonitor {
  private timer: NodeJS.Timeout | null = null
  private snapshot: (() => Snapshot | null) | null = null
  private busy = false
  private lastTickAt: string | null = null
  private peaks = new Map<string, number>()

  configure(snapshot: () => Snapshot | null) {
    this.snapshot = snapshot
    this.schedule()
  }

  getLastTick(): string | null { return this.lastTickAt }

  private schedule() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.tick(), getRiskConfig().stop.checkIntervalSec * 1000)
  }

  async tick(): Promise<void> {
    if (this.busy) return
    const config = getRiskConfig()
    if (!config.enabled || !config.stop.enabled) return
    const snapshot = this.snapshot?.()
    if (!snapshot || snapshot.marketStatus !== '盘中') return
    const minutes = shanghaiMinutes()
    if (minutes < 9 * 60 + 30 || minutes > 15 * 60) return
    this.busy = true
    try {
      await withTradeLock(async () => {
        const broker = await brokerChannel.status(true)
        if (!broker.ok || broker.mode !== 'live' || !broker.account) return
        this.lastTickAt = new Date().toISOString()
        for (const pos of broker.positions) {
          if (pos.quantity <= 0) { this.peaks.delete(pos.symbol); continue }
          const pnl = effectivePositionPnl(pos).pnlPct
          const peak = Math.max(this.peaks.get(pos.symbol) ?? 0, pnl)
          this.peaks.set(pos.symbol, peak)
          const trailingHit = config.stop.mode === 'trailing' && peak > 0 && peak - pnl >= config.stop.trailingPct
          const fixedHit = config.stop.mode === 'fixed' && pnl <= -config.stop.thresholdPct
          if (!trailingHit && !fixedHit) continue
          if (riskEngine.hasStopEventToday(pos.symbol)) continue
          const now = new Date().toISOString()
          const base: RiskDecision = {
            id: `rk-stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            time: now, kind: 'stop', allowed: config.stop.autoExecute, symbol: pos.symbol, side: 'sell',
            quantity: pos.available, price: pos.lastPrice, source: 'risk_monitor', checks: [],
            reasons: [trailingHit ? `${pos.name || pos.symbol} 从高点回撤 ${(peak - pnl).toFixed(2)}% 触发移动止损` : `${pos.name || pos.symbol} 亏损 ${pnl.toFixed(2)}% 触发 -${config.stop.thresholdPct}% 固定止损`],
            status: config.stop.autoExecute ? 'submitted' : 'alert',
          }
          riskEngine.recordStop(base)
          if (!config.stop.autoExecute) return
          if (pos.available < 100) {
            riskEngine.recordStop({ ...base, kind: 'stop_blocked', allowed: false, status: 'blocked', reasons: [...base.reasons, 'T+1 当日无可卖数量'] })
            return
          }
          const qty = Math.floor(pos.available / 100) * 100
          const price = Math.round((pos.lastPrice - 0.001) * 1000) / 1000
          const audit = createExecution({ mode: 'auto', side: 'sell', symbol: pos.symbol, name: pos.name, price, quantity: qty, positionBefore: pos.quantity, factors: { source: 'risk', note: '风控止损' } })
          try {
            const order = await brokerChannel.placeOrder({ symbol: pos.symbol, side: 'sell', price, quantity: qty, clientOrderId: audit.id }, { source: 'risk_stop' }) as { order_id?: string; status?: string; message?: string; ok?: boolean }
            if (!order?.order_id) throw new Error(order?.message || '止损委托未返回合同号')
            updateExecution(audit.id, { status: 'accepted', orderId: order.order_id, brokerStatus: order.status ?? '', message: order.message ?? '风控止损已受理', resolution: '等待成交核对' })
            const confirmed = await confirmExecution({ orderId: order.order_id, symbol: pos.symbol, side: 'sell', quantity: qty })
            if (confirmed.result === 'filled') {
              updateExecution(audit.id, { status: 'filled', filled: confirmed.evidence.tradeQty || qty, brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: '风控止损已成交' })
              riskEngine.update(base.id, { status: 'submitted', note: `已卖出 ${qty} 股` })
            } else {
              updateExecution(audit.id, { status: 'unknown', brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: '止损未确认，等待核对' })
              riskEngine.update(base.id, { status: 'failed', note: confirmed.evidence.note })
            }
          } catch (err) {
            updateExecution(audit.id, { status: 'unknown', message: err instanceof Error ? err.message : '止损异常', resolution: '止损失败，未补单' })
            riskEngine.update(base.id, { status: 'failed', note: err instanceof Error ? err.message : '止损异常' })
          }
          return
        }
      })
    } finally { this.busy = false }
  }
}

export const riskMonitor = new RiskMonitor()
