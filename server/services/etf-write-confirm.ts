import { fetchEtfBrokerStatus, fetchEtfOrders, fetchEtfTrades, isFilledStatus, isRejectedStatus } from './etf-broker.js'
import type { EtfExecutionEvidence } from '../../shared/types.js'

export interface ConfirmResult {
  result: 'filled' | 'partial' | 'pending' | 'rejected' | 'cancelled' | 'unknown'
  evidence: EtfExecutionEvidence
  orderId: string
}

/** Confirm a write from independent reads: order, trade, portfolio. */
export async function confirmExecution(input: {
  orderId: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
}): Promise<ConfirmResult> {
  // Primary pair: order status + fresh portfolio. Only fetch trades if those two
  // do not yet prove the fill, avoiding a redundant third broker read.
  const orders = await fetchEtfOrders(true)
  const order = orders.find((o) => o.orderId === input.orderId)
  const broker = await fetchEtfBrokerStatus(true)
  const position = broker.positions.find((p) => p.symbol === input.symbol)
  const positionAfter = position?.quantity ?? 0
  const cashAfter = broker.account?.cashAvailable ?? null
  const orderStatus = order?.status ?? ''
  const orderFilled = order?.filled ?? 0
  let tradeQty = orderFilled
  let tradePrice: number | null = null
  const canTrustPosition = input.side === 'buy' ? positionAfter >= input.quantity : true
  if (!order || !isFilledStatus(orderStatus) || !canTrustPosition || orderFilled < input.quantity) {
    const trades = await fetchEtfTrades()
    const matched = trades.filter((t) => t.orderId === input.orderId)
    tradeQty = matched.reduce((sum, t) => sum + t.quantity, 0)
    tradePrice = matched.length ? matched[matched.length - 1].price : null
    if (order) {
      return finish(input, orderStatus, orderFilled, tradeQty, tradePrice, positionAfter, cashAfter, true)
    }
  }
  return finish(input, orderStatus, orderFilled, tradeQty, tradePrice, positionAfter, cashAfter, false)
}

function finish(
  input: { orderId: string; symbol: string; side: 'buy' | 'sell'; quantity: number },
  orderStatus: string,
  orderFilled: number,
  tradeQty: number,
  tradePrice: number | null,
  positionAfter: number,
  cashAfter: number | null,
  usedTrades: boolean,
): ConfirmResult {
  const sources = [orderStatus ? 'orders' : null, usedTrades ? 'trades' : null, cashAfter != null ? 'portfolio' : null].filter((x): x is string => Boolean(x))
  let result: ConfirmResult['result'] = 'pending'
  if (!orderStatus) result = 'unknown'
  else if (isRejectedStatus(orderStatus)) result = 'rejected'
  else if (isFilledStatus(orderStatus) && Math.max(orderFilled, tradeQty) >= input.quantity) result = 'filled'
  else if (tradeQty > 0 || orderFilled > 0) result = 'partial'
  else result = 'pending'
  const evidence: EtfExecutionEvidence = {
    sources,
    orderStatus,
    orderFilled,
    tradeQty,
    tradePrice,
    positionAfter,
    cashAfter,
    consistent: result === 'filled',
    note: result === 'filled'
      ? `订单已成 + 成交 ${Math.max(orderFilled, tradeQty)} 股 + 持仓 ${positionAfter} 股`
      : `订单 ${orderStatus || '未找到'} / 成交 ${Math.max(orderFilled, tradeQty)} 股 / 持仓 ${positionAfter} 股`,
  }
  return { result, evidence, orderId: input.orderId }
}

export async function confirmCancellation(orderId: string): Promise<'cancelled' | 'filled' | 'pending' | 'unknown'> {
  const orders = await fetchEtfOrders(true)
  const order = orders.find((o) => o.orderId === orderId)
  if (!order) return 'unknown'
  if (/已撤|撤单/.test(order.status)) return 'cancelled'
  if (isFilledStatus(order.status)) return 'filled'
  return 'pending'
}

export async function confirmFlat(): Promise<{ ok: boolean; positions: number; openOrders: number; note: string }> {
  const [orders, broker] = await Promise.all([fetchEtfOrders(true), fetchEtfBrokerStatus()])
  const openOrders = orders.filter((o) => !/已成|已撤|废单|拒绝|失败/.test(o.status)).length
  const positions = broker.positions.filter((p) => p.quantity > 0).length
  return { ok: openOrders === 0 && positions === 0, positions, openOrders, note: `未完成委托 ${openOrders}，持仓 ${positions} 只` }
}
