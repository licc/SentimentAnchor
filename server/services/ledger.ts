import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { EtfOrderIntent, RiskDecision } from '../../shared/types.js'

const DIR = path.join(process.cwd(), 'data')
const FILE = path.join(DIR, 'ledger.db')
fs.mkdirSync(DIR, { recursive: true })
const db = new DatabaseSync(FILE)
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS orders (
    client_order_id TEXT PRIMARY KEY,
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS fills (
    id TEXT PRIMARY KEY,
    client_order_id TEXT,
    broker_order_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    filled_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS risk_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    allowed INTEGER NOT NULL,
    symbol TEXT,
    side TEXT,
    quantity INTEGER,
    price REAL,
    source TEXT,
    status TEXT,
    reasons TEXT,
    created_at TEXT NOT NULL
  );
`)

export function recordOrderIntent(intent: EtfOrderIntent): void {
  db.prepare(`INSERT INTO orders (client_order_id, broker_order_id, symbol, side, price, quantity, status, source, created_at, updated_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_order_id) DO UPDATE SET broker_order_id=excluded.broker_order_id, status=excluded.status, updated_at=excluded.updated_at, error=excluded.error`)
    .run(intent.clientOrderId, intent.orderId, intent.symbol, intent.side, intent.price, intent.quantity, intent.status, intent.source, intent.createdAt, intent.updatedAt, intent.error)
}

export function recordOrderProjection(input: { clientOrderId: string; brokerOrderId?: string | null; symbol: string; side: string; price: number; quantity: number; status: string; source: string; createdAt: string; updatedAt: string; error?: string | null }): void {
  db.prepare(`INSERT OR REPLACE INTO orders (client_order_id, broker_order_id, symbol, side, price, quantity, status, source, created_at, updated_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.clientOrderId, input.brokerOrderId ?? null, input.symbol, input.side, input.price, input.quantity, input.status, input.source, input.createdAt, input.updatedAt, input.error ?? null)
}

export function recordFill(input: { id: string; clientOrderId: string; brokerOrderId?: string | null; symbol: string; side: string; price: number; quantity: number; fee: number; filledAt: string }): void {
  db.prepare(`INSERT OR REPLACE INTO fills (id, client_order_id, broker_order_id, symbol, side, price, quantity, fee, filled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.clientOrderId, input.brokerOrderId ?? null, input.symbol, input.side, input.price, input.quantity, input.fee, input.filledAt)
}

export function recordRiskEvent(decision: RiskDecision): void {
  db.prepare(`INSERT OR REPLACE INTO risk_events (id, kind, allowed, symbol, side, quantity, price, source, status, reasons, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(decision.id, decision.kind, decision.allowed ? 1 : 0, decision.symbol, decision.side, decision.quantity, decision.price, decision.source, decision.status, decision.reasons.join('；'), decision.time)
}

export function ledgerSummary(): { orders: number; fills: number; riskEvents: number; filledNotional: number; fees: number; blocked: number } {
  const o = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }
  const f = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(price * quantity), 0) AS notional, COALESCE(SUM(fee), 0) AS fees FROM fills').get() as { n: number; notional: number; fees: number }
  const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END), 0) AS blocked FROM risk_events").get() as { n: number; blocked: number }
  return { orders: o.n, fills: f.n, riskEvents: r.n, filledNotional: f.notional, fees: f.fees, blocked: r.blocked }
}

export function recentLedger(limit = 30, filter: { symbol?: string; status?: string } = {}): unknown[] {
  const clauses: string[] = []
  const params: Array<string | number> = []
  if (filter.symbol) { clauses.push('symbol = ?'); params.push(filter.symbol) }
  if (filter.status) { clauses.push('status = ?'); params.push(filter.status) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  params.push(Math.max(1, Math.min(200, limit)))
  return db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ?`).all(...params)
}
