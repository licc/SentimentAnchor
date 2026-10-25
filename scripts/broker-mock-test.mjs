import assert from 'node:assert/strict'
import http from 'node:http'

let lastOrder = null
const server = http.createServer((req, res) => {
  const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.url?.startsWith('/api/v1/health')) return send({ ok: true, client_running: true, client_logged_in: true, mode: 'live' })
  if (req.url?.startsWith('/api/v1/portfolio')) return send({ account: { total_asset: 10_000, cash_available: 8_000, market_value: 2_000, pnl_today: 0 }, positions: [] })
  if (req.url?.startsWith('/api/v1/orders') && req.method === 'GET') return send([{ order_id: 'MOCK1', symbol: '518880', name: '黄金ETF', side: '买入', price: 8.205, quantity: 100, filled: 100, status: '已成', time: '14:00:00' }, { order_id: 'MOCK2', symbol: '518880', name: '黄金ETF', side: '买入', price: 8.2, quantity: 100, filled: 0, status: '已报', time: '14:01:00' }])
  if (req.url?.startsWith('/api/v1/trades')) return send([])
  if (req.url?.startsWith('/api/v1/journal')) return send([{ client_order_id: 'MOCK-CLIENT-1', created_at: '2026-10-23T14:00:00', symbol: '518880', side: 'buy', price: 8.2, quantity: 100, status: 'accepted', broker_order_id: 'MOCK1', message: '委托成功' }])
  if (req.url?.startsWith('/api/v1/cancel-all')) { res.writeHead(404); res.end('{}'); return }
  if (req.url?.startsWith('/api/v1/cancel') && req.method === 'POST') return send({ ok: true, message: '撤单成功' })
  if (req.url?.startsWith('/api/v1/orders') && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { lastOrder = JSON.parse(body); send({ ok: true, order_id: 'MOCK1', status: 'accepted' }) })
    return
  }
  res.writeHead(404); res.end('{}')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
process.env.ETF_BROKER_URL = `http://127.0.0.1:${address.port}`
process.env.ETF_ORDER_VERIFY_ATTEMPTS = '1'
process.env.ETF_ORDER_VERIFY_DELAY_MS = '500'
const broker = await import('../server/services/etf-broker.ts')
const status = await broker.fetchEtfBrokerStatus(true)
assert.equal(status.ok, true)
assert.equal(status.mode, 'live')
assert.equal(status.account.totalAsset, 10_000)
const placed = await broker.placeEtfOrder({ symbol: '518880', side: 'buy', price: 8.2, quantity: 100, clientOrderId: 'MOCK-CLIENT-1' })
assert.equal(placed.order_id, 'MOCK1')
assert.equal(lastOrder.client_order_id, 'MOCK-CLIENT-1')
assert.equal(lastOrder.price, 8.201)
assert.equal((await broker.verifyEtfOrder('MOCK1', 100)).status, 'filled')
const orders = await broker.fetchEtfOrders(true)
assert.equal(orders[0].orderId, 'MOCK1')
const journal = await broker.fetchEtfJournal()
assert.equal(journal[0].clientOrderId, 'MOCK-CLIENT-1')
assert.equal(journal[0].orderId, 'MOCK1')
const canceled = await broker.cancelAllEtfOrders()
assert.equal(canceled.canceled, 1)
server.close()
console.log('broker mock tests passed')
