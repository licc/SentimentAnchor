import type { EtfPaperTrade } from '../../shared/types.js'
import { fetchEtfBrokerStatus, fetchEtfJournal, fetchEtfOrders, fetchEtfTrades, isFilledStatus, isRejectedStatus } from './etf-broker.js'
import { findMatchingOrder } from './broker-order-match.js'
import { commission } from './etf-fees.js'
import { getExecutions, updateExecution } from './etf-execution.js'
import { getToday, recordTrade } from './etf-journal.js'

export interface ReconcileResult {
  checked: number
  reconciled: Array<{ executionId: string; orderId: string; symbol: string; quantity: number; positionAfter: number }>
  unresolved: number
  positions: Array<{ symbol: string; name: string; quantity: number; available: number }>
  cashAvailable: number | null
  warnings: string[]
}

/**
 * Reconcile by client_order_id from the broker's own journal (the source of truth),
 * then cross-check trades, positions and cash. Never places or cancels an order.
 */
let reconcileSnapshot: { at: number; promise: Promise<Awaited<ReturnType<typeof loadReconcileSnapshot>>> } | null = null

async function loadReconcileSnapshot() {
  const [broker, orders] = await Promise.all([
    fetchEtfBrokerStatus(true),
    fetchEtfOrders(true).catch(() => []),
  ])
  return { broker, orders }
}

async function getReconcileSnapshot() {
  if (reconcileSnapshot && Date.now() - reconcileSnapshot.at < 15_000) return reconcileSnapshot.promise
  reconcileSnapshot = { at: Date.now(), promise: loadReconcileSnapshot() }
  return reconcileSnapshot.promise
}

export async function reconcileUnknownExecutions(): Promise<ReconcileResult> {
  const executions = getExecutions(200)
  const pending = executions.filter((x) => x.status === 'unknown' || x.status === 'submitting' || x.status === 'accepted')
  const { broker, orders } = await getReconcileSnapshot()
  const positions = broker.positions.map((p) => ({ symbol: p.symbol, name: p.name, quantity: p.quantity, available: p.available }))
  const cashAvailable = broker.account?.cashAvailable ?? null
  if (pending.length === 0) return { checked: 0, reconciled: [], unresolved: 0, positions, cashAvailable, warnings: [] }

  const reconciled: ReconcileResult['reconciled'] = []
  const warnings: string[] = []
  const today = getToday()

  for (const ex of pending) {
    const positionAfter = broker.positions.find((p) => p.symbol === ex.symbol)?.quantity ?? 0
    const delta = ex.positionBefore == null ? null : positionAfter - ex.positionBefore
    const positionProves = delta != null && (ex.side === 'buy' ? delta >= ex.quantity : delta <= -ex.quantity)

    if (positionProves) {
      const price = ex.price
      const amount = price * ex.quantity
      const fee = commission(amount)
      updateExecution(ex.id, {
        status: 'filled', filled: ex.quantity, fee, brokerStatus: '持仓核对',
        evidence: { sources: ['portfolio'], orderStatus: '持仓核对', orderFilled: ex.quantity, tradeQty: ex.quantity, tradePrice: price, positionAfter, cashAfter: cashAvailable, consistent: true, note: `持仓 ${ex.positionBefore} → ${positionAfter}，与委托 ${ex.quantity} 股一致` },
        message: '持仓数量变化已证明成交',
        resolution: `持仓 ${ex.positionBefore} → ${positionAfter}；直接按持仓确认`,
        cashAfter: cashAvailable, positionAfter,
      })
      addReconTrade(today, `recon-${ex.id}`, ex.symbol, ex.name, ex.side, price, ex.quantity, amount, fee, `LIVE · 持仓核对 · ${ex.id}`, broker.account?.totalAsset ?? 0)
      reconciled.push({ executionId: ex.id, orderId: '', symbol: ex.symbol, quantity: ex.quantity, positionAfter })
      continue
    }

    const matched = findMatchingOrder(orders, { symbol: ex.symbol, side: ex.side, quantity: ex.quantity, price: ex.price, createdAt: ex.createdAt })
    if (matched) {
      if (isRejectedStatus(matched.status)) {
        updateExecution(ex.id, { orderId: matched.orderId, status: 'rejected', brokerStatus: matched.status, message: '券商委托查询匹配且已拒绝', resolution: '券商拒绝，不重试', positionAfter, cashAfter: cashAvailable })
        continue
      }
      if (isFilledStatus(matched.status)) {
        const qty = matched.filled || matched.quantity
        const price = matched.price || ex.price
        const amount = price * qty
        const fee = commission(amount)
        updateExecution(ex.id, {
          status: 'filled', orderId: matched.orderId, filled: qty, fee, brokerStatus: matched.status,
          evidence: { sources: ['orders', 'portfolio'], orderStatus: matched.status, orderFilled: qty, tradeQty: qty, tradePrice: price, positionAfter, cashAfter: cashAvailable, consistent: true, note: `委托 ${matched.orderId} 已成 + 持仓 ${positionAfter} 股` },
          message: '下单响应异常，但券商委托查询已匹配成交',
          resolution: `委托 ${matched.orderId} 成交 ${qty} 股；持仓 ${positionAfter} 股`,
          cashAfter: cashAvailable, positionAfter,
        })
        addReconTrade(today, `recon-${matched.orderId}`, ex.symbol, matched.name || ex.name, ex.side, price, qty, amount, fee, `LIVE · 委托匹配核对 · ${matched.orderId} · ${matched.status}`, broker.account?.totalAsset ?? 0)
        reconciled.push({ executionId: ex.id, orderId: matched.orderId, symbol: ex.symbol, quantity: qty, positionAfter })
      } else {
        updateExecution(ex.id, { orderId: matched.orderId, status: 'accepted', brokerStatus: matched.status, message: '券商委托查询匹配，尚未成交', resolution: '已匹配委托，等待成交', cashAfter: cashAvailable, positionAfter })
      }
      continue
    }

    if (ex.side === 'buy' && positionAfter >= ex.quantity) warnings.push(`${ex.symbol} 当前持仓 ${positionAfter} 股，但无法确认是否为该笔买入`)
    updateExecution(ex.id, { positionAfter, cashAfter: cashAvailable })
  }

  return { checked: pending.length, reconciled, unresolved: pending.length - reconciled.length, positions, cashAvailable, warnings }
}

function addReconTrade(today: ReturnType<typeof getToday>, id: string, code: string, name: string, side: 'buy' | 'sell', price: number, quantity: number, amount: number, fee: number, note: string, totalAsset: number) {
  if (today?.trades.some((t) => t.id === id)) return
  const row: EtfPaperTrade = { id, time: new Date().toISOString(), code, name, side, price, quantity, amount, fee, note }
  recordTrade(row, totalAsset, 'live')
}

export function hasUnknownExecutions(): boolean {
  return getExecutions(200).some((x) => x.status === 'unknown' || x.status === 'submitting' || x.status === 'accepted')
}

/** Close only when broker journal confirms rejected/no order and no matching trade exists. */
export async function dismissUnknownExecution(id: string): Promise<ReconcileResult> {
  const ex = getExecutions(200).find((x) => x.id === id)
  if (!ex) throw new Error('执行记录不存在')
  if (!['unknown', 'submitting', 'accepted'].includes(ex.status)) throw new Error('该执行记录不是未确认状态')
  const [journal, trades, broker] = await Promise.all([fetchEtfJournal(200).catch(() => []), fetchEtfTrades(), fetchEtfBrokerStatus()])
  const j = journal.find((x) => x.clientOrderId === id)
  if (j && !/reject|fail|refus|unknown/i.test(j.status) && j.status !== 'pending') throw new Error(`券商台账状态为 ${j.status}，不能标记未成交`)
  if (j?.orderId && trades.some((t) => t.orderId === j.orderId)) throw new Error('券商已有成交明细，不能标记未成交')
  updateExecution(ex.id, {
    status: 'rejected', brokerStatus: j?.status ?? 'NO_JOURNAL', message: j?.message || '人工核对：券商台账无有效成交',
    resolution: '已核对券商台账/成交明细无此单；不补单', cashAfter: broker.account?.cashAvailable ?? null,
    positionAfter: broker.positions.find((p) => p.symbol === ex.symbol)?.quantity ?? null,
  })
  return {
    checked: 1, reconciled: [], unresolved: 0,
    positions: broker.positions.map((p) => ({ symbol: p.symbol, name: p.name, quantity: p.quantity, available: p.available })),
    cashAvailable: broker.account?.cashAvailable ?? null, warnings: [],
  }
}
