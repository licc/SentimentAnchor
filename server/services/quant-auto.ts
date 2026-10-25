import fs from 'node:fs'
import path from 'node:path'
import type { EtfExecutionFactors, QuantAutoState, Snapshot } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { brokerChannel } from './broker-channel.js'
import { createExecution, updateExecution } from './etf-execution.js'
import { fetchEtfOrders } from './etf-broker.js'
import { findMatchingOrder } from './broker-order-match.js'
import { commission } from './etf-fees.js'
import { hasUnknownExecutions, reconcileUnknownExecutions } from './etf-reconcile.js'
import { getQuantPool } from './quant-pool.js'
import { getActiveQuantStrategy, getQuantStrategyById } from './quant-strategy.js'
import { getStrategyModel } from './strategy-model.js'
import { withTradeLock } from './etf-trade-lock.js'
import { fetchStockQuotes, prefixFor } from '../providers/sina.js'
import { confirmExecution } from './etf-write-confirm.js'

const FILE = path.join(process.cwd(), 'data', 'quant-auto.json')
const TICK_MS = 30_000
const MAX_RETRY_MS = 120_000
const ACCOUNT_MAX_EXPOSURE = 0.7
const MIN_ACCOUNT = 1_000

export class QuantAutoService {
  private state: QuantAutoState = load()
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private tickQueued = false
  private snapshot: (() => Snapshot | null) | null = null

  configure(snapshot: () => Snapshot | null) {
    this.snapshot = snapshot
    if (this.state.enabled) {
      if (process.env.AUTO_RESUME_ON_RESTART !== 'true') {
        this.state.enabled = false
        this.state.status = 'paused'
        this.state.lastAction = '服务重启，T+1 自动执行暂停；请核对后手动启动'
        this.state.lastError = null
        this.state.nextRetryAt = null
        this.persist()
        return
      }
      this.state.status = 'waiting'
      this.state.lastAction = '服务重启，恢复 T+1 量化；等待接口'
      this.state.nextRetryAt = null
      this.persist()
      this.schedule()
      void this.tick()
    }
  }

  getState(): QuantAutoState { return { ...this.state } }

  async start(): Promise<QuantAutoState> {
    if (this.state.enabled) return this.getState()
    if (hasUnknownExecutions()) {
      await reconcileUnknownExecutions()
      if (hasUnknownExecutions()) throw new Error('存在未确认交易，请先核对')
    }
    if (await brokerChannel.hasOpenOrders()) throw new Error('存在未完成委托，请先撤单/清仓')
    const broker = await brokerChannel.status(true)
    if (!broker.ok) throw new Error('交易接口未就绪')
    if (broker.mode !== 'live') throw new Error(`接口当前是 ${broker.mode}，不是 live`)
    if (!broker.account || broker.account.totalAsset < MIN_ACCOUNT) throw new Error(`账户总资产低于 ¥${MIN_ACCOUNT}`)
    if (getQuantPool().codes.length === 0) throw new Error('T+1 股票池为空，请先从情绪锚浮现中确认加入')
    this.state = {
      status: 'running', enabled: true, startedAt: new Date().toISOString(), lastTick: null,
      lastAction: 'T+1 量化已启动', lastError: null, targetCode: null, targetName: null,
      entryDate: null, entryPrice: null, entryQuantity: null, retryCount: 0, nextRetryAt: null,
    }
    this.persist()
    this.schedule()
    void this.tick()
    return this.getState()
  }

  pause(reason = '手动暂停'): QuantAutoState {
    this.state.enabled = false
    this.state.status = 'paused'
    this.state.lastAction = reason
    this.state.nextRetryAt = null
    this.clearTimer()
    this.persist()
    return this.getState()
  }

  async flatten(): Promise<QuantAutoState> {
    return withTradeLock(async () => {
      this.pause('T+1 清仓中')
      const broker = await brokerChannel.status(true)
      if (!broker.ok || broker.mode !== 'live') throw new Error('接口不是 live，不能清仓')
      const pool = new Set(getQuantPool().codes)
      const targets = broker.positions.filter((p) => pool.has(p.symbol) && p.available > 0)
      for (const p of targets) {
        const price = p.lastPrice || p.costPrice
        if (!price) throw new Error(`${p.symbol} 无有效价格`)
        const qty = Math.floor(p.available / 100) * 100
        if (qty < 100) continue
        await this.execute(p.symbol, 'sell', price - 0.001, qty, 'T+1 全部清仓')
      }
      this.state.entryDate = null
      this.state.entryPrice = null
      this.state.entryQuantity = null
      this.state.lastAction = `已卖出 ${targets.length} 只 T+1 可用持仓`
      this.state.status = 'idle'
      this.persist()
      return this.getState()
    })
  }

  async tick(): Promise<void> {
    if (this.tickQueued || this.busy || !this.state.enabled) return
    this.tickQueued = true
    try { await withTradeLock(() => this.tickLocked()) } finally { this.tickQueued = false }
  }

  private async tickLocked(): Promise<void> {
    if (this.busy || !this.state.enabled) return
    if (this.state.nextRetryAt && Date.now() < Date.parse(this.state.nextRetryAt)) return
    this.busy = true
    try {
      const snapshot = this.requireSnapshot()
      this.state.lastTick = new Date().toISOString()
      if (snapshot.marketStatus !== '盘中') {
        this.state.lastAction = `非交易时段（${snapshot.marketStatus}）`
        this.persist()
        return
      }
      const broker = await brokerChannel.status(true)
      if (!broker.ok || broker.mode !== 'live' || !broker.account) throw new Error('交易接口暂时不可用')
      const poolData = getQuantPool()
      const pool = poolData.codes
      if (pool.length === 0) throw new Error('T+1 股票池为空')
      const quoteRes = await fetchStockQuotes(pool.map(prefixFor))
      const activeStrategy = getActiveQuantStrategy()
      const strategyFor = (code: string) => getQuantStrategyById(poolData.assignments[code]) ?? activeStrategy
      const today = shanghaiDate()
      const nowMin = shanghaiMinutes()
      const positions = broker.positions.filter((p) => pool.includes(p.symbol) && p.quantity > 0)

      if (positions.length > 0) {
        const pos = positions[0]
        const strategy = strategyFor(pos.symbol)
        if (!this.state.entryDate) {
          this.state.entryDate = today
          this.state.entryPrice = pos.costPrice || pos.lastPrice || null
          this.state.entryQuantity = pos.quantity
          this.state.targetCode = pos.symbol
          this.state.targetName = pos.name
          this.persist()
        }
        const heldDays = dayDiff(this.state.entryDate, today)
        const markPrice = quoteRes.map[pos.symbol]?.price || pos.lastPrice
        const entryPrice = this.state.entryPrice ?? pos.costPrice
        const positionPnl = entryPrice > 0 && markPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 : pos.pnlPct
        const exitStop = positionPnl <= -strategy.stopLossPct
        const exitTake = positionPnl >= strategy.takeProfitPct
        const exitTime = heldDays >= strategy.maxHoldDays && nowMin >= 14 * 60 + 50
        if (pos.available > 0 && (exitStop || exitTake || exitTime)) {
          const reason = exitStop ? `T+1 止损 -${strategy.stopLossPct}%` : exitTake ? `T+1 止盈 +${strategy.takeProfitPct}%` : `T+1 持有 ${strategy.maxHoldDays} 日退出`
          const price = quoteRes.map[pos.symbol]?.price || pos.lastPrice
          if (!price) throw new Error(`${pos.symbol} 无有效价格`)
          await this.execute(pos.symbol, 'sell', price - 0.001, Math.floor(pos.available / 100) * 100, reason)
          this.state.entryDate = null
          this.state.entryPrice = null
          this.state.entryQuantity = null
          this.state.targetCode = null
          this.state.targetName = null
          this.state.lastAction = reason
          this.persist()
          return
        }
        this.state.lastAction = pos.available > 0
          ? `持有 ${pos.name} ${pos.quantity} 股，等待止盈/止损/第 ${strategy.maxHoldDays} 日`
          : `持有 ${pos.name} ${pos.quantity} 股，T+1 当日不可卖`
        this.persist()
        return
      }

      if (broker.account.marketValue >= broker.account.totalAsset * ACCOUNT_MAX_EXPOSURE) {
        this.state.lastAction = '账户总仓位接近上限，暂不新开 T+1'
        this.persist()
        return
      }
      const candidates = (await Promise.all(pool.map(async (code) => {
        const quote = quoteRes.map[code]
        const config = strategyFor(code)
        if (!quote?.price) return null
        const decision = await getStrategyModel(config.model).evaluate({ snapshot, quote, config, nowMin })
        if (decision.action !== 'buy') return null
        return { code, quote, config, decision }
      }))).filter((x): x is NonNullable<typeof x> => Boolean(x))
        .sort((a, b) => b.decision.score - a.decision.score)
      const pick = candidates[0]
      if (!pick) {
        this.state.lastAction = `情绪 ${snapshot.sentiment.stage}，T+1 池内没有模型命中`
        this.persist()
        return
      }
      const budget = Math.min(broker.account.cashAvailable, broker.account.totalAsset * pick.config.positionPct / 100)
      const quantity = Math.floor(budget / (pick.quote.price * 1.001) / 100) * 100
      if (quantity < 100) {
        this.state.lastAction = `资金不足，无法买入 ${pick.quote.name} 100 股`
        this.persist()
        return
      }
      await this.execute(pick.code, 'buy', pick.quote.price + 0.001, quantity, `T+1 ${pick.config.name} 入场`)
      this.state.entryDate = today
      this.state.entryPrice = pick.quote.price
      this.state.entryQuantity = quantity
      this.state.targetCode = pick.code
      this.state.targetName = pick.quote.name
      this.state.lastAction = `T+1 买入 ${pick.quote.name} ${quantity} 股 · ${pick.config.name} · ${pick.decision.reason}`
      this.persist()
    } catch (err) {
      this.markWaiting(err instanceof Error ? err.message : 'T+1 执行异常')
    } finally {
      this.busy = false
    }
  }

  private async execute(symbol: string, side: 'buy' | 'sell', price: number, quantity: number, note: string) {
    const rounded = Math.round(price * 1000) / 1000
    const factors: EtfExecutionFactors = { source: 'quant', note }
    const before = await brokerChannel.status()
    const positionBefore = before.positions.find((p) => p.symbol === symbol)?.quantity ?? 0
    const audit = createExecution({ mode: 'auto', side, symbol, name: symbol, price: rounded, quantity, positionBefore, factors })
    let order: { ok?: boolean; order_id?: string; status?: string; message?: string } = {}
    try {
      order = await brokerChannel.placeOrder({ symbol, side, price: rounded, quantity, clientOrderId: audit.id }, { source: side === 'buy' ? 't1_auto' : 't1_stop' }) as typeof order
    } catch (err) {
      const message = err instanceof Error ? err.message : 'T+1 下单异常'
      updateExecution(audit.id, { status: 'unknown', message, resolution: 'T+1 不补单，等待委托/持仓核对' })
      throw new Error(message)
    }
    if (!order?.order_id) {
      await new Promise((r) => setTimeout(r, 1_200))
      const orders = await fetchEtfOrders(true).catch(() => [])
      const matched = findMatchingOrder(orders, { symbol, side, quantity, price: rounded, createdAt: audit.createdAt })
      if (matched) {
        order = { order_id: matched.orderId, status: matched.status, message: '下单响应异常，但券商委托查询已找到' }
        updateExecution(audit.id, { orderId: matched.orderId, brokerStatus: matched.status, message: order.message, resolution: 'T+1 委托查询匹配' })
      }
    }
    if (order?.ok === false || !order?.order_id) {
      updateExecution(audit.id, { status: 'unknown', message: order?.message || 'T+1 下单未返回合同号', resolution: 'T+1 不补单，等待核对' })
      throw new Error(order?.message || 'T+1 下单未确认')
    }
    updateExecution(audit.id, { status: 'accepted', orderId: order.order_id, brokerStatus: order.status ?? '', message: order.message ?? '已受理', resolution: 'T+1 等待成交核对' })
    const confirmed = await confirmExecution({ orderId: order.order_id, symbol, side, quantity })
    if (confirmed.result !== 'filled') {
      updateExecution(audit.id, { status: confirmed.result === 'partial' ? 'partial' : 'unknown', filled: confirmed.evidence.tradeQty, brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: confirmed.evidence.note })
      throw new Error(`T+1 委托未确认：${confirmed.evidence.note}`)
    }
    updateExecution(audit.id, {
      status: 'filled', filled: confirmed.evidence.tradeQty || quantity, fee: commission(rounded * quantity),
      brokerStatus: confirmed.evidence.orderStatus, evidence: confirmed.evidence, resolution: `T+1 多源确认：${confirmed.evidence.note}`,
    })
  }

  private markWaiting(message: string) {
    this.state.status = 'waiting'
    this.state.lastError = message
    this.state.retryCount = (this.state.retryCount || 0) + 1
    const delay = Math.min(MAX_RETRY_MS, TICK_MS * 2 ** Math.min(this.state.retryCount, 3))
    this.state.nextRetryAt = new Date(Date.now() + delay).toISOString()
    this.state.lastAction = `T+1 接口异常，${Math.round(delay / 1000)}s 后重试`
    this.persist()
  }

  private requireSnapshot(): Snapshot {
    const s = this.snapshot?.()
    if (!s) throw new Error('行情尚未初始化')
    return s
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
    try { atomicWriteJson(FILE, this.state) } catch { /* best effort */ }
  }
}

function load(): QuantAutoState {
  const fallback: QuantAutoState = {
    status: 'idle', enabled: false, startedAt: null, lastTick: null, lastAction: 'T+1 未启动',
    lastError: null, targetCode: null, targetName: null, entryDate: null, entryPrice: null,
    entryQuantity: null, retryCount: 0, nextRetryAt: null,
  }
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as QuantAutoState
    const resumable = raw.enabled === true && ['running', 'waiting', 'recovering'].includes(raw.status)
    return { ...fallback, ...raw, enabled: resumable, status: resumable ? 'waiting' : 'idle', nextRetryAt: null }
  } catch {
    return fallback
  }
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function shanghaiMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
}

function dayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

export const quantAuto = new QuantAutoService()
