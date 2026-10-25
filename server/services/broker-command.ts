/**
 * Single global write-command queue for the broker.
 *
 * Every order/cancel command from T+0, T+1, manual and monitor paths enters
 * this FIFO. No caller may send a write command directly to the broker client.
 */
import { cancelAllEtfOrders, cancelEtfOrder, placeEtfOrder } from './etf-broker.js'
import { riskEngine } from './risk/risk-engine.js'
import { assertIntentCanSend, createIntent, markIntent } from './order-intent.js'
import { assertNotKilled } from './kill-switch.js'
import { inc, observe } from './metrics.js'

type CommandKind = 'place' | 'cancel' | 'cancelAll'
interface CommandState {
  kind: CommandKind | null
  label: string
  startedAt: number | null
  queued: number
  lastFinishedAt: number | null
  lastError: string | null
}

const state: CommandState = { kind: null, label: '', startedAt: null, queued: 0, lastFinishedAt: null, lastError: null }
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(kind: CommandKind, label: string, run: () => Promise<T>): Promise<T> {
  state.queued += 1
  const task = chain.then(async () => {
    state.kind = kind
    state.label = label
    state.startedAt = Date.now()
    try {
      const result = await run()
      state.lastError = null
      return result
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.kind = null
      state.label = ''
      state.startedAt = null
      state.lastFinishedAt = Date.now()
      state.queued = Math.max(0, state.queued - 1)
    }
  })
  chain = task.then(() => undefined, () => undefined)
  return task
}

export const brokerCommand = {
  placeOrder: (input: Parameters<typeof placeEtfOrder>[0], meta: { source?: string } = {}) => {
    if (input.side === 'buy') assertNotKilled()
    assertIntentCanSend(input.clientOrderId)
    createIntent({ clientOrderId: input.clientOrderId, symbol: input.symbol, side: input.side, price: input.price, quantity: input.quantity, source: meta.source || 'unknown' })
    inc('orders.attempted')
    const started = Date.now()
    return enqueue('place', `${input.side} ${input.symbol} ${input.quantity}`, async () => {
      markIntent(input.clientOrderId, { status: 'submitted', error: null })
      try {
        if (input.side === 'buy') await riskEngine.checkBuy({ symbol: input.symbol, price: input.price, quantity: input.quantity, source: meta.source || 'unknown' })
        const result = await placeEtfOrder(input)
        inc('orders.sent')
        observe('broker.place', Date.now() - started)
        markIntent(input.clientOrderId, { status: 'submitted', orderId: String((result as { order_id?: string })?.order_id ?? '') || null, error: null })
        return result
      } catch (err) {
        inc(/risk|拦截|拒绝/i.test(err instanceof Error ? err.message : String(err)) ? 'orders.blocked' : 'orders.failed')
        observe('broker.place_error', Date.now() - started)
        const message = err instanceof Error ? err.message : String(err)
        markIntent(input.clientOrderId, { status: /risk|拦截|拒绝/i.test(message) ? 'rejected' : 'unknown', error: message })
        throw err
      }
    })
  },
  cancelOrder: (orderId: string) => enqueue('cancel', `cancel ${orderId}`, () => cancelEtfOrder(orderId)),
  cancelAll: () => enqueue('cancelAll', 'cancel all', () => cancelAllEtfOrders()),
  getState: () => ({ ...state }),
}
