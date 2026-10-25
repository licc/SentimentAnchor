import fs from 'node:fs'
import path from 'node:path'
import type { EtfAutoState, EtfExecutionFactors, EtfPaperTrade, Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { fetchEtfJournal, fetchEtfOrders } from './etf-broker.js'
import { findMatchingOrder } from './broker-order-match.js'
import { brokerChannel } from './broker-channel.js'
import { getEtfConfig } from './etf-config.js'
import { getEtfDesk } from './etf-strategy.js'
import { ensureToday, getToday, recordTrade } from './etf-journal.js'
import { createExecution, getExecutions, updateExecution } from './etf-execution.js'
import { hasUnknownExecutions, reconcileUnknownExecutions } from './etf-reconcile.js'
import { commission, roundTripCostPct } from './etf-fees.js'
import { dailyFeeCap } from './etf-fee-config.js'
import { getEtfAutoConfig, minutesOf } from './etf-auto-config.js'
import { effectivePositionPnl } from './position-pnl.js'
import { withTradeLock } from './etf-trade-lock.js'
import { confirmCancellation, confirmExecution, confirmFlat } from './etf-write-confirm.js'

const FILE = path.join(process.cwd(), 'data', 'etf-auto.json')
const TICK_MS = 15_000
const CONFIRM_TICKS = 2
const MIN_ACCOUNT = 1_000
const MAX_RETRY_MS = 120_000
const RECONCILE_DELAYS_MS = [30_000, 60_000, 120_000, 300_000]

export class EtfAutoService {
  private state: EtfAutoState = load()
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private tickQueued = false
  private snapshot: (() => Snapshot | null) | null = null
  private confirmTarget: string | null = null
  private confirmCount = 0
  private lastTradeAt = 0

  configure(snapshot: () => Snapshot | null) {
    this.snapshot = snapshot
    if (this.state.enabled) {
      this.state.lastAction = '服务重启，恢复自动执行；等待接口'
      this.state.status = 'waiting'
      this.state.nextRetryAt = null
      this.persist()
      this.schedule()
      void this.tick()
    }
  }

  getState(): EtfAutoState {
    return { ...this.state }
  }

  async start(): Promise<EtfAutoState> {
    if (this.state.enabled) return this.getState()
    if (hasUnknownExecutions()) {
      await reconcileUnknownExecutions()
      if (hasUnknownExecutions()) throw new Error('存在未确认的历史委托，请先在执行记录中核对/清仓')
    }
    if (this.state.pendingOrderId) {
      if (await brokerChannel.hasOpenOrders()) throw new Error('存在未完成委托，请先撤单/清仓')
      this.state.pendingOrderId = null
    }
    const broker = await brokerChannel.status()
    if (!broker.ok) throw new Error('交易接口未就绪，先检查客户端登录')
    if (broker.mode !== 'live') throw new Error(`接口当前是 ${broker.mode}，不是 live；不能启动自动实盘`)
    if (!broker.account || broker.account.totalAsset < MIN_ACCOUNT) throw new Error(`账户总资产低于 ¥${MIN_ACCOUNT}，不能启动自动执行`)
    if (await brokerChannel.hasOpenOrders()) throw new Error('存在未完成委托，请先撤单/清仓并核对后再启动')
    this.state = {
      status: 'running',
      enabled: true,
      startedAt: new Date().toISOString(),
      lastTick: null,
      lastAction: '自动执行已启动',
      lastError: null,
      target: null,
      confirmCount: 0,
      pendingOrderId: null,
      retryCount: 0,
      nextRetryAt: null,
    }
    this.confirmTarget = null
    this.confirmCount = 0
    this.persist()
    this.schedule()
    void this.tick()
    return this.getState()
  }

  pause(reason = '手动暂停'): EtfAutoState {
    this.state.enabled = false
    this.state.status = 'paused'
    this.state.lastAction = reason
    this.state.nextRetryAt = null
    this.confirmTarget = null
    this.confirmCount = 0
    this.clearTimer()
    this.persist()
    return this.getState()
  }

  async flatten(): Promise<EtfAutoState> {
    return withTradeLock(() => this.flattenLocked())
  }

  private async flattenLocked(): Promise<EtfAutoState> {
    const broker = await brokerChannel.status()
    if (!broker.ok || broker.mode !== 'live') throw new Error('接口不是 live，不能执行真实清仓')
    this.pause('全部清仓中')
    await brokerChannel.cancelAll()
    const desk = await getEtfDesk(this.requireSnapshot())
    const targets = broker.positions.filter((p) => p.available > 0)
    for (const pos of targets) {
      const quote = desk.quotes.find((q) => q.code === pos.symbol)
      const price = quote?.price || pos.lastPrice
      if (!price) throw new Error(`${pos.symbol} 没有有效报价，清仓中止`)
      const quantity = Math.floor(pos.available / 100) * 100
      if (quantity < 100) continue
      await this.execute(pos.symbol, 'sell', price - 0.001, quantity, `清仓 ${pos.name}`, { source: 'auto', note: '全部清仓' })
    }
    const flat = await confirmFlat()
    if (!flat.ok) throw new Error(`清仓未闭环：${flat.note}`)
    this.state = { ...this.state, status: 'idle', enabled: false, pendingOrderId: null, lastAction: `已清仓并确认 ${targets.length} 只 ETF`, lastError: null }
    this.persist()
    return this.getState()
  }

  async tick(): Promise<void> {
    if (this.tickQueued || this.busy || !this.state.enabled) return
    this.tickQueued = true
    try {
      await withTradeLock(() => this.tickLocked())
    } finally {
      this.tickQueued = false
    }
  }

  private async tickLocked(): Promise<void> {
    if (this.busy || !this.state.enabled) return
    if (this.state.nextRetryAt && Date.now() < Date.parse(this.state.nextRetryAt)) return
    if (this.state.pendingOrderId) {
      if (this.state.pendingOrderId === 'unknown') {
        this.busy = true
        try {
          await reconcileUnknownExecutions()
          if (!hasUnknownExecutions()) {
            this.state.pendingOrderId = null
            this.state.status = 'running'
            this.state.lastError = null
            this.state.lastAction = '超时委托已通过券商委托/持仓核对，自动恢复运行'
            this.persist()
          } else {
            this.scheduleReconcile('委托仍未核对到，继续查询券商委托')
          }
        } catch (err) {
          this.markWaiting(err instanceof Error ? err.message : '委托核对失败', true)
        } finally {
          this.busy = false
        }
        return
      }
      this.busy = true
      try {
        if (await brokerChannel.hasOpenOrders()) {
          this.markWaiting('存在未完成或未确认委托，继续监控；不会重复下单', true)
          return
        }
        await reconcileUnknownExecutions()
        this.state.pendingOrderId = null
        this.state.status = 'running'
        this.state.lastError = null
        this.state.lastAction = '未完成委托已消失，自动恢复运行'
        this.persist()
      } catch (err) {
        this.markWaiting(err instanceof Error ? err.message : '委托状态读取失败', true)
      } finally {
        this.busy = false
      }
      return
    }
    this.busy = true
    try {
      const snapshot = this.requireSnapshot()
      if (snapshot.marketStatus !== '盘中') {
        this.state.lastAction = `非交易时段（${snapshot.marketStatus}）`
        this.state.lastTick = new Date().toISOString()
        this.persist()
        return
      }
      // One read cycle: the desk carries the broker snapshot, so do not query it twice.
      const desk = await getEtfDesk(snapshot)
      const broker = desk.broker
      if (!broker.ok || broker.mode !== 'live') throw new Error('交易接口暂时不可用，等待恢复')
      if (!broker.account) throw new Error('账户读取失败，等待恢复')
      this.state.status = 'running'
      this.state.lastError = null
      this.state.retryCount = 0
      this.state.nextRetryAt = null
      const cfg = getEtfAutoConfig()
      const liveToday = getToday()
      if (liveToday?.mode === 'live' && liveToday.startEquity > 0 && cfg.maxDailyLossPct > 0 && liveToday.pnlPct <= -cfg.maxDailyLossPct) {
        this.pause(`当日亏损 ${liveToday.pnlPct.toFixed(2)}% 达到上限 -${cfg.maxDailyLossPct}%，自动执行暂停`)
        return
      }
      const target = desk.signal.targetCode
      const feeSpent = liveToday?.trades.reduce((sum, t) => sum + (t.fee ?? 0), 0) ?? 0
      const feeCap = dailyFeeCap(broker.account.totalAsset)
      if (feeSpent >= feeCap) {
        this.pause(`当日手续费 ¥${feeSpent.toFixed(2)} 已达上限 ¥${feeCap.toFixed(2)}`)
        return
      }
      const projectedFee = commission((broker.account.totalAsset * desk.signal.positionPct)) * 2
      if (feeSpent + projectedFee > feeCap) {
        this.pause(`预计手续费将超过上限 ¥${feeCap.toFixed(2)}，停止自动执行`)
        return
      }
      this.state.target = target
      this.state.lastTick = new Date().toISOString()
      if (!target) {
        this.failKeep('当前没有明确目标 ETF')
        return
      }
      const universe = new Set(getEtfConfig().universe.map((x) => x.code))
      const allPositions = broker.positions.filter((p) => p.quantity > 0)
      const legacy = allPositions.filter((p) => !universe.has(p.symbol))
      const otherValue = allPositions
        .filter((p) => p.symbol !== desk.signal.targetCode)
        .reduce((sum, p) => sum + (p.marketValue || p.lastPrice * p.quantity), 0)
      const current = allPositions.filter((p) => universe.has(p.symbol) && p.available > 0)[0]
      if (legacy.length > 0 && !current) {
        this.state.lastAction = `发现 ${legacy.length} 只非池内持仓，暂不新开仓；可用全部清仓处理`
        this.persist()
        return
      }

      // Account-level stop: any existing position at the stop threshold is exited.
      const stopped = allPositions.find((p) => cfg.stopLossPct > 0 && p.available > 0 && effectivePositionPnl(p).pnlPct <= -cfg.stopLossPct)
      if (stopped) {
        const quote = desk.quotes.find((q) => q.code === stopped.symbol)
        const price = quote?.price || stopped.lastPrice
        if (!price) throw new Error(`${stopped.symbol} 无有效止损价`)
        await this.execute(stopped.symbol, 'sell', price - 0.001, Math.floor(stopped.available / 100) * 100, `账户级止损 ${cfg.stopLossPct}%`, this.factors(desk, '账户级止损'))
        this.pause('触发账户级止损，已转为现金')
        return
      }

      if (cfg.flattenEnabled && shanghaiMinutes() >= minutesOf(cfg.flatTime)) {
        if (current) {
          const quote = desk.quotes.find((q) => q.code === current.symbol)
          if (!quote?.price) throw new Error(`${current.symbol} 无有效卖价，收盘清仓失败`)
          await this.execute(current.symbol, 'sell', quote.price - 0.001, Math.floor(current.available / 100) * 100, '收盘前 T+0 清仓', this.factors(desk, '收盘清仓'))
        }
        this.pause(`${cfg.flatTime} 收盘前清仓，停止自动执行`)
        return
      }

      if (current && cfg.stopLossPct > 0 && effectivePositionPnl(current).pnlPct <= -cfg.stopLossPct) {
        await this.execute(current.symbol, 'sell', (desk.quotes.find((q) => q.code === current.symbol)?.price ?? current.lastPrice) - 0.001, Math.floor(current.available / 100) * 100, `自动止损 ${cfg.stopLossPct}%`, this.factors(desk, '止损'))
        this.pause('触发止损，已转为现金')
        return
      }

      if (current?.symbol === target) {
        const quote = desk.quotes.find((q) => q.code === current.symbol)
        const capValue = Math.max(0, broker.account.totalAsset * desk.signal.positionPct - otherValue)
        if (quote?.price && current.available > 0 && quote.price * current.available > capValue + quote.price * 100) {
          const excess = quote.price * current.available - capValue
          const sellQty = Math.floor(excess / quote.price / 100) * 100
          if (sellQty >= 100) {
            await this.execute(current.symbol, 'sell', quote.price - 0.001, sellQty, `仓位超过建议 ${Math.round(desk.signal.positionPct * 100)}%，减仓`, this.factors(desk, '超仓减仓'))
            this.state.lastAction = `已减仓 ${sellQty} 股 ${current.name}，回到建议仓位`
            this.persist()
            return
          }
        }
        this.confirmTarget = target
        this.confirmCount = 0
        this.state.confirmCount = 0
        this.state.lastAction = `持有 ${current.name}，等待下一次信号`
        this.persist()
        return
      }

      if (this.confirmTarget !== target) {
        this.confirmTarget = target
        this.confirmCount = 1
        this.state.confirmCount = 1
        this.state.lastAction = `目标切换为 ${target}，等待二次确认（1/${CONFIRM_TICKS}）`
        this.persist()
        return
      }
      this.confirmCount += 1
      this.state.confirmCount = this.confirmCount
      if (this.confirmCount < CONFIRM_TICKS) {
        this.state.lastAction = `等待二次确认（${this.confirmCount}/${CONFIRM_TICKS}）`
        this.persist()
        return
      }

      const dayRecord = liveToday ?? ensureToday(broker.account.totalAsset, 'live')
      if (cfg.maxSwitchesPerDay > 0 && dayRecord.trades.filter((t) => t.side === 'sell').length >= cfg.maxSwitchesPerDay) {
        this.pause(`今日已调仓 ${cfg.maxSwitchesPerDay} 次，停止自动执行`)
        return
      }
      if (cfg.cooldownSec > 0 && Date.now() - this.lastTradeAt < cfg.cooldownSec * 1000) {
        this.state.lastAction = `冷却中（${Math.ceil((cfg.cooldownSec * 1000 - (Date.now() - this.lastTradeAt)) / 1000)}s）`
        this.persist()
        return
      }

      if (current) {
        const quote = desk.quotes.find((q) => q.code === current.symbol)
        if (!quote?.price) throw new Error(`${current.symbol} 无有效卖价`)
        await this.execute(current.symbol, 'sell', quote.price - 0.001, Math.floor(current.available / 100) * 100, `自动切换至 ${target}`, this.factors(desk, '切换卖出'))
      }
      if (legacy.length > 0) {
        this.state.lastAction = '存在非池内持仓，暂不新开仓；请先人工确认遗留持仓'
        this.persist()
        return
      }
      const quote = desk.quotes.find((q) => q.code === target)
      if (!quote?.price) throw new Error(`${target} 无有效买价`)
      const budget = Math.min(broker.account.cashAvailable * desk.signal.positionPct, broker.account.totalAsset * desk.signal.positionPct, cfg.maxOrderAmount)
      const quantity = Math.floor(budget / (quote.price * 1.001) / 100) * 100
      if (quantity < 100) throw new Error(`可用资金不足以买入 100 股 ${target}`)
      await this.execute(target, 'buy', quote.price + 0.001, quantity, `自动切换至 ${target}`, this.factors(desk, '切换买入'))
      this.lastTradeAt = Date.now()
      this.confirmCount = 0
      this.confirmTarget = target
      this.state.lastAction = `已切换至 ${quote.name}`
      this.persist()
    } catch (err) {
      this.markWaiting(err instanceof Error ? err.message : String(err), this.state.pendingOrderId !== null)
    } finally {
      this.busy = false
    }
  }

  private async execute(
    symbol: string,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    note: string,
    factors?: EtfExecutionFactors,
  ) {
    const rounded = Math.round(price * 1000) / 1000
    const fee = commission(rounded * quantity)
    const before = await brokerChannel.status()
    const positionBefore = before.positions.find((p) => p.symbol === symbol)?.quantity ?? 0
    const audit = createExecution({
      mode: 'auto',
      side,
      symbol,
      name: symbol,
      price: rounded,
      quantity,
      positionBefore,
      factors: factors ?? { source: 'auto', note },
    })
    let order: { order_id?: string; status?: string; ok?: boolean; message?: string } = {}
    let placeError: Error | null = null
    try {
      order = await brokerChannel.placeOrder({
        symbol,
        side,
        price: rounded,
        quantity,
        clientOrderId: audit.id,
      }, { source: side === 'buy' ? 't0_auto' : 't0_stop' }) as typeof order
    } catch (err) {
      placeError = err instanceof Error ? err : new Error('下单请求异常')
      if (/HTTP 400|risk_rejected|order_rejected|client_rejected/i.test(placeError.message)) {
        updateExecution(audit.id, { status: 'rejected', message: placeError.message, resolution: '券商明确拒绝，不重试' })
        throw placeError
      }
    }
    let orderId = order.order_id
    if (!orderId) {
      await new Promise((r) => setTimeout(r, 1_500))
      const [journal, orders] = await Promise.all([fetchEtfJournal(200).catch(() => []), fetchEtfOrders(true).catch(() => [])])
      const j = journal.find((x) => x.clientOrderId === audit.id)
      if (j?.orderId) {
        orderId = j.orderId
        order.status = j.status
        order.message = '下单响应异常，但券商台账已确认该单'
      } else if (j && /reject|fail|refus|unknown/i.test(j.status)) {
        updateExecution(audit.id, { status: j.status === 'unknown' ? 'unknown' : 'rejected', brokerStatus: j.status, message: j.message, resolution: '券商台账已确认拒绝/未提交；不补单' })
        throw new Error(j.message || '券商台账拒绝委托')
      } else {
        const matched = findMatchingOrder(orders, { symbol, side, quantity, price: rounded, createdAt: audit.createdAt })
        if (matched) {
          orderId = matched.orderId
          order.status = matched.status
          order.message = '下单响应异常，但券商委托查询已找到该单'
        }
      }
    }
    if (!orderId) {
      this.state.pendingOrderId = 'unknown'
      updateExecution(audit.id, {
        status: 'unknown',
        brokerStatus: order.status ?? '',
        message: placeError?.message ?? order.message ?? '未返回合同编号',
        resolution: '响应异常且券商委托查询未找到；不补单，等待人工核对',
      })
      throw new Error('下单结果未知，等待人工核对')
    }
    if (order.ok === false) {
      updateExecution(audit.id, { status: 'rejected', brokerStatus: order.status ?? '', message: order.message ?? '委托被拒绝', resolution: '接口拒绝，不重试' })
      throw new Error(order.message || '委托被拒绝')
    }
    this.state.pendingOrderId = orderId
    updateExecution(audit.id, {
      orderId,
      status: 'accepted',
      brokerStatus: order.status ?? '',
      message: order.message ?? '已受理',
      resolution: '已从券商委托查询确认订单，等待成交回读',
    })
    this.persist()
    const verified = await brokerChannel.verifyOrder(orderId, quantity)
    if (verified.status === 'filled') {
      const confirmed = await confirmExecution({ orderId, symbol, side, quantity })
      if (confirmed.result !== 'filled') {
        updateExecution(audit.id, { status: confirmed.result === 'partial' ? 'partial' : 'unknown', filled: confirmed.evidence.tradeQty, brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: confirmed.evidence.note })
        this.state.pendingOrderId = null
        this.persist()
        throw new Error('订单状态与成交/持仓不一致，已停止')
      }
      updateExecution(audit.id, { status: 'filled', filled: confirmed.evidence.tradeQty || quantity, fee, brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: `多源确认：${confirmed.evidence.note}` })
    } else {
      let cancelResult: Awaited<ReturnType<typeof confirmCancellation>> = 'unknown'
      try {
        await brokerChannel.cancelOrder(orderId)
        cancelResult = await confirmCancellation(orderId)
      } catch {
        // leave unknown for manual reconciliation
      }
      const cancelled = cancelResult === 'cancelled'
      updateExecution(audit.id, {
        status: cancelled ? 'cancelled' : cancelResult === 'filled' ? 'filled' : 'unknown',
        filled: verified.filled,
        brokerStatus: verified.brokerStatus,
        resolution: cancelled ? '已撤单并二次查询确认；自动执行暂停' : '撤单结果未确认；需人工核对',
      })
      this.state.pendingOrderId = null
      this.persist()
      throw new Error(cancelled ? '委托未完全成交，已撤单并暂停' : '委托未确认，需人工核对')
    }
    this.state.pendingOrderId = null
    const trade: EtfPaperTrade = {
      id: orderId,
      time: new Date().toISOString(),
      code: symbol,
      name: symbol,
      side,
      price: rounded,
      quantity,
      amount: rounded * quantity,
      fee,
      note: `AUTO · ${note} · ${order.status || 'accepted'} · ${orderId}`,
    }
    const after = await brokerChannel.status(true)
    updateExecution(audit.id, { cashAfter: after.account?.cashAvailable ?? null })
    recordTrade(trade, after.account?.totalAsset ?? 0, 'live')
  }

  private scheduleReconcile(message: string) {
    this.state.status = 'recovering'
    this.state.lastError = null
    this.state.retryCount = (this.state.retryCount || 0) + 1
    const delay = RECONCILE_DELAYS_MS[Math.min(this.state.retryCount - 1, RECONCILE_DELAYS_MS.length - 1)]
    this.state.nextRetryAt = new Date(Date.now() + delay).toISOString()
    this.state.lastAction = `${message}；第 ${this.state.retryCount} 次核对将在 ${Math.round(delay / 1000)}s 后`
    this.persist()
  }

  private markWaiting(message: string, recovering = false) {
    this.state.status = recovering ? 'recovering' : 'waiting'
    this.state.lastError = message
    this.state.retryCount = (this.state.retryCount || 0) + 1
    const delay = Math.min(MAX_RETRY_MS, TICK_MS * 2 ** Math.min(this.state.retryCount, 3))
    this.state.nextRetryAt = new Date(Date.now() + delay).toISOString()
    this.state.lastAction = recovering
      ? `委托状态待核对，${Math.round(delay / 1000)}s 后继续监控；不会停止`
      : `交易接口暂时异常，${Math.round(delay / 1000)}s 后自动重试；不会停止`
    this.persist()
  }

  private factors(desk: Awaited<ReturnType<typeof getEtfDesk>>, note: string): EtfExecutionFactors {
    return {
      source: 'auto',
      regime: desk.signal.regime,
      score: desk.signal.score,
      stage: desk.signal.stage,
      trend: desk.signal.trend,
      target: desk.signal.targetName ?? undefined,
      reason: desk.signal.reason,
      quote: desk.quotes.find((q) => q.code === desk.signal.targetCode)?.price,
      quotePct: desk.quotes.find((q) => q.code === desk.signal.targetCode)?.pct,
      accountTotal: desk.broker.account?.totalAsset,
      cashAvailable: desk.broker.account?.cashAvailable,
      position: desk.broker.positions[0]?.symbol,
      rules: desk.rules,
      note,
    }
  }


  private failKeep(message: string) {
    this.state.lastAction = message
    this.persist()
  }

  private requireSnapshot(): Snapshot {
    const snapshot = this.snapshot?.()
    if (!snapshot) throw new Error('行情尚未初始化')
    return snapshot
  }

  private schedule() {
    this.clearTimer()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  private clearTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private persist() {
    try {
      atomicWriteJson(FILE, this.state)
    } catch {
      // best effort
    }
  }
}

function shanghaiMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function load(): EtfAutoState {
  const fallback: EtfAutoState = {
    status: 'idle',
    enabled: false,
    startedAt: null,
    lastTick: null,
    lastAction: '未启动',
    lastError: null,
    target: null,
    confirmCount: 0,
    pendingOrderId: null,
    retryCount: 0,
    nextRetryAt: null,
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EtfAutoState
    const resumable = raw.enabled === true && ['running', 'waiting', 'recovering', 'error'].includes(raw.status)
    return {
      ...fallback,
      ...raw,
      enabled: resumable,
      status: resumable ? 'waiting' : raw.status === 'paused' ? 'paused' : 'idle',
      lastAction: resumable ? '服务重启，恢复自动执行；等待接口' : raw.status === 'paused' ? (raw.lastAction || '手动暂停') : '自动执行未启动',
      nextRetryAt: null,
      lastError: resumable ? raw.lastError : null,
    }
  } catch {
    return fallback
  }
}

export const etfAuto = new EtfAutoService()
