import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AlertConfig, AlertEvent, AlertPayload, AlertRule, Snapshot } from '../../shared/types.js'
import { assertSafeWebhookUrl } from '../security.js'
import { atomicWriteJson } from '../lib/atomic.js'
import { sendNotification } from './notify.js'

const DATA_DIR = path.join(process.cwd(), 'data')
const FILE = path.join(DATA_DIR, 'alerts.json')

const DEFAULT_RULES: AlertRule[] = [
  { id: 'scoreLow', label: '情绪冰点', description: '情绪温度低于阈值，进入防守区', enabled: true, threshold: 35, unit: '分' },
  { id: 'scoreHigh', label: '情绪高潮', description: '情绪温度高于阈值，注意兑现', enabled: true, threshold: 85, unit: '分' },
  { id: 'limitDownHigh', label: '跌停扩散', description: '全市场跌停家数达到阈值', enabled: true, threshold: 10, unit: '家' },
  { id: 'limitUpHigh', label: '涨停过热', description: '全市场涨停家数达到阈值', enabled: true, threshold: 80, unit: '家' },
  { id: 'watchMove', label: '自选异动', description: '任一自选股涨跌幅绝对值达到阈值', enabled: true, threshold: 7, unit: '%' },
]

let config: AlertConfig = loadConfig()
let events: AlertEvent[] = loadEvents()
const active = new Set<string>()
const systemActive = new Set<string>()
const ALERT_COOLDOWN_MS = 10 * 60_000

function recentlySeen(title: string, detail: string): boolean {
  const since = Date.now() - ALERT_COOLDOWN_MS
  return events.some((e) => e.title === title && e.detail === detail && Date.parse(e.createdAt) >= since)
}

export function getAlerts(): AlertPayload {
  return {
    config,
    events: events.slice(0, 80),
    unread: events.filter((e) => !e.read).length,
  }
}

export function configureAlerts(input: Partial<AlertConfig>): AlertPayload {
  if (Array.isArray(input.rules)) {
    config.rules = config.rules.map((rule) => {
      const next = input.rules?.find((r) => r.id === rule.id)
      if (!next) return rule
      return {
        ...rule,
        enabled: Boolean(next.enabled),
        threshold: Number.isFinite(Number(next.threshold)) ? Number(next.threshold) : rule.threshold,
      }
    })
  }
  if (typeof input.webhookUrl === 'string') config.webhookUrl = input.webhookUrl.slice(0, 500)
  config.updatedAt = new Date().toISOString()
  saveConfig()
  return getAlerts()
}

export function markAlertsRead(ids?: string[]): AlertPayload {
  if (ids?.length) {
    const set = new Set(ids)
    events = events.map((e) => (set.has(e.id) ? { ...e, read: true } : e))
  } else {
    events = events.map((e) => ({ ...e, read: true }))
  }
  saveEvents()
  return getAlerts()
}

/** Operational alerts (broker, data freshness, intents, kill switch). */
export function evaluateSystemAlerts(messages: string[]): AlertEvent[] {
  const fresh: AlertEvent[] = []
  const next = new Set(messages)
  for (const message of messages) {
    if (systemActive.has(message) || recentlySeen('系统告警', message)) continue
    systemActive.add(message)
    fresh.push({ id: randomUUID(), createdAt: new Date().toISOString(), date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }), level: 'risk', title: '系统告警', detail: message, read: false })
  }
  for (const old of [...systemActive]) if (!next.has(old)) systemActive.delete(old)
  if (fresh.length) {
    events = [...fresh, ...events].slice(0, 200)
    saveEvents()
    if (config.webhookUrl) void sendWebhook(config.webhookUrl, fresh)
    void sendNotification(fresh[0]?.title ?? '交易告警', fresh.map((e) => `${e.title}：${e.detail}`).join('\n'))
  }
  return fresh
}

export function evaluateAlerts(snapshot: Snapshot): AlertEvent[] {
  const fresh: AlertEvent[] = []
  const push = (ruleId: string, level: AlertEvent['level'], title: string, detail: string) => {
    if (active.has(ruleId) || recentlySeen(title, detail)) return
    active.add(ruleId)
    const event: AlertEvent = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      date: snapshot.tradingDate,
      level,
      title,
      detail,
      read: false,
    }
    fresh.push(event)
  }
  for (const rule of config.rules) {
    if (!rule.enabled) {
      active.delete(rule.id)
      continue
    }
    let triggered = false
    if (rule.id === 'scoreLow' && snapshot.sentiment.score <= rule.threshold) {
      triggered = true
      push('scoreLow', 'risk', '情绪进入冰点区', `情绪温度 ${snapshot.sentiment.score} ≤ ${rule.threshold}，${snapshot.sentiment.stage}，注意控制回撤。`)
    } else if (rule.id === 'scoreHigh' && snapshot.sentiment.score >= rule.threshold) {
      triggered = true
      push('scoreHigh', 'warn', '情绪进入高潮区', `情绪温度 ${snapshot.sentiment.score} ≥ ${rule.threshold}，${snapshot.sentiment.stage}，注意高位兑现。`)
    } else if (rule.id === 'limitDownHigh' && snapshot.breadth.limitDown >= rule.threshold) {
      triggered = true
      push('limitDownHigh', 'risk', '跌停家数扩散', `跌停 ${snapshot.breadth.limitDown} 家 ≥ ${rule.threshold}，亏钱效应扩散。`)
    } else if (rule.id === 'limitUpHigh' && snapshot.breadth.limitUp >= rule.threshold) {
      triggered = true
      push('limitUpHigh', 'warn', '涨停家数过热', `涨停 ${snapshot.breadth.limitUp} 家 ≥ ${rule.threshold}，一致性升温。`)
    } else if (rule.id === 'watchMove') {
      const hit = snapshot.watchlist.find((s) => Math.abs(s.pct) >= rule.threshold)
      if (hit) {
        triggered = true
        push('watchMove', 'warn', `自选异动：${hit.name}`, `${hit.name} ${hit.pct >= 0 ? '+' : ''}${hit.pct.toFixed(2)}%，触发 ${rule.threshold}% 异动阈值。`)
      }
    }
    if (!triggered && !['scoreLow', 'scoreHigh', 'limitDownHigh', 'limitUpHigh', 'watchMove'].includes(rule.id)) {
      active.delete(rule.id)
    }
    if (!triggered && ['scoreLow', 'scoreHigh', 'limitDownHigh', 'limitUpHigh'].includes(rule.id)) {
      const stillActive = active.has(rule.id)
      if (stillActive) {
        // Only clear when the specific condition is no longer true.
        if (rule.id === 'scoreLow' && snapshot.sentiment.score > rule.threshold) active.delete(rule.id)
        if (rule.id === 'scoreHigh' && snapshot.sentiment.score < rule.threshold) active.delete(rule.id)
        if (rule.id === 'limitDownHigh' && snapshot.breadth.limitDown < rule.threshold) active.delete(rule.id)
        if (rule.id === 'limitUpHigh' && snapshot.breadth.limitUp < rule.threshold) active.delete(rule.id)
      }
    }
    if (!triggered && rule.id === 'watchMove' && active.has('watchMove')) {
      const still = snapshot.watchlist.some((s) => Math.abs(s.pct) >= rule.threshold)
      if (!still) active.delete('watchMove')
    }
  }
  if (fresh.length) {
    events = [...fresh, ...events].slice(0, 200)
    saveEvents()
    if (config.webhookUrl) void sendWebhook(config.webhookUrl, fresh)
    void sendNotification(fresh[0]?.title ?? '交易告警', fresh.map((e) => `${e.title}：${e.detail}`).join('\n'))
  }
  return fresh
}

async function sendWebhook(url: string, fresh: AlertEvent[]) {
  try {
    const safeUrl = await assertSafeWebhookUrl(url)
    await fetch(safeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({ source: 'sentiment-anchor', events: fresh }),
    })
  } catch {
    // webhook is best-effort
  }
}

function loadConfig(): AlertConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { config?: AlertConfig }
    if (raw.config?.rules?.length) return { ...raw.config, rules: mergeRules(raw.config.rules) }
  } catch {
    // use defaults
  }
  return { rules: DEFAULT_RULES, webhookUrl: '', updatedAt: new Date().toISOString() }
}

function mergeRules(rules: AlertRule[]): AlertRule[] {
  return DEFAULT_RULES.map((def) => {
    const saved = rules.find((r) => r.id === def.id)
    return saved ? { ...def, enabled: Boolean(saved.enabled), threshold: Number(saved.threshold) || def.threshold } : def
  })
}

function loadEvents(): AlertEvent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { events?: AlertEvent[] }
    if (!Array.isArray(raw.events)) return []
    const seen = new Set<string>()
    return raw.events.filter((e) => { const key = `${e.date}|${e.title}|${e.detail}`; if (seen.has(key)) return false; seen.add(key); return true }).slice(0, 200)
  } catch {
    return []
  }
}

function saveConfig() {
  persist()
}
function saveEvents() {
  persist()
}
function persist() {
  try {
    atomicWriteJson(FILE, { config, events })
  } catch {
    // best effort
  }
}
