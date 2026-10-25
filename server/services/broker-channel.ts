/**
 * Shared broker trading channel.
 *
 * T+0 ETF and T+1 stock engines must use this facade. It wraps the single
 * serialized broker client/queue in etf-broker.ts; no engine owns a second
 * connection or a second order path.
 */
import { fetchEtfBrokerStatus, fetchEtfOrders, hasOpenEtfOrders, verifyEtfOrder } from './etf-broker.js'
import { brokerCommand } from './broker-command.js'

export const brokerChannel = {
  status: (force = false) => fetchEtfBrokerStatus(force),
  orders: (force = false) => fetchEtfOrders(force),
  placeOrder: (input: Parameters<typeof brokerCommand.placeOrder>[0], meta?: { source?: string }) => brokerCommand.placeOrder(input, meta),
  cancelOrder: (orderId: string) => brokerCommand.cancelOrder(orderId),
  cancelAll: () => brokerCommand.cancelAll(),
  verifyOrder: (orderId: string, quantity: number) => verifyEtfOrder(orderId, quantity),
  hasOpenOrders: () => hasOpenEtfOrders(),
  commandState: () => brokerCommand.getState(),
}
