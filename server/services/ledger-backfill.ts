import { getExecutions } from './etf-execution.js'
import { recordFill, recordOrderProjection } from './ledger.js'

/** One-time idempotent projection of existing execution audit into the ledger. */
export function backfillLedgerFromExecutions(): { orders: number; fills: number } {
  let orders = 0
  let fills = 0
  for (const ex of getExecutions(200)) {
    recordOrderProjection({
      clientOrderId: ex.id, brokerOrderId: ex.orderId, symbol: ex.symbol, side: ex.side,
      price: ex.price, quantity: ex.quantity, status: ex.status, source: ex.factors?.source ?? ex.mode,
      createdAt: ex.createdAt, updatedAt: ex.updatedAt, error: ex.message || null,
    })
    orders++
    if (ex.status === 'filled') {
      recordFill({ id: ex.id, clientOrderId: ex.id, brokerOrderId: ex.orderId, symbol: ex.symbol, side: ex.side, price: ex.price, quantity: ex.filled || ex.quantity, fee: ex.fee || 0, filledAt: ex.updatedAt })
      fills++
    }
  }
  return { orders, fills }
}
