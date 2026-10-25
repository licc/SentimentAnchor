import fs from 'node:fs'
import path from 'node:path'
import type { EtfBrokerStatus } from '../../shared/types.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { getRuntimeConfig } from './runtime-config.js'



interface HealthResponse {
  ok: boolean
  client_running: boolean
  client_logged_in: boolean
  broker?: string
  mode?: string
  now?: string
  detail?: unknown
}

interface AccountResponse {
  total_asset: number
  cash_available: number
  market_value: number
  pnl_today: number
  updated_at?: string
}

interface PortfolioResponse {
  account: AccountResponse | null
  positions: PositionResponse[] | null
}

interface PositionResponse {
  symbol: string
  name?: string
  quantity: number
  available?: number
  cost_price?: number
  last_price?: number
  market_value?: number
  pnl?: number
  pnl_pct?: number
}

let brokerQueue: Promise<unknown> = Promise.resolve()

function request<T>(path: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const started = Date.now()
  const run = brokerQueue.then(() => {
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) throw new Error('交易接口排队超时（总时限已到）')
    return doRequest<T>(path, init, remaining)
  })
  brokerQueue = run.catch(() => undefined)
  return run
}

async function doRequest<T>(path: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const runtime = getRuntimeConfig()
  const response = await fetch(`${runtime.brokerUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      ...(runtime.brokerKey ? { 'X-API-Key': runtime.brokerKey } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // keep raw text in error
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? JSON.stringify(body).slice(0, 300) : text.slice(0, 300)
    throw new Error(`交易接口 HTTP ${response.status}: ${detail}`)
  }
  return body as T
}

const STATUS_CACHE_FILE = path.join(process.cwd(), 'data', 'etf-broker-status.json')
let statusCache: EtfBrokerStatus | null = loadStatusCache()
let statusAt = statusCache ? Date.now() : 0
let statusInFlight: Promise<EtfBrokerStatus> | null = null
const STATUS_TTL_MS = () => getRuntimeConfig().statusTtlMs

export async function fetchEtfBrokerStatus(force = false): Promise<EtfBrokerStatus> {
  if (!force && statusCache && Date.now() - statusAt < STATUS_TTL_MS()) return statusCache
  if (statusInFlight) return statusInFlight
  statusInFlight = doFetchBrokerStatus().finally(() => { statusInFlight = null })
  return statusInFlight
}

async function doFetchBrokerStatus(): Promise<EtfBrokerStatus> {
  try {
    const health = await request<HealthResponse>('/api/v1/health', undefined, 5_000)
    const portfolio = await request<PortfolioResponse>('/api/v1/portfolio?fresh=true', undefined, 20_000)
    const account = portfolio.account
    const positions = portfolio.positions
    const status: EtfBrokerStatus = {
      ok: Boolean(health.ok && health.client_running && health.client_logged_in),
      mode: health.mode || 'unknown',
      clientRunning: Boolean(health.client_running),
      clientLoggedIn: Boolean(health.client_logged_in),
      account: account
        ? {
            totalAsset: Number(account.total_asset) || 0,
            cashAvailable: Number(account.cash_available) || 0,
            marketValue: Number(account.market_value) || 0,
            pnlToday: Number(account.pnl_today) || 0,
            updatedAt: account.updated_at || new Date().toISOString(),
          }
        : null,
      positions: Array.isArray(positions)
        ? positions.map((p) => ({
            symbol: String(p.symbol),
            name: p.name || '',
            quantity: Number(p.quantity) || 0,
            available: Number(p.available) || 0,
            costPrice: Number(p.cost_price) || 0,
            lastPrice: Number(p.last_price) || 0,
            marketValue: Number(p.market_value) || 0,
            pnl: Number(p.pnl) || 0,
            pnlPct: Number(p.pnl_pct) || 0,
          }))
        : [],
      error: null,
    }
    statusCache = status
    statusAt = Date.now()
    try { atomicWriteJson(STATUS_CACHE_FILE, status) } catch { /* best effort */ }
    return status
  } catch (err) {
    const message = err instanceof Error ? err.message : '交易接口不可用'
    if (statusCache) {
      // Preserve the last verified portfolio instead of replacing it with an empty account.
      return { ...statusCache, ok: false, error: message }
    }
    return {
      ok: false,
      mode: 'unknown',
      clientRunning: false,
      clientLoggedIn: false,
      account: null,
      positions: [],
      error: message,
    }
  }
}

export async function placeEtfOrder(input: {
  symbol: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  clientOrderId: string
}): Promise<unknown> {
  return request('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: input.symbol,
      side: input.side,
      // JSON numbers drop trailing zeroes. Keep the third decimal non-zero so the
      // broker GUI receives exactly three decimal places.
      price: brokerPrice(input.price, input.side, input.symbol),
      quantity: input.quantity,
      client_order_id: input.clientOrderId,
      ref_price: brokerPrice(input.price, input.side, input.symbol),
      order_type: 'limit',
    }),
  }, getRuntimeConfig().orderTimeoutMs)
}

export interface BrokerOrder {
  orderId: string
  symbol: string
  name: string
  side: string
  price: number
  quantity: number
  filled: number
  status: string
  time: string
}

export async function fetchEtfOrders(refresh = true): Promise<BrokerOrder[]> {
  const rows = await request<Array<Record<string, unknown>>>(
    `/api/v1/orders?refresh=${refresh ? 'true' : 'false'}`,
    undefined,
    15_000,
  )
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    orderId: String(r.order_id ?? ''),
    symbol: String(r.symbol ?? ''),
    name: String(r.name ?? ''),
    side: String(r.side ?? ''),
    price: Number(r.price) || 0,
    quantity: Number(r.quantity) || 0,
    filled: Number(r.filled) || 0,
    status: String(r.status ?? ''),
    time: String(r.time ?? ''),
  }))
}

export async function cancelAllEtfOrders(): Promise<unknown> {
  try {
    return await request('/api/v1/cancel-all', { method: 'POST' }, 15_000)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/HTTP 404|not found/i.test(message)) throw err
    // Older thsapi builds expose only /cancel. Fall back to per-order cancellation.
    const orders = await fetchEtfOrders(true)
    const open = orders.filter((o) => !isFilledStatus(o.status) && !isRejectedStatus(o.status))
    const failed: Array<{ orderId: string; error: string }> = []
    for (const order of open) {
      try { await cancelEtfOrder(order.orderId) } catch (cancelErr) { failed.push({ orderId: order.orderId, error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr) }) }
    }
    return { ok: failed.length === 0, canceled: open.length - failed.length, failed }
  }
}

export async function verifyEtfOrder(orderId: string, quantity: number): Promise<{ status: 'filled' | 'partial' | 'rejected' | 'pending'; filled: number; brokerStatus: string }> {
  let lastFilled = 0
  let lastStatus = ''
  const attempts = Math.max(1, Number(process.env.ETF_ORDER_VERIFY_ATTEMPTS || 6))
  const delay = Math.max(500, Number(process.env.ETF_ORDER_VERIFY_DELAY_MS || 2_000))
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delay))
    try {
      const orders = await fetchEtfOrders(true)
      const found = orders.find((o) => o.orderId === orderId)
      if (found) {
        lastFilled = Math.max(lastFilled, found.filled)
        lastStatus = found.status
        if (found.filled >= quantity || isFilledStatus(found.status)) return { status: 'filled', filled: found.filled, brokerStatus: found.status }
        if (/部分成交/.test(found.status)) return { status: 'partial', filled: found.filled, brokerStatus: found.status }
        if (isRejectedStatus(found.status)) return { status: 'rejected', filled: found.filled, brokerStatus: found.status }
      }
    } catch {
      // retry
    }
  }
  return { status: lastFilled > 0 ? 'partial' : 'pending', filled: lastFilled, brokerStatus: lastStatus }
}

export async function cancelEtfOrder(orderId: string): Promise<unknown> {
  return request('/api/v1/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order_id: orderId }),
  }, 15_000)
}


export async function hasOpenEtfOrders(): Promise<boolean> {
  try {
    const orders = await fetchEtfOrders(true)
    return orders.some((o) => !isFilledStatus(o.status) && !isRejectedStatus(o.status))
  } catch {
    return true
  }
}


export function isFilledStatus(status: string): boolean {
  if (/部分成交/.test(status ?? '')) return false
  return /已成|已成交|全部成交|成交|完成/.test(status ?? '')
}

export function isRejectedStatus(status: string): boolean {
  return /废单|拒绝|失败|已撤|撤销/.test(status ?? '')
}

export async function findRecentEtfOrder(input: {
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  exclude?: Set<string>
}): Promise<BrokerOrder | null> {
  const orders = await fetchEtfOrders(true)
  const wanted = input.side === 'buy' ? '买' : '卖'
  return orders.find((o) =>
    o.symbol === input.symbol &&
    o.quantity === input.quantity &&
    o.side.includes(wanted) &&
    !isRejectedStatus(o.status) &&
    !(input.exclude?.has(o.orderId) ?? false),
  ) ?? null
}

export interface BrokerJournalRow {
  clientOrderId: string
  orderId: string | null
  symbol: string
  side: string
  price: number
  quantity: number
  status: string
  message: string
  createdAt: string
}

export interface BrokerTrade {
  tradeId: string
  orderId: string
  symbol: string
  side: string
  price: number
  quantity: number
  amount: number
  time: string
}

export async function fetchEtfJournal(limit = 200): Promise<BrokerJournalRow[]> {
  let rows: Array<Record<string, unknown>> = []
  try {
    const raw = await request<Array<Record<string, unknown>>>(`/api/v1/journal?limit=${limit}`, undefined, 15_000)
    rows = Array.isArray(raw) ? raw : []
  } catch (err) {
    // thsapi 0.1.0 documents /journal but some builds do not mount it.
    if (!/HTTP 404|not found/i.test(err instanceof Error ? err.message : String(err))) throw err
    return []
  }
  return rows.map((r) => ({
    clientOrderId: String(r.client_order_id ?? ''),
    orderId: r.broker_order_id ? String(r.broker_order_id) : null,
    symbol: String(r.symbol ?? ''),
    side: String(r.side ?? ''),
    price: Number(r.price) || 0,
    quantity: Number(r.quantity) || 0,
    status: String(r.status ?? ''),
    message: String(r.message ?? ''),
    createdAt: String(r.created_at ?? ''),
  }))
}

export async function fetchEtfTrades(): Promise<BrokerTrade[]> {
  const rows = await request<Array<Record<string, unknown>>>('/api/v1/trades', undefined, 15_000)
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    tradeId: String(r.trade_id ?? ''),
    orderId: String(r.order_id ?? ''),
    symbol: String(r.symbol ?? ''),
    side: String(r.side ?? ''),
    price: Number(r.price) || 0,
    quantity: Number(r.quantity) || 0,
    amount: Number(r.amount) || 0,
    time: String(r.time ?? ''),
  }))
}


function brokerPrice(price: number, side: 'buy' | 'sell', symbol: string): number {
  const isEtf = /^(5|1[5-8])/.test(symbol)
  if (!isEtf) return Math.round(price * 100) / 100
  const rounded = Math.round(price * 1000) / 1000
  if (Math.round(rounded * 1000) % 10 !== 0) return rounded
  return Math.round((rounded + (side === 'buy' ? 0.001 : -0.001)) * 1000) / 1000
}


function loadStatusCache(): EtfBrokerStatus | null {
  try {
    const raw = JSON.parse(fs.readFileSync(STATUS_CACHE_FILE, 'utf8')) as EtfBrokerStatus
    return raw && raw.account ? raw : null
  } catch {
    return null
  }
}
